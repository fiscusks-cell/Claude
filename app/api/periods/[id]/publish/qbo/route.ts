import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/authz';
import { getValidClient, qboApiBase } from '@/lib/qbo';
import { currencyDecimals, fromMinor, getCurrency } from '@/lib/currency';
import { analyzePeriodBilling, sliceEntriesByClient } from '@/lib/period-billing';
import { composeInvoice, hoursOf, ROUNDING_ADJUSTMENT_LABEL } from '@/lib/invoice-lines';
import { claimSlice, markFailed, markIssued } from '@/lib/invoice-ledger';
import { confirmationRequired, qboTarget } from '@/lib/publish-safety';
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

    // ── load period with entries ─────────────────────────────────────────────

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
    // Each slice must itself be coherent: billable work on a project with no
    // client has no customer to bill and is refused rather than filed under a
    // placeholder.

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
    // QuickBooks has a sandbox; confirmation is only demanded when this would
    // reach a company that bills real people.

    const target = qboTarget();
    if (target.isLive && !body.confirmLive) {
      return NextResponse.json(
        confirmationRequired(target, slices.map((s) => ({ name: s.client.name }))),
        { status: 428 },
      );
    }

    // ── demo stub when credentials absent ────────────────────────────────────

    if (!process.env.INTUIT_CLIENT_ID) {
      const demoResults: ClientResult[] = [];
      for (const slice of slices) {
        const composition = composeInvoice(slice.entries, slice.client.currency!);
        const claim = await claimSlice({
          organizationId: sessionUser.organizationId,
          periodId: id,
          clientId: slice.client.id!,
          provider: 'qbo',
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
        const stubId = `QBO-DEMO-${claim.invoiceNumber}`;
        await markIssued({
          invoiceId: claim.invoiceId,
          provider: 'qbo',
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
        message: 'Demo mode — add INTUIT_CLIENT_ID to enable real QuickBooks publishing.',
        summary: summarise(demoResults, []),
        results: demoResults,
        remaining: [],
        stoppedEarly: false,
      });
    }

    // ── QuickBooks client ────────────────────────────────────────────────────

    const { client, realmId } = await getValidClient(sessionUser.id);
    const base = qboApiBase(realmId);
    const token = client.getToken().access_token;
    const headers = {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };

    const quote = (value: string) => value.replace(/'/g, "\\'");

    async function ensureCustomer(clientName: string, existingQboId: string | null): Promise<string> {
      if (existingQboId) return existingQboId;

      const query = `SELECT * FROM Customer WHERE DisplayName = '${quote(clientName)}'`;
      const searchRes = await fetch(
        `${base}/query?query=${encodeURIComponent(query)}&minorversion=65`,
        { headers },
      );
      if (searchRes.ok) {
        const searchData = (await searchRes.json()) as { QueryResponse: { Customer?: { Id: string }[] } };
        const existing = searchData.QueryResponse.Customer?.[0];
        if (existing) return existing.Id;
      }

      const createRes = await fetch(`${base}/customer?minorversion=65`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ DisplayName: clientName }),
      });
      if (!createRes.ok) {
        const detail = (await createRes.text()).slice(0, 200);
        throw new Error(`QuickBooks could not create the customer "${clientName}": ${detail}`);
      }
      const createData = (await createRes.json()) as { Customer: { Id: string } };
      return createData.Customer.Id;
    }

    /**
     * Did a previous attempt already land this document number at QuickBooks?
     * This is what closes the window between creating the remote invoice and
     * recording it locally — without it, a crash in between means a retry
     * bills the client twice.
     */
    async function findByDocNumber(docNumber: string): Promise<string | null> {
      try {
        const query = `SELECT * FROM Invoice WHERE DocNumber = '${quote(docNumber)}'`;
        const res = await fetch(
          `${base}/query?query=${encodeURIComponent(query)}&minorversion=65`,
          { headers },
        );
        if (!res.ok) return null;
        const data = (await res.json()) as { QueryResponse: { Invoice?: { Id: string }[] } };
        return data.QueryResponse.Invoice?.[0]?.Id ?? null;
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

      // Stop ourselves before the platform does, so a run is never killed
      // mid-write.
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
          provider: 'qbo',
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
        const found = await findByDocNumber(claim.invoiceNumber);
        if (found) {
          await markIssued({
            invoiceId: claim.invoiceId,
            provider: 'qbo',
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
        const existingCustomerId = slice.entries[0].project?.client?.qboCustomerId ?? null;
        const customerId = await ensureCustomer(clientName, existingCustomerId);
        if (!existingCustomerId) {
          await prisma.client.update({
            where: { id: clientId },
            data: { qboCustomerId: customerId },
          });
        }

        const currencyMeta = getCurrency(currency);
        const decimals = currencyDecimals(currency);

        const lines = composition.lines.map((line, i) => {
          const qty = hoursOf(line.seconds);
          const unitPrice = line.rateHundredths / 100;
          return {
            Id: String(i + 1),
            LineNum: i + 1,
            Description: `${line.projectName} — ${qty} hrs @ ${currencyMeta.symbol} ${unitPrice.toFixed(decimals)}/hr`,
            Amount: fromMinor(line.lineFootMinor, currency),
            DetailType: 'SalesItemLineDetail',
            SalesItemLineDetail: {
              Qty: qty,
              UnitPrice: unitPrice,
              ItemRef: { value: '1', name: 'Services' },
            },
          };
        });

        if (composition.adjustmentMinor !== 0) {
          const adjAmount = fromMinor(composition.adjustmentMinor, currency);
          lines.push({
            Id: String(lines.length + 1),
            LineNum: lines.length + 1,
            Description: ROUNDING_ADJUSTMENT_LABEL,
            Amount: adjAmount,
            DetailType: 'SalesItemLineDetail',
            SalesItemLineDetail: {
              Qty: 1,
              UnitPrice: adjAmount,
              ItemRef: { value: '1', name: 'Services' },
            },
          });
        }

        const payload: Record<string, unknown> = {
          DocNumber: claim.invoiceNumber,
          Line: lines,
          CustomerRef: { value: customerId },
          TxnDate: new Date().toISOString().slice(0, 10),
          PrivateNote:
            `Billing period ${period.startDate.toISOString().slice(0, 10)} – ` +
            `${period.endDate.toISOString().slice(0, 10)}`,
        };
        if (currency !== 'USD') payload.CurrencyRef = { value: currency };

        const res = await fetch(`${base}/invoice?minorversion=65`, {
          method: 'POST',
          headers,
          body: JSON.stringify(payload),
        });

        if (!res.ok) {
          const errBody = await res.text();
          const lower = errBody.toLowerCase();
          const isCurrencyError =
            lower.includes('multicurrency') ||
            lower.includes('currency') ||
            /"errorcode"\s*:\s*"?(2500|6000)"?/i.test(errBody);
          const reason = isCurrencyError
            ? `QuickBooks: ${clientName} is billed in ${currency} but multicurrency is not enabled. ` +
              'Enable it under Settings → Advanced → Currency, then retry.'
            : `QuickBooks rejected the invoice: ${errBody.slice(0, 300)}`;
          await markFailed(claim.invoiceId, reason);
          results.push({
            clientId,
            clientName,
            outcome: 'failed',
            invoiceNumber: claim.invoiceNumber,
            error: reason,
          });
          continue;
        }

        const data = (await res.json()) as { Invoice: { Id: string } };
        await markIssued({
          invoiceId: claim.invoiceId,
          provider: 'qbo',
          providerInvoiceId: data.Invoice.Id,
          amountMajor: fromMinor(composition.totalMinor, currency),
          currency,
        });
        results.push({
          clientId,
          clientName,
          outcome: 'issued',
          invoiceNumber: claim.invoiceNumber,
          providerInvoiceId: data.Invoice.Id,
          amount: fromMinor(composition.totalMinor, currency),
          currency,
        });
      } catch (e) {
        const reason = e instanceof Error ? e.message : 'Unexpected error contacting QuickBooks';
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
      message: describeRun(summary, remaining, 'QuickBooks'),
    });
  } catch (err) {
    console.error('[periods/publish/qbo POST] error:', err);
    const message = err instanceof Error ? err.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
