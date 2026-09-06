// ─── Publish run bookkeeping ─────────────────────────────────────────────────
//
// Shared by the QuickBooks and Xero publish routes so the two report their
// outcomes identically and the period screen can render either without caring
// which provider produced it.

import { prisma } from '@/lib/prisma';

// Vercel Hobby caps a function at 60s. A period fans out into one invoice per
// client, so the loop stops itself before the platform does and reports exactly
// which clients are left — a resumable stop rather than a killed request that
// leaves a claimed-but-unrecorded invoice behind.
export const TIME_BUDGET_MS = 45_000;

export type Outcome = 'issued' | 'recovered' | 'skipped_already_invoiced' | 'failed';

export interface ClientResult {
  clientId: string;
  clientName: string;
  outcome: Outcome;
  invoiceNumber?: string;
  providerInvoiceId?: string;
  amount?: number;
  currency?: string;
  error?: string;
}

export interface RunSummary {
  issued: number;
  recovered: number;
  skipped: number;
  failed: number;
  remaining: number;
}

export function summarise(results: ClientResult[], remaining: unknown[]): RunSummary {
  return {
    issued: results.filter((r) => r.outcome === 'issued').length,
    recovered: results.filter((r) => r.outcome === 'recovered').length,
    skipped: results.filter((r) => r.outcome === 'skipped_already_invoiced').length,
    failed: results.filter((r) => r.outcome === 'failed').length,
    remaining: remaining.length,
  };
}

/**
 * A sentence a person can act on. Names the clients still outstanding rather
 * than only counting them, so a partial run says what to do next.
 */
export function describeRun(
  s: RunSummary,
  remaining: { clientName: string }[],
  provider: string,
): string {
  const parts: string[] = [];
  if (s.issued) parts.push(`${s.issued} invoice${s.issued === 1 ? '' : 's'} created in ${provider}`);
  if (s.recovered) parts.push(`${s.recovered} recovered from an earlier attempt`);
  if (s.skipped) parts.push(`${s.skipped} already invoiced`);
  if (s.failed) parts.push(`${s.failed} failed`);
  if (parts.length === 0) parts.push('nothing to do');

  let message = `${parts.join(', ')}.`;
  if (remaining.length > 0) {
    const names = remaining.map((r) => r.clientName).join(', ');
    message +=
      ` Stopped short of the ${Math.round(TIME_BUDGET_MS / 1000)}s time limit with ` +
      `${remaining.length} client${remaining.length === 1 ? '' : 's'} still to invoice: ${names}. ` +
      'Publish again to continue from there.';
  }
  return message;
}

/**
 * A period is PUBLISHED only when every client slice has an issued invoice.
 * Derived from the ledger rather than set optimistically, so the stored status
 * can never claim more than the invoices that actually exist.
 */
export async function syncPeriodStatus(periodId: string, sliceCount: number): Promise<void> {
  const issued = await prisma.invoice.count({ where: { periodId, status: 'ISSUED' } });
  if (sliceCount > 0 && issued >= sliceCount) {
    await prisma.timePeriod.update({
      where: { id: periodId },
      data: { status: 'PUBLISHED', publishedAt: new Date() },
    });
  }
}
