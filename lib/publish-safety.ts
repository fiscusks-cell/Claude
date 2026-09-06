// ─── Live-publish confirmation ───────────────────────────────────────────────
//
// Publishing a period creates one real invoice per client at the accounting
// provider. A stray click during development must not create ten of them in a
// company that bills real people, so a publish that targets a live destination
// requires an explicit confirmation flag in the request body.
//
// The two providers are not symmetric:
//   QuickBooks has a sandbox, selected by INTUIT_ENVIRONMENT. Anything other
//     than the literal "production" resolves to sandbox, so the default is safe
//     and confirmation is only required when it is explicitly production.
//   Xero has no sandbox at all — every call goes to api.xero.com and writes
//     into whichever organisation the stored token authorised. There is no
//     configuration that makes it safe, so confirmation is always required.

export type PublishProvider = 'qbo' | 'xero';

export interface LiveTarget {
  /** True when this publish would write to a destination that bills real people. */
  isLive: boolean;
  /** Human description of where the invoices would land. */
  destination: string;
}

export function qboTarget(): LiveTarget {
  const env = process.env.INTUIT_ENVIRONMENT ?? 'sandbox';
  const isLive = env === 'production';
  return {
    isLive,
    destination: isLive
      ? 'your live QuickBooks company (INTUIT_ENVIRONMENT=production)'
      : 'the QuickBooks sandbox',
  };
}

export function xeroTarget(tenantName?: string | null): LiveTarget {
  // Xero has no sandbox environment; a Demo Company is still reached through
  // the live API, so this is always treated as live.
  const where = tenantName ? `the Xero organisation "${tenantName}"` : 'your connected Xero organisation';
  return { isLive: true, destination: `${where} (Xero has no sandbox — this is the live API)` };
}

export interface ConfirmationRequired {
  error: string;
  requiresConfirmation: true;
  destination: string;
  invoiceCount: number;
  clients: string[];
}

/**
 * The 428 body for an unconfirmed live publish. Names the destination and every
 * client that would be invoiced, so the confirmation is an informed one rather
 * than a reflex.
 */
export function confirmationRequired(
  target: LiveTarget,
  clients: { name: string }[],
): ConfirmationRequired {
  return {
    error:
      `This would create ${clients.length} invoice${clients.length === 1 ? '' : 's'} in ` +
      `${target.destination}. Re-send with confirmLive: true to proceed.`,
    requiresConfirmation: true,
    destination: target.destination,
    invoiceCount: clients.length,
    clients: clients.map((c) => c.name),
  };
}
