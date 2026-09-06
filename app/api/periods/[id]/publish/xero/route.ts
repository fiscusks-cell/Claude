import { NextRequest, NextResponse } from 'next/server';
import { Invoice, LineItem, Contact, LineAmountTypes, CurrencyCode } from 'xero-node';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/authz';
import { getValidXeroClient } from '@/lib/xero';
import { currencyDecimals, fromMinor, getCurrency } from '@/lib/currency';
import { analyzePeriodBilling, sliceEntriesByClient } from '@/lib/period-billing';
import { composeInvoice, hoursOf, ROUNDING_ADJUSTMENT_LABEL } from '@/lib/invoice-lines';
import { claimSlice, markFailed, markIssued } from '@/lib/invoice-ledger';
import { confirmationRequired, xeroTarget } from '@/lib/publish-safety';
import {
  ClientResult,
  describeRun,
  summarise,
  syncPeriodStatus,
  TIME_BUDGET_MS,
} from '@/lib/publish-run';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const authz = await requireAuth(['OWNER', 'ADMIN']);
    if (authz instanceof NextResponse) return authz;
    const sessionUser = { id: authz.userId, organizationId: authz.organizationId };
    const { id } = await params;

    const body = (await req.json().catch(() => ({}))) as { confirmLive?: boolean };

    // ── load period with billable entries ────────────────────────────────────

    const period = await prisma.timePeriod.findFirst({
      where: { id, organizationId: sessionUser.organizationId },
      include: {
        organization: { select: { name: true } },
        entries: {
          where: { isBillable: true, durationSeconds: { gt: 0 } },
          include: {
            project: { include: { client: true } },
            user: { select: { name: true } },
          },
        },
      },
    });

    if (!period) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    // PUBLISHED is allowed through so a partially published period can resume.
    if (period.status !== 'APPROVED' && period.status !== 'PUBLISHED') {
      return NextResponse.json(
        { error: `Period must be APPROVED before publishing (current: ${period.status})` },
        { status: 400 },
      );
    }

    // ── slice into one invoice per client ────────────────────────────────────

    const slices = sliceEntriesByClient(period.entries);

    if (slices.length === 0) {
      const billing = analyzePeriodBilling(period.entries);
      return NextResponse.json(
        { error: billing.conflict?.message ?? 'Nothing to invoice in this period.' },
        { status: 409 },
      );
    }

    const orphan = slices.find((s) => !s.client.id || !s.client.currency);
    if (orphan) {
      const hours = (orphan.client.seconds / 3600).toFixed(2);
      return NextResponse.json(
        {
          error:
            `${hours}h of billable work in this period is on a project with no client, so it has ` +
            'no customer to invoice and no currency to bill in. Assign the project to a client, then publish.',
          conflict: 'no_client',
        },
        { status: 409 },
      );
    }

    // ── live-publish confirmation ────────────────────────────────────────────
    // Unlike QuickBooks, Xero has no sandbox: every call reaches api.xero.com
    // and writes into whichever organisation the stored token authorised, so
    // confirmation is required on every publish rather than only in production.

    const target = xeroTarget();
    if (target.isLive && !body.confirmLive) {
      return NextResponse.json(
        confirmationRequired(target, slices.map((s) => ({ name: s.client.name }))),
        { status: 428 },
      );
    }

    // ── demo stub when credentials absent ────────────────────────────────────

    if (!process.env.XERO_CLIENT_ID) {
      const demoResults: ClientResult[] = [];
      for (const slice of slices) {
        const composition = composeInvoice(slice.entries, slice.client.currency!);
        const claim = await claimSlice({
          organizationId: sessionUser.organizationId,
          periodId: id,
          clientId: slice.client.id!,
          provider: 'xero',
          currency: composition.currency,
        });
        if (claim.alreadyIssued) {
          demoResults.push({
            clientId: slice.client.id!,
            clientName: slice.client.name,
            outcome: 'skipped_already_invoiced',
            invoiceNumber: claim.invoiceNumber,
          });
          continue;
        }
        const stubId = `XERO-DEMO-${claim.invoiceNumber}`;
        await markIssued({
          invoiceId: claim.invoiceId,
          provider: 'xero',
          providerInvoiceId: stubId,
          amountMajor: fromMinor(composition.totalMinor, composition.currency),
          currency: composition.currency,
        });
        demoResults.push({
          clientId: slice.client.id!,
          clientName: slice.client.name,
          outcome: 'issued',
          invoiceNumber: claim.invoiceNumber,
          providerInvoiceId: stubId,
          amount: fromMinor(composition.totalMinor, composition.currency),
          currency: composition.currency,
        });
      }
      await syncPeriodStatus(id, slices.length);
      return NextResponse.json({
        ok: true,
        demo: true,
        message: 'Demo mode — add XERO_CLIENT_ID to enable real Xero publishing.',
        summary: summarise(demoResults, []),
        results: demoResults,
        remaining: [],
        stoppedEarly: false,
      });
    }

    // ── Xero client ──────────────────────────────────────────────────────────

    const { xero, tenantId } = await getValidXeroClient(sessionUser.id);

    // Which currencies the organisation can actually invoice in. Fetched once
    // rather than per client; a failure here is non-fatal and Xero rejects the
    // invoice itself if the currency is genuinely unusable.
    let enabledCurrencies: string[] | null = null;
    try {
      const currRes = await xero.accountingApi.getCurrencies(tenantId);
      enabledCurrencies = (currRes.body.currencies ?? []).map((c) => String(c.code ?? '').toUpperCase());
    } catch {
      enabledCurrencies = null;
    }

    async function ensureContact(clientName: string, existingContactId: string | null): Promise<string> {
      if (existingContactId) return existingContactId;

      const searchRes = await xero.accountingApi.getContacts(
        tenantId, undefined, `Name=="${clientName.replace(/"/g, '\\"')}"`,
      );
      const found = searchRes.body.contacts?.[0];
      if (found?.contactID) return found.contactID;

      const createRes = await xero.accountingApi.createContacts(tenantId, {
        contacts: [{ name: clientName }],
      });
      const contactId = createRes.body.contacts?.[0]?.contactID;
      if (!contactId) throw new Error(`Xero could not create a contact for "${clientName}"`);
      return contactId;
    }

    /**
     * Did a previous attempt already land this invoice number at Xero? This
     * closes the window between creating the remote invoice and recording it
     * locally — without it, a crash in between means a retry bills twice.
     */
    async function findByInvoiceNumber(invoiceNumber: string): Promise<string | null> {
      try {
        const res = await xero.accountingApi.getInvoices(
          tenantId, undefined, `InvoiceNumber=="${invoiceNumber}"`,
        );
        return res.body.invoices?.[0]?.invoiceID ?? null;
      } catch {
        return null;
      }
    }

    // ── publish, one client at a time ────────────────────────────────────────

    const startedAt = Date.now();
    const results: ClientResult[] = [];
    const remaining: { clientId: string; clientName: string }[] = [];

    for (const slice of slices) {
      const clientId = slice.client.id!;
      const clientName = slice.client.name;

      if (Date.now() - startedAt > TIME_BUDGET_MS) {
        remaining.push({ clientId, clientName });
        continue;
      }

      const composition = composeInvoice(slice.entries, slice.client.currency!);
      const currency = composition.currency;

      let claim;
      try {
        claim = await claimSlice({
          organizationId: sessionUser.organizationId,
          periodId: id,
          clientId,
          provider: 'xero',
          currency,
        });
      } catch (e) {
        results.push({
          clientId,
          clientName,
          outcome: 'failed',
          error: e instanceof Error ? e.message : 'Could not claim an invoice number',
        });
        continue;
      }

      if (claim.alreadyIssued) {
        results.push({
          clientId,
          clientName,
          outcome: 'skipped_already_invoiced',
          invoiceNumber: claim.invoiceNumber,
          providerInvoiceId: claim.existingProviderId ?? undefined,
        });
        continue;
      }

      if (claim.needsReconcile) {
        const found = await findByInvoiceNumber(claim.invoiceNumber);
        if (found) {
          await markIssued({
            invoiceId: claim.invoiceId,
            provider: 'xero',
            providerInvoiceId: found,
            amountMajor: fromMinor(composition.totalMinor, currency),
            currency,
          });
          results.push({
            clientId,
            clientName,
            outcome: 'recovered',
            invoiceNumber: claim.invoiceNumber,
            providerInvoiceId: found,
            amount: fromMinor(composition.totalMinor, currency),
            currency,
          });
          continue;
        }
      }

      try {
        if (currency !== 'USD' && enabledCurrencies && !enabledCurrencies.includes(currency)) {
          const reason =
            `Xero: ${clientName} is billed in ${currency}, which is not enabled in your Xero ` +
            'organisation. Add the currency (or enable multicurrency), then retry.';
          await markFailed(claim.invoiceId, reason);
          results.push({
            clientId, clientName, outcome: 'failed',
            invoiceNumber: claim.invoiceNumber, error: reason,
          });
          continue;
        }

        const existingContactId = slice.entries[0].project?.client?.xeroContactId ?? null;
        const contactId = await ensureContact(clientName, existingContactId);
        if (!existingContactId) {
          await prisma.client.update({
            where: { id: clientId },
            data: { xeroContactId: contactId },
          });
        }

        const currencyMeta = getCurrency(currency);
        const decimals = currencyDecimals(currency);

        const lineItems: LineItem[] = composition.lines.map((line) => {
          const qty = hoursOf(line.seconds);
          const unitAmount = line.rateHundredths / 100;
          return {
            description: `${line.projectName} — ${qty} hrs @ ${currencyMeta.symbol} ${unitAmount.toFixed(decimals)}/hr`,
            quantity: qty,
            unitAmount,
            accountCode: '200',
            lineAmount: fromMinor(line.lineFootMinor, currency),
          };
        });

        if (composition.adjustmentMinor !== 0) {
          const adjAmount = fromMinor(composition.adjustmentMinor, currency);
          lineItems.push({
            description: ROUNDING_ADJUSTMENT_LABEL,
            quantity: 1,
            unitAmount: adjAmount,
            accountCode: '200',
            lineAmount: adjAmount,
          });
        }

        const contact: Contact = { contactID: contactId, name: clientName };
        const invoice: Invoice = {
          type: Invoice.TypeEnum.ACCREC,
          contact,
          lineItems,
          lineAmountTypes: LineAmountTypes.Exclusive,
          date: new Date().toISOString().slice(0, 10),
          dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
          reference: `ORA-${id.slice(-8).toUpperCase()}`,
          status: Invoice.StatusEnum.AUTHORISED,
          invoiceNumber: claim.invoiceNumber,
          ...(currency !== 'USD' && { currencyCode: currency as unknown as CurrencyCode }),
        };

        const res = await xero.accountingApi.createInvoices(tenantId, { invoices: [invoice] });
        const created = res.body.invoices?.[0];

        if (!created?.invoiceID) {
          const reason = `Xero rejected the invoice: ${JSON.stringify(res.body).slice(0, 300)}`;
          await markFailed(claim.invoiceId, reason);
          results.push({
            clientId, clientName, outcome: 'failed',
            invoiceNumber: claim.invoiceNumber, error: reason,
          });
          continue;
        }

        await markIssued({
          invoiceId: claim.invoiceId,
          provider: 'xero',
          providerInvoiceId: created.invoiceID,
          amountMajor: fromMinor(composition.totalMinor, currency),
          currency,
        });
        results.push({
          clientId,
          clientName,
          outcome: 'issued',
          invoiceNumber: claim.invoiceNumber,
          providerInvoiceId: created.invoiceID,
          amount: fromMinor(composition.totalMinor, currency),
          currency,
        });
      } catch (e) {
        const reason = e instanceof Error ? e.message : 'Unexpected error contacting Xero';
        await markFailed(claim.invoiceId, reason);
        results.push({
          clientId,
          clientName,
          outcome: 'failed',
          invoiceNumber: claim.invoiceNumber,
          error: reason,
        });
      }
    }

    await syncPeriodStatus(id, slices.length);

    const summary = summarise(results, remaining);
    return NextResponse.json({
      ok: true,
      summary,
      results,
      remaining,
      stoppedEarly: remaining.length > 0,
      message: describeRun(summary, remaining, 'Xero'),
    });
  } catch (err) {
    console.error('[periods/publish/xero POST] error:', err);
    const message = err instanceof Error ? err.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
