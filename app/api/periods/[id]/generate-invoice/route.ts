import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/authz';
import { fromMinor } from '@/lib/currency';
import { sliceEntriesByClient } from '@/lib/period-billing';
import { composeInvoice, hoursOf, ROUNDING_ADJUSTMENT_LABEL } from '@/lib/invoice-lines';
import { claimSlice } from '@/lib/invoice-ledger';
import { generateInvoicePdf } from '@/lib/invoice-pdf';
import { format, addDays } from 'date-fns';

/**
 * Download the invoice PDF for one client's slice of a period.
 *
 * A period holds work for any number of clients and each becomes its own
 * invoice, so this takes the client to render rather than collapsing the period
 * into a single document. The invoice number comes from the ledger — claiming
 * one if this slice has never been claimed — so the PDF a client receives
 * carries the same number as the invoice published to the accounting provider.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const authz = await requireAuth(['OWNER', 'ADMIN']);
    if (authz instanceof NextResponse) return authz;
    const { id } = await params;

    const body = (await req.json().catch(() => ({}))) as { clientId?: string };

    const period = await prisma.timePeriod.findFirst({
      where: { id, organizationId: authz.organizationId },
      include: {
        organization: true,
        entries: {
          where: { isBillable: true, durationSeconds: { gt: 0 } },
          include: { project: { include: { client: true } } },
        },
      },
    });

    if (!period) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    if (period.status !== 'APPROVED' && period.status !== 'PUBLISHED') {
      return NextResponse.json(
        { error: `Period must be APPROVED before generating an invoice (current: ${period.status})` },
        { status: 400 },
      );
    }

    const slices = sliceEntriesByClient(period.entries);
    if (slices.length === 0) {
      return NextResponse.json(
        { error: 'This period has no billable entries, so there is nothing to invoice.' },
        { status: 409 },
      );
    }

    // One client per invoice. Without an explicit clientId this is only
    // unambiguous when the period happens to hold a single client.
    const slice = body.clientId
      ? slices.find((s) => s.client.id === body.clientId)
      : slices.length === 1
        ? slices[0]
        : undefined;

    if (!slice) {
      return NextResponse.json(
        {
          error: body.clientId
            ? 'That client has no billable work in this period.'
            : `This period covers ${slices.length} clients and each is invoiced separately. ` +
              'Specify which client to invoice.',
          clients: slices.map((s) => ({ id: s.client.id, name: s.client.name })),
        },
        { status: 409 },
      );
    }

    if (!slice.client.id || !slice.client.currency) {
      const hours = (slice.client.seconds / 3600).toFixed(2);
      return NextResponse.json(
        {
          error:
            `${hours}h of billable work here is on a project with no client, so there is no ` +
            'customer to invoice and no currency to bill in. Assign the project to a client first.',
          conflict: 'no_client',
        },
        { status: 409 },
      );
    }

    const composition = composeInvoice(slice.entries, slice.client.currency);
    const currency = composition.currency;

    // Reuse this slice's ledger number so the PDF and the published invoice
    // are the same document.
    const claim = await claimSlice({
      organizationId: authz.organizationId,
      periodId: id,
      clientId: slice.client.id,
      provider: 'qbo',
      currency,
    });

    const clientRecord = slice.entries[0].project!.client!;

    // Each product line foots against its own hours x rate; the residual
    // against the per-entry sum is disclosed on its own line.
    const lineItems = composition.lines.map((line) => ({
      description: line.projectName,
      hours: hoursOf(line.seconds),
      rate: line.rateHundredths / 100,
      amount: fromMinor(line.lineFootMinor, currency),
    }));

    if (composition.adjustmentMinor !== 0) {
      lineItems.push({
        description: ROUNDING_ADJUSTMENT_LABEL,
        hours: 0,
        rate: 0,
        amount: fromMinor(composition.adjustmentMinor, currency),
      });
    }

    const subtotal = fromMinor(composition.totalMinor, currency);
    const now = new Date();

    const pdfBuffer = await generateInvoicePdf({
      invoiceNumber: claim.invoiceNumber,
      date: format(now, 'MMM d, yyyy'),
      dueDate: format(addDays(now, 30), 'MMM d, yyyy'),
      billTo: {
        name: clientRecord.name,
        email: (clientRecord as { email?: string | null }).email ?? '',
      },
      from: { name: period.organization.name },
      lineItems,
      subtotal,
      tax: 0,
      total: subtotal,
      currency,
    });

    // Keep the stored PDF and amount in step with what was just rendered.
    await prisma.invoice.update({
      where: { id: claim.invoiceId },
      data: { pdfData: new Uint8Array(pdfBuffer) },
    });

    return new NextResponse(new Uint8Array(pdfBuffer), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${claim.invoiceNumber}.pdf"`,
        'X-Invoice-Id': claim.invoiceId,
        'X-Invoice-Number': claim.invoiceNumber,
      },
    });
  } catch (err) {
    console.error('[periods/generate-invoice POST] error:', err);
    const message = err instanceof Error ? err.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
