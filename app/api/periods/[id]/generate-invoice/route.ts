import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/authz';
import { amountMinor, fromMinor, rateToHundredths } from '@/lib/currency';
import { analyzePeriodBilling } from '@/lib/period-billing';
import { generateInvoicePdf } from '@/lib/invoice-pdf';
import { format, addDays } from 'date-fns';

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
        entries: {
          where: { isBillable: true, durationSeconds: { gt: 0 } },
          include: { project: { include: { client: true } } },
        },
        organization: true,
      },
    });

    if (!period) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    if (period.status !== 'APPROVED') {
      return NextResponse.json(
        { error: `Period must be APPROVED before generating invoice (current: ${period.status})` },
        { status: 400 },
      );
    }

    // ── generate invoice number ─────────────────────────────────────────────

    const invoiceCount = await prisma.invoice.count({
      where: { organizationId: sessionUser.organizationId },
    });
    const invoiceNumber = `INV-${String(invoiceCount + 1).padStart(4, '0')}`;

    // ── resolve the one client and currency this invoice bills ───────────────
    // Refused rather than resolved by picking a winner: an invoice is one
    // document for one customer in one currency, so a period holding more than
    // one client cannot become one invoice.

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

    const currency = billing.currency!.toUpperCase();
    const clientRecord = period.entries.find(
      (e) => e.project?.client?.id === billing.client!.id,
    )!.project!.client!;
    const billTo = {
      name: clientRecord.name,
      email: (clientRecord as { email?: string }).email ?? '',
    };

    // ── group entries by project ─────────────────────────────────────────────
    // Money is rounded once per time entry into integer minor units — the same
    // leaf the Reports aggregation uses — so the invoice total reconciles
    // exactly with the report for the same entries.

    type LineGroup = {
      projectName: string;
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

    // ── build line items and totals ──────────────────────────────────────────
    // Each product line foots against its own hours × rate (hours never rounded
    // before the multiply; printed at the precision that makes the arithmetic
    // check out). Per-entry rounding can leave the sum of those a few minor
    // units away from the report total, so the difference is disclosed as an
    // explicit rounding-adjustment line instead of being hidden in a line.

    const groups = Array.from(byProject.values());
    const lineFootMinor = (g: LineGroup) => amountMinor(g.seconds, g.rateHundredths, g.currency);

    const lineItems = groups.map((g) => ({
      description: g.projectName,
      hours: parseFloat((g.seconds / 3600).toFixed(6)),
      rate: g.rateHundredths / 100,
      amount: fromMinor(lineFootMinor(g), g.currency),
    }));

    const reportMinor = groups.reduce((s, g) => s + g.amountMinor, 0);
    const linesMinor = groups.reduce((s, g) => s + lineFootMinor(g), 0);
    const adjMinor = reportMinor - linesMinor;
    if (adjMinor !== 0) {
      lineItems.push({
        description: 'Rounding adjustment',
        hours: 0,
        rate: 0,
        amount: fromMinor(adjMinor, currency),
      });
    }

    const subtotal = fromMinor(reportMinor, currency);
    const tax = 0;
    const total = subtotal;

    // ── build InvoiceData ────────────────────────────────────────────────────

    const now = new Date();

    const invoiceData = {
      invoiceNumber,
      date: format(now, 'MMM d, yyyy'),
      dueDate: format(addDays(now, 30), 'MMM d, yyyy'),
      billTo,
      from: { name: period.organization.name },
      lineItems,
      subtotal,
      tax,
      total,
      currency,
    };

    // ── generate PDF ─────────────────────────────────────────────────────────

    const pdfBuffer = await generateInvoicePdf(invoiceData);

    // ── save invoice record ──────────────────────────────────────────────────

    // The one client this period bills, already established above.
    const clientId = billing.client!.id!;

    const invoice = await prisma.invoice.create({
      data: {
        organizationId: sessionUser.organizationId,
        periodId: id,
        invoiceNumber,
        clientId,
        amount: total,
        currency,
        pdfData: new Uint8Array(pdfBuffer),
      },
    });

    // ── return PDF response ──────────────────────────────────────────────────

    return new NextResponse(new Uint8Array(pdfBuffer), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${invoiceNumber}.pdf"`,
        'X-Invoice-Id': invoice.id,
        'X-Invoice-Number': invoiceNumber,
      },
    });
  } catch (err) {
    console.error('[periods/generate-invoice POST] error:', err);
    const message = err instanceof Error ? err.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
