// ─── Period billing eligibility ──────────────────────────────────────────────
//
// One invoice is one document for one customer in one currency. A TimePeriod is
// an org-wide date bucket that can hold work for any number of clients, so a
// period is only invoiceable when every billable entry in it resolves to the
// same client. Anything else is refused rather than resolved by picking a
// winner — the previous behaviour stamped the first entry's client and currency
// onto every line, silently mislabelling the rest.
//
// This is the single source of truth for that rule: the three publish/invoice
// routes enforce it, and the period detail screen renders it so the conflict is
// visible before anyone reaches a button.

export interface BillingEntryLike {
  isBillable: boolean;
  durationSeconds: number | null;
  project: { client: { id: string; name: string; currency: string } | null } | null;
}

export interface BillingClient {
  id: string | null; // null = billable work on a project with no client
  name: string;
  currency: string | null;
  seconds: number;
}

export type BillingConflictKind =
  | 'no_billable_entries'
  | 'multiple_clients'
  | 'no_client';

export interface PeriodBilling {
  clients: BillingClient[]; // most hours first
  currencies: string[]; // distinct, sorted
  /** The one currency every line is in, or null when the period is not invoiceable. */
  currency: string | null;
  /** The one client to bill, or null when the period is not invoiceable. */
  client: BillingClient | null;
  invoiceable: boolean;
  conflict: { kind: BillingConflictKind; message: string } | null;
}

/** Only billable entries with real duration reach an invoice. */
function billableOnly<T extends BillingEntryLike>(entries: T[]): T[] {
  return entries.filter((e) => e.isBillable && (e.durationSeconds ?? 0) > 0);
}

const NO_CLIENT = '(no client)';

function describe(c: BillingClient): string {
  const hours = (c.seconds / 3600).toFixed(2);
  return c.currency ? `${c.name} [${c.currency}] ${hours}h` : `${c.name} ${hours}h`;
}

export function analyzePeriodBilling(entries: BillingEntryLike[]): PeriodBilling {
  const billable = billableOnly(entries);

  const map = new Map<string, BillingClient>();
  for (const e of billable) {
    const c = e.project?.client ?? null;
    const key = c?.id ?? '__no_client__';
    const row = map.get(key) ?? {
      id: c?.id ?? null,
      name: c?.name ?? NO_CLIENT,
      currency: c?.currency ?? null,
      seconds: 0,
    };
    row.seconds += e.durationSeconds ?? 0;
    map.set(key, row);
  }

  const clients = [...map.values()].sort((a, b) => b.seconds - a.seconds);
  const currencies = [...new Set(clients.map((c) => c.currency).filter((c): c is string => !!c))].sort();

  const notInvoiceable = (kind: BillingConflictKind, message: string): PeriodBilling => ({
    clients, currencies, currency: null, client: null, invoiceable: false,
    conflict: { kind, message },
  });

  if (clients.length === 0) {
    return notInvoiceable(
      'no_billable_entries',
      'This period has no billable entries, so there is nothing to invoice. Mark the entries billable, or add time to the period, before invoicing.',
    );
  }

  if (clients.length > 1) {
    // Name the conflict in full: which clients, which currencies, how much work.
    const shown = clients.slice(0, 6).map(describe).join('; ');
    const rest = clients.length > 6 ? `; and ${clients.length - 6} more` : '';
    const currencyPart =
      currencies.length > 1
        ? ` in ${currencies.length} currencies (${currencies.join(', ')})`
        : currencies.length === 1
          ? ` (all ${currencies[0]})`
          : '';
    return notInvoiceable(
      'multiple_clients',
      `This period spans ${clients.length} clients${currencyPart} and cannot be invoiced as one document — ` +
        `an invoice bills one client in one currency. Work in this period: ${shown}${rest}. ` +
        'Per-client invoicing (one invoice per client from a single period) is not built yet; ' +
        'until it lands, invoice from a period whose entries all belong to one client.',
    );
  }

  const only = clients[0];
  if (!only.id || !only.currency) {
    return notInvoiceable(
      'no_client',
      `The billable work in this period (${(only.seconds / 3600).toFixed(2)}h) is on a project with no client, ` +
        'so there is no customer to invoice and no currency to bill in. Assign the project to a client, then invoice.',
    );
  }

  return {
    clients,
    currencies,
    currency: only.currency,
    client: only,
    invoiceable: true,
    conflict: null,
  };
}
