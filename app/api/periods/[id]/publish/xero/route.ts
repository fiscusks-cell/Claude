import { NextRequest, NextResponse } from 'next/server';
import { Invoice, LineItem, Contact, LineAmountTypes, CurrencyCode } from 'xero-node';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/authz';
import { getValidXeroClient } from '@/lib/xero';
import { amountMinor, currencyDecimals, fromMinor, getCurrency, rateToHundredths } from '@/lib/currency';
import { generatePeriodPdf } from '@/lib/generate-period-pdf';
import { analyzePeriodBilling } from '@/lib/period-billing';

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const authz = await requireAuth(['OWNER', 'ADMIN']);
    if (authz instanceof NextResponse) return authz;
    const sessionUser = { id: authz.userId, organizationId: authz.organizationId };
    const { id } = await params;

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

    if (period.status !== 'APPROVED') {
      return NextResponse.json(
        { error: `Period must be APPROVED before publishing (current: ${period.status})` },
        { status: 400 },
      );
    }

    if (period.xeroInvoiceId) {
      return NextResponse.json(
        { error: 'Invoice already published to Xero', invoiceId: period.xeroInvoiceId },
        { status: 409 },
      );
    }

    // ── demo stub when credentials absent ────────────────────────────────────

    if (!process.env.XERO_CLIENT_ID) {
      const stubId = `XERO-DEMO-${id}`;
      await prisma.timePeriod.update({
        where: { id },
        data: { status: 'PUBLISHED', publishedAt: new Date(), xeroInvoiceId: stubId },
      });
      return NextResponse.json({
        ok: true,
        invoiceId: stubId,
        message: 'Demo mode — add XERO_CLIENT_ID to enable real Xero publishing.',
      });
    }

    // ── get valid (auto-refreshed) Xero client ───────────────────────────────

    const { xero, tenantId } = await getValidXeroClient(sessionUser.id);

    // ── resolve the one client and currency this invoice bills ───────────────
    // A Xero invoice is one document for one Contact in one currency. Refused
    // rather than resolved by picking a winner: publishing a period that spans
    // clients would bill everyone else's work to the first client's contact,
    // in the first client's currency.

    const billing = analyzePeriodBilling(period.entries);
    if (!billing.invoiceable) {
      return NextResponse.json(
        {
          error: billing.conflict!.message,
          conflict: billing.conflict!.kind,
          clients: billing.clients,
          currencies: billing.currencies,
        },
        { status: 409 },
      );
    }

    const clientCurrency: string = billing.currency!.toUpperCase();

    // ── group billable entries by project ────────────────────────────────────
    // Money is rounded once per time entry into integer minor units — the same
    // leaf the Reports aggregation uses — so the invoice total reconciles
    // exactly with the report for the same entries.

    type LineGroup = {
      projectName: string;
      clientName: string | null;
      xeroContactId: string | null;
      currency: string; // this line's own client's currency, never a sibling's
      seconds: number;
      rateHundredths: number;
      amountMinor: number; // Σ per-entry minor units
    };

    const byProject = new Map<string, LineGroup>();

    for (const entry of period.entries) {
      const key = entry.projectId ?? '__no_project__';
      const rateHundredths = entry.project ? rateToHundredths(entry.project.hourlyRate) : 0;
      const secs = entry.durationSeconds ?? 0;
      // Derived per line from the project's own client. The guard above means
      // these all agree, but the money is never computed against a currency
      // borrowed from another line.
      const lineCurrency = (entry.project?.client?.currency ?? clientCurrency).toUpperCase();

      if (!byProject.has(key)) {
        byProject.set(key, {
          projectName: entry.project?.name ?? 'Time',
          clientName: entry.project?.client?.name ?? null,
          xeroContactId: entry.project?.client?.xeroContactId ?? null,
          currency: lineCurrency,
          seconds: 0,
          rateHundredths,
          amountMinor: 0,
        });
      }

      const g = byProject.get(key)!;
      g.seconds += secs;
      g.amountMinor += amountMinor(secs, rateHundredths, lineCurrency);
    }


    // ── resolve or create Xero Contact ───────────────────────────────────────

    async function ensureContact(clientName: string, existingContactId: string | null): Promise<string> {
      if (existingContactId) return existingContactId;

      const searchRes = await xero.accountingApi.getContacts(tenantId, undefined, `Name="${clientName}"`);
      const found = searchRes.body.contacts?.[0];
      if (found?.contactID) return found.contactID;

      const createRes = await xero.accountingApi.createContacts(tenantId, {
        contacts: [{ name: clientName }],
      });
      const contactId = createRes.body.contacts?.[0]?.contactID;
      if (!contactId) throw new Error(`Failed to create Xero contact for "${clientName}"`);
      return contactId;
    }

    // The invoice's contact is the period's one client, established by the guard
    // above — not "whichever group sorted first". There is deliberately no
    // catch-all fallback contact: work with no client is refused earlier rather
    // than billed to a placeholder.
    const invoiceClient = period.entries.find(
      (e) => e.project?.client?.id === billing.client!.id,
    )!.project!.client!;

    const primaryClientName: string = invoiceClient.name;
    const primaryContactId = await ensureContact(
      invoiceClient.name,
      invoiceClient.xeroContactId ?? null,
    );

    if (!invoiceClient.xeroContactId) {
      await prisma.client.update({
        where: { id: invoiceClient.id },
        data: { xeroContactId: primaryContactId },
      });
    }

    // ── build line items ─────────────────────────────────────────────────────

    const currencyMeta = getCurrency(clientCurrency);
    const rateDecimals = currencyDecimals(clientCurrency);

    // Each product line foots against its own quantity × unitAmount: quantity is
    // the exact hours (never rounded before the multiply, printed at the
    // precision that makes the arithmetic check out) and lineAmount is
    // round(hours × rate).
    const groups = Array.from(byProject.values());
    const lineFootMinor = (g: LineGroup) => amountMinor(g.seconds, g.rateHundredths, g.currency);

    const lineItems: LineItem[] = groups.map((g) => {
      const qty = parseFloat((g.seconds / 3600).toFixed(6));
      const unitAmount = g.rateHundredths / 100; // Decimal(10,2) — exact
      return {
        description: `${g.projectName} — ${qty} hrs @ ${currencyMeta.symbol} ${unitAmount.toFixed(rateDecimals)}/hr`,
        quantity: qty,
        unitAmount,
        accountCode: '200',
        lineAmount: fromMinor(lineFootMinor(g), g.currency),
      };
    });

    // The invoice total must equal the report total for the same entries
    // (Σ per-entry minor units). Per-entry rounding can leave the product lines
    // a few minor units away from that, so the difference goes on its own
    // disclosed line rather than distorting a product line.
    const reportMinor = groups.reduce((s, g) => s + g.amountMinor, 0);
    const linesMinor = groups.reduce((s, g) => s + lineFootMinor(g), 0);
    const adjMinor = reportMinor - linesMinor;
    if (adjMinor !== 0) {
      const adjAmount = fromMinor(adjMinor, clientCurrency);
      lineItems.push({
        description: 'Rounding adjustment',
        quantity: 1,
        unitAmount: adjAmount,
        accountCode: '200',
        lineAmount: adjAmount,
      });
    }

    // ── validate currency is enabled in Xero ─────────────────────────────────

    if (clientCurrency !== 'USD') {
      try {
        const currRes = await xero.accountingApi.getCurrencies(tenantId);
        const enabledCodes = (currRes.body.currencies ?? []).map(
          (c) => String(c.code ?? '').toUpperCase(),
        );
        if (!enabledCodes.includes(clientCurrency)) {
          return NextResponse.json(
            {
              error: `This client is billed in ${clientCurrency} but your Xero organisation does not have multicurrency enabled or ${clientCurrency} is not added as a currency.`,
            },
            { status: 422 },
          );
        }
      } catch {
        // non-fatal — let Xero reject if currency is truly invalid
      }
    }

    // ── determine next invoice number ────────────────────────────────────────

    let invoiceNumber: string | undefined;
    try {
      const existing = await xero.accountingApi.getInvoices(
        tenantId, undefined, undefined, 'InvoiceNumber DESC', undefined, undefined, undefined, undefined, 1,
      );
      const lastNum = existing.body.invoices?.[0]?.invoiceNumber;
      if (lastNum) {
        const numPart = lastNum.replace(/\D/g, '');
        const prefix = lastNum.replace(/\d+$/, '');
        if (numPart) {
          invoiceNumber = `${prefix}${String(parseInt(numPart, 10) + 1).padStart(numPart.length, '0')}`;
        }
      }
    } catch {
      // fall through — let Xero auto-assign
    }

    // ── create Xero Invoice ───────────────────────────────────────────────────

    const contact: Contact = { contactID: primaryContactId };
    if (primaryClientName) contact.name = primaryClientName;

    const invoice: Invoice = {
      type: Invoice.TypeEnum.ACCREC,
      contact,
      lineItems,
      lineAmountTypes: LineAmountTypes.Exclusive,
      date: new Date().toISOString().slice(0, 10),
      dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
      reference: `ORA-${id.slice(-8).toUpperCase()}`,
      status: Invoice.StatusEnum.AUTHORISED,
      ...(invoiceNumber && { invoiceNumber }),
      ...(clientCurrency !== 'USD' && { currencyCode: clientCurrency as unknown as CurrencyCode }),
    };

    let invoiceRes = await xero.accountingApi.createInvoices(tenantId, { invoices: [invoice] });
    let created = invoiceRes.body.invoices?.[0];

    // retry with incremented number if duplicate
    if (!created?.invoiceID && invoiceNumber) {
      const numPart = invoiceNumber.replace(/\D/g, '');
      const prefix = invoiceNumber.replace(/\d+$/, '');
      if (numPart) {
        invoice.invoiceNumber = `${prefix}${String(parseInt(numPart, 10) + 1).padStart(numPart.length, '0')}`;
        invoiceRes = await xero.accountingApi.createInvoices(tenantId, { invoices: [invoice] });
        created = invoiceRes.body.invoices?.[0];
      }
    }

    if (!created?.invoiceID) {
      const detail = JSON.stringify(invoiceRes.body);
      console.error('[xero publish] invoice create failed:', detail);
      return NextResponse.json({ error: 'Failed to create Xero invoice', detail }, { status: 502 });
    }

    const xeroInvoiceId = created.invoiceID;
    const finalInvoiceNumber = created.invoiceNumber ?? xeroInvoiceId;

    // ── generate and attach PDF report ─────────────────────────────────────────

    let pdfAttached = false;
    try {
      const pdfPeriod = {
        ...period,
        entries: period.entries.map((e: any) => ({
          ...e,
          project: e.project ? { ...e.project, hourlyRate: Number(e.project.hourlyRate) } : null,
        })),
      };
      const pdfBuffer = await generatePeriodPdf(pdfPeriod as any, period.organization?.name);
      await xero.accountingApi.createInvoiceAttachmentByFileName(
        tenantId,
        xeroInvoiceId,
        'ORA-Time-Report.pdf',
        pdfBuffer,
        true,
      );
      pdfAttached = true;
    } catch (pdfErr) {
      console.error('[xero publish] PDF generation/attachment failed:', pdfErr);
    }

    // ── update TimePeriod ─────────────────────────────────────────────────────

    await prisma.timePeriod.update({
      where: { id },
      data: { status: 'PUBLISHED', publishedAt: new Date(), xeroInvoiceId },
    });

    return NextResponse.json({ ok: true, invoiceId: xeroInvoiceId, invoiceNumber: finalInvoiceNumber, pdfAttached });
  } catch (err) {
    console.error('[periods/publish/xero POST] error:', err);
    const message = err instanceof Error ? err.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
