import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/authz';
import { getValidClient, qboApiBase } from '@/lib/qbo';
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

    if (period.status !== 'APPROVED') {
      return NextResponse.json(
        { error: `Period must be APPROVED before publishing (current: ${period.status})` },
        { status: 400 },
      );
    }

    if (period.qboInvoiceId) {
      return NextResponse.json(
        { error: 'Invoice already published to QuickBooks', invoiceId: period.qboInvoiceId },
        { status: 409 },
      );
    }

    // ── demo stub when credentials absent ────────────────────────────────────

    if (!process.env.INTUIT_CLIENT_ID) {
      const stubId = `QBO-DEMO-${id}`;
      await prisma.timePeriod.update({
        where: { id },
        data: { status: 'PUBLISHED', publishedAt: new Date(), qboInvoiceId: stubId },
      });
      return NextResponse.json({
        ok: true,
        invoiceId: stubId,
        message: 'Demo mode — add INTUIT_CLIENT_ID to enable real QuickBooks publishing.',
      });
    }

    // ── get valid (auto-refreshed) OAuth client ──────────────────────────────

    const { client, realmId } = await getValidClient(sessionUser.id);
    const base = qboApiBase(realmId);
    const token = client.getToken().access_token;

    const headers = {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };

    // ── resolve the one client and currency this invoice bills ───────────────
    // A QBO invoice is one document filed under one Customer in one currency.
    // Refused rather than resolved by picking a winner: publishing a period
    // that spans clients would file everyone else's work under the first
    // client's customer record, in the first client's currency.

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
    const currency = clientCurrency;

    // ── group billable entries by project ────────────────────────────────────
    // Money is rounded once per time entry into integer minor units — the same
    // leaf the Reports aggregation uses — so the invoice total reconciles
    // exactly with the report for the same entries.

    type LineGroup = {
      projectName: string;
      clientName: string | null;
      qboCustomerId: string | null;
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
      const lineCurrency = (entry.project?.client?.currency ?? currency).toUpperCase();

      if (!byProject.has(key)) {
        byProject.set(key, {
          projectName: entry.project?.name ?? 'Time',
          clientName: entry.project?.client?.name ?? null,
          qboCustomerId: entry.project?.client?.qboCustomerId ?? null,
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

    // ── resolve or create QBO Customer for each unique client ────────────────

    async function ensureCustomer(clientName: string, existingQboId: string | null): Promise<string> {
      if (existingQboId) return existingQboId;

      // search first
      const searchRes = await fetch(
        `${base}/query?query=${encodeURIComponent(`SELECT * FROM Customer WHERE DisplayName = '${clientName.replace(/'/g, "\\'")}'`)}&minorversion=65`,
        { headers },
      );
      const searchData = (await searchRes.json()) as { QueryResponse: { Customer?: { Id: string }[] } };
      const existing = searchData.QueryResponse.Customer?.[0];
      if (existing) return existing.Id;

      // create
      const createRes = await fetch(`${base}/customer?minorversion=65`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ DisplayName: clientName }),
      });
      const createData = (await createRes.json()) as { Customer: { Id: string } };
      return createData.Customer.Id;
    }

    // ── build Invoice Line items ─────────────────────────────────────────────

    // The invoice's customer is the period's one client, established by the
    // guard above — not "whichever group sorted first". There is deliberately
    // no catch-all fallback customer: work with no client is refused earlier
    // rather than filed under a placeholder.
    const invoiceClient = period.entries.find(
      (e) => e.project?.client?.id === billing.client!.id,
    )!.project!.client!;

    const primaryCustomerId = await ensureCustomer(
      invoiceClient.name,
      invoiceClient.qboCustomerId ?? null,
    );

    // persist QBO customer ID back to the Client record if we resolved it
    if (!invoiceClient.qboCustomerId) {
      await prisma.client.update({
        where: { id: invoiceClient.id },
        data: { qboCustomerId: primaryCustomerId },
      });
    }

    const currencyMeta = getCurrency(currency);
    const decimals = currencyDecimals(currency);

    // Each product line foots against its own Qty × UnitPrice: Qty is the exact
    // hours (never rounded before the multiply, printed at the precision that
    // makes the arithmetic check out) and Amount is round(hours × rate).
    const groups = Array.from(byProject.values());
    const lineFootMinor = (g: LineGroup) => amountMinor(g.seconds, g.rateHundredths, g.currency);

    const lines = groups.map((g, i) => {
      const qty = parseFloat((g.seconds / 3600).toFixed(6));
      const unitPrice = g.rateHundredths / 100; // Decimal(10,2) — exact
      return {
        Id: String(i + 1),
        LineNum: i + 1,
        Description: `${g.projectName} — ${qty} hrs @ ${currencyMeta.symbol} ${unitPrice.toFixed(decimals)}/hr`,
        Amount: fromMinor(lineFootMinor(g), g.currency),
        DetailType: 'SalesItemLineDetail',
        SalesItemLineDetail: {
          Qty: qty,
          UnitPrice: unitPrice,
          ItemRef: { value: '1', name: 'Services' },
        },
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
      const adjAmount = fromMinor(adjMinor, currency);
      lines.push({
        Id: String(lines.length + 1),
        LineNum: lines.length + 1,
        Description: 'Rounding adjustment',
        Amount: adjAmount,
        DetailType: 'SalesItemLineDetail',
        SalesItemLineDetail: {
          Qty: 1,
          UnitPrice: adjAmount,
          ItemRef: { value: '1', name: 'Services' },
        },
      });
    }

    // ── resolve next DocNumber ────────────────────────────────────────────────

    async function getNextDocNumber(): Promise<number> {
      try {
        const qRes = await fetch(
          `${base}/query?query=${encodeURIComponent('SELECT * FROM Invoice ORDERBY DocNumber DESC MAXRESULTS 1')}&minorversion=65`,
          { headers },
        );
        if (!qRes.ok) return 1001;
        const qData = (await qRes.json()) as { QueryResponse: { Invoice?: { DocNumber: string }[] } };
        const invoices = qData.QueryResponse.Invoice ?? [];
        if (invoices.length === 0) return 1001;

        // Find highest purely-numeric DocNumber
        let highest = 0;
        for (const inv of invoices) {
          const n = parseInt(inv.DocNumber, 10);
          if (!isNaN(n) && n > highest) highest = n;
        }

        // If the latest DocNumber wasn't numeric, query for the highest numeric one
        if (highest === 0) {
          const q2Res = await fetch(
            `${base}/query?query=${encodeURIComponent('SELECT * FROM Invoice MAXRESULTS 100')}&minorversion=65`,
            { headers },
          );
          if (q2Res.ok) {
            const q2Data = (await q2Res.json()) as { QueryResponse: { Invoice?: { DocNumber: string }[] } };
            for (const inv of q2Data.QueryResponse.Invoice ?? []) {
              const n = parseInt(inv.DocNumber, 10);
              if (!isNaN(n) && n > highest) highest = n;
            }
          }
        }

        return highest > 0 ? highest + 1 : 1001;
      } catch {
        return 1001;
      }
    }

    const nextDocNumber = await getNextDocNumber();

    // ── create QBO Invoice (with one DocNumber-collision retry) ──────────────

    const periodNote = `Billing period ${period.startDate.toISOString().slice(0, 10)} – ${period.endDate.toISOString().slice(0, 10)}`;

    async function attemptCreate(docNumber: number): Promise<Response> {
      const invoicePayload: Record<string, unknown> = {
        DocNumber: String(docNumber),
        Line: lines,
        CustomerRef: { value: primaryCustomerId },
        TxnDate: new Date().toISOString().slice(0, 10),
        PrivateNote: periodNote,
      };

      if (clientCurrency && clientCurrency !== 'USD') {
        invoicePayload.CurrencyRef = { value: clientCurrency };
      }

      return fetch(`${base}/invoice?minorversion=65`, {
        method: 'POST',
        headers,
        body: JSON.stringify(invoicePayload),
      });
    }

    let invoiceRes: Response;
    try {
      invoiceRes = await attemptCreate(nextDocNumber);

      // Retry once on DocNumber collision (race condition)
      if (!invoiceRes.ok) {
        const peek = await invoiceRes.text();
        if (peek.toLowerCase().includes('docnumber') && peek.toLowerCase().includes('exist')) {
          console.warn('[qbo publish] DocNumber collision, retrying with', nextDocNumber + 1);
          invoiceRes = await attemptCreate(nextDocNumber + 1);
          // Re-wrap the already-consumed body so the error path below can read it
          if (!invoiceRes.ok) {
            const errBody2 = await invoiceRes.text();
            invoiceRes = new Response(errBody2, { status: invoiceRes.status, headers: invoiceRes.headers });
          }
        } else {
          // Re-wrap the already-consumed body for the error handler below
          invoiceRes = new Response(peek, { status: invoiceRes.status, headers: invoiceRes.headers });
        }
      }
    } catch (fetchErr) {
      console.error('[qbo publish] invoice fetch error:', fetchErr);
      return NextResponse.json({ error: 'Network error contacting QuickBooks' }, { status: 502 });
    }

    if (!invoiceRes.ok) {
      const errBody = await invoiceRes.text();
      console.error('[qbo publish] invoice create failed:', errBody);

      const lower = errBody.toLowerCase();
      const isCurrencyError =
        lower.includes('multicurrency') ||
        lower.includes('currency') ||
        /"errorcode"\s*:\s*"?(2500|6000)"?/i.test(errBody);

      if (isCurrencyError) {
        const currencyLabel = clientCurrency ?? 'a non-USD currency';
        return NextResponse.json(
          {
            error: `This client is billed in ${currencyLabel} but your QuickBooks company does not have multicurrency enabled. Please enable it in QBO under Settings → Advanced → Currency, then try again.`,
          },
          { status: 422 },
        );
      }

      return NextResponse.json({ error: 'Failed to create QBO invoice', detail: errBody }, { status: 502 });
    }

    const invoiceData = (await invoiceRes.json()) as { Invoice: { Id: string; DocNumber: string } };
    const qboInvoiceId = invoiceData.Invoice.Id;
    const docNumber = invoiceData.Invoice.DocNumber;

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
      const fileName = 'ORA-Time-Report.pdf';

      const metadata = JSON.stringify({
        AttachableRef: [{
          EntityRef: { type: 'Invoice', value: qboInvoiceId },
          IncludeOnSend: true,
        }],
        FileName: fileName,
        ContentType: 'application/pdf',
      });

      const form = new FormData();
      form.append('file_metadata', new Blob([metadata], { type: 'application/json' }), 'metadata');
      form.append('file_content', new Blob([new Uint8Array(pdfBuffer)], { type: 'application/pdf' }), fileName);

      const uploadRes = await fetch(`${base}/upload?minorversion=65`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        body: form,
      });

      if (uploadRes.ok) {
        pdfAttached = true;
      } else {
        console.error('[qbo publish] PDF upload failed:', await uploadRes.text());
      }
    } catch (pdfErr) {
      console.error('[qbo publish] PDF generation/upload failed:', pdfErr);
    }

    // ── update TimePeriod ─────────────────────────────────────────────────────

    await prisma.timePeriod.update({
      where: { id },
      data: {
        status: 'PUBLISHED',
        publishedAt: new Date(),
        qboInvoiceId,
      },
    });

    return NextResponse.json({ ok: true, invoiceId: qboInvoiceId, docNumber, pdfAttached });
  } catch (err) {
    console.error('[periods/publish/qbo POST] error:', err);
    const message = err instanceof Error ? err.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
