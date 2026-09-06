import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/authz';
import { getValidClient, qboApiBase } from '@/lib/qbo';
import { generatePeriodPdf } from '@/lib/generate-period-pdf';

/**
 * Attach the timesheet PDF to an already-issued invoice, one invoice at a time.
 *
 * This used to run inside the publish path. Generating and uploading a PDF costs
 * seconds per client, which on a 60s serverless limit cut the number of clients
 * a single publish could cover to roughly a third. Publishing is the part that
 * must not be truncated, so attachment moved out here where it can be done per
 * invoice, at leisure, and retried on its own.
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
    if (!body.clientId) {
      return NextResponse.json({ error: 'clientId is required' }, { status: 400 });
    }

    const invoice = await prisma.invoice.findUnique({
      where: { periodId_clientId: { periodId: id, clientId: body.clientId } },
      include: { client: { select: { name: true } } },
    });

    if (!invoice || invoice.organizationId !== authz.organizationId) {
      return NextResponse.json({ error: 'No invoice for that client in this period' }, { status: 404 });
    }

    if (invoice.status !== 'ISSUED' || !invoice.qboInvoiceId) {
      return NextResponse.json(
        {
          error:
            `${invoice.client.name} has no issued QuickBooks invoice to attach to yet. ` +
            'Publish the period first.',
        },
        { status: 409 },
      );
    }

    if (invoice.qboInvoiceId.startsWith('QBO-DEMO-')) {
      return NextResponse.json(
        { error: 'This invoice was created in demo mode and does not exist in QuickBooks.' },
        { status: 409 },
      );
    }

    // Only this client's entries belong on this client's timesheet.
    const period = await prisma.timePeriod.findFirst({
      where: { id, organizationId: authz.organizationId },
      include: {
        organization: { select: { name: true } },
        entries: {
          where: {
            isBillable: true,
            durationSeconds: { gt: 0 },
            project: { clientId: body.clientId },
          },
          include: {
            project: { include: { client: true } },
            user: { select: { name: true } },
          },
        },
      },
    });

    if (!period) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const pdfPeriod = {
      ...period,
      entries: period.entries.map((e) => ({
        ...e,
        project: e.project ? { ...e.project, hourlyRate: Number(e.project.hourlyRate) } : null,
      })),
    };

    const pdfBuffer = await generatePeriodPdf(
      pdfPeriod as unknown as Parameters<typeof generatePeriodPdf>[0],
      period.organization?.name,
    );

    const { client, realmId } = await getValidClient(authz.userId);
    const base = qboApiBase(realmId);
    const token = client.getToken().access_token;

    const fileName = `ORA-Timesheet-${invoice.invoiceNumber}.pdf`;
    const metadata = JSON.stringify({
      AttachableRef: [
        { EntityRef: { type: 'Invoice', value: invoice.qboInvoiceId }, IncludeOnSend: true },
      ],
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

    if (!uploadRes.ok) {
      const detail = (await uploadRes.text()).slice(0, 300);
      return NextResponse.json(
        { error: `QuickBooks rejected the attachment: ${detail}` },
        { status: 502 },
      );
    }

    return NextResponse.json({
      ok: true,
      invoiceNumber: invoice.invoiceNumber,
      clientName: invoice.client.name,
      fileName,
    });
  } catch (err) {
    console.error('[periods/attach-pdf POST] error:', err);
    const message = err instanceof Error ? err.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
