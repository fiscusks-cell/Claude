// ─── The invoice ledger ──────────────────────────────────────────────────────
//
// Creating an invoice at an accounting provider and recording it locally are two
// writes that cannot share a transaction. If the process dies between them, a
// naive retry bills the client twice — the quiet failure this module exists to
// prevent.
//
// The Invoice table is the ledger. `@@unique([periodId, clientId])` makes the
// claim atomic: one invoice per client per period, enforced by the database
// rather than by application logic. Each slice moves PENDING -> ISSUED (or
// FAILED and retryable), and the stored invoiceNumber is sent as the provider's
// document number so a retry can ask the provider whether the previous attempt
// actually landed before creating anything.
//
// Numbering is allocated at claim, which means a retry reuses its number and
// never burns a new one. Gaps arise only from abandonment — a slice that claims
// and then never issues. If gapless sequential numbering turns out to be
// required, the alternative is to allocate the human-facing number at issue and
// reconcile on a private key instead; that change is free while no invoice has
// issued and expensive afterwards.

import { Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '@/lib/prisma';

export type LedgerProvider = 'qbo' | 'xero';

export interface ClaimResult {
  invoiceId: string;
  invoiceNumber: string;
  /** True when this slice was already ISSUED — skip it, do not re-send. */
  alreadyIssued: boolean;
  /** Provider id of the already-issued invoice, when alreadyIssued. */
  existingProviderId: string | null;
  /** True when a previous attempt got as far as PENDING/FAILED and may have landed. */
  needsReconcile: boolean;
}

const PROVIDER_ID_FIELD: Record<LedgerProvider, 'qboInvoiceId' | 'xeroInvoiceId'> = {
  qbo: 'qboInvoiceId',
  xero: 'xeroInvoiceId',
};

/**
 * Next invoice number for an organisation, allocated under a per-org advisory
 * lock so two concurrent publishes cannot hand out the same one. Reads the
 * highest existing INV-nnnn rather than counting rows, so gaps never cause a
 * number to be reissued.
 */
async function nextInvoiceNumber(
  tx: Prisma.TransactionClient,
  organizationId: string,
): Promise<string> {
  // $executeRaw, not $queryRaw: the lock function returns void, which the
  // driver adapter cannot deserialize as a result column.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${organizationId}))`;
  const rows = await tx.$queryRaw<{ max: string | null }[]>`
    SELECT MAX(CAST(SUBSTRING("invoiceNumber" FROM '^INV-([0-9]+)$') AS INTEGER))::text AS max
      FROM invoices
     WHERE "organizationId" = ${organizationId}
       AND "invoiceNumber" ~ '^INV-[0-9]+$'`;
  const highest = rows[0]?.max ? parseInt(rows[0].max, 10) : 0;
  return `INV-${String(highest + 1).padStart(4, '0')}`;
}

/**
 * Claim a (period, client) slice. Idempotent: an already-ISSUED slice reports
 * itself so the caller skips it; a PENDING or FAILED slice keeps its original
 * number and asks the caller to reconcile against the provider before sending.
 */
export async function claimSlice(params: {
  organizationId: string;
  periodId: string;
  clientId: string;
  provider: LedgerProvider;
  currency: string;
}): Promise<ClaimResult> {
  const { organizationId, periodId, clientId, provider, currency } = params;
  const idField = PROVIDER_ID_FIELD[provider];

  return prisma.$transaction(async (tx) => {
    const existing = await tx.invoice.findUnique({
      where: { periodId_clientId: { periodId, clientId } },
    });

    if (existing) {
      const providerId = existing[idField];
      if (existing.status === 'ISSUED' && providerId) {
        return {
          invoiceId: existing.id,
          invoiceNumber: existing.invoiceNumber,
          alreadyIssued: true,
          existingProviderId: providerId,
          needsReconcile: false,
        };
      }
      // PENDING or FAILED, or ISSUED at the *other* provider: keep the number,
      // but confirm with this provider before creating anything.
      return {
        invoiceId: existing.id,
        invoiceNumber: existing.invoiceNumber,
        alreadyIssued: false,
        existingProviderId: null,
        needsReconcile: true,
      };
    }

    const invoiceNumber = await nextInvoiceNumber(tx, organizationId);
    const created = await tx.invoice.create({
      data: {
        organizationId,
        periodId,
        clientId,
        invoiceNumber,
        amount: new Prisma.Decimal(0),
        currency,
        status: 'PENDING',
      },
    });
    return {
      invoiceId: created.id,
      invoiceNumber,
      alreadyIssued: false,
      existingProviderId: null,
      needsReconcile: false,
    };
  });
}

export async function markIssued(params: {
  invoiceId: string;
  provider: LedgerProvider;
  providerInvoiceId: string;
  amountMajor: number;
  currency: string;
}): Promise<void> {
  const { invoiceId, provider, providerInvoiceId, amountMajor, currency } = params;
  await prisma.invoice.update({
    where: { id: invoiceId },
    data: {
      status: 'ISSUED',
      issuedAt: new Date(),
      failureReason: null,
      amount: new Prisma.Decimal(amountMajor.toFixed(6)),
      currency,
      [PROVIDER_ID_FIELD[provider]]: providerInvoiceId,
    },
  });
}

export async function markFailed(invoiceId: string, reason: string): Promise<void> {
  await prisma.invoice.update({
    where: { id: invoiceId },
    data: { status: 'FAILED', failureReason: reason.slice(0, 500) },
  });
}

/** Every ledger row for a period, keyed by client, for rendering and resume. */
export async function ledgerForPeriod(periodId: string) {
  return prisma.invoice.findMany({
    where: { periodId },
    select: {
      id: true, clientId: true, invoiceNumber: true, status: true,
      qboInvoiceId: true, xeroInvoiceId: true, failureReason: true,
      issuedAt: true, amount: true, currency: true,
    },
  });
}

export type PrismaLike = PrismaClient;
