export const CURRENCIES = [
  { code: 'USD', symbol: '$',    label: '$USD'  },
  { code: 'CAD', symbol: '$CAD', label: '$CAD'  },
  { code: 'AUD', symbol: '$AUD', label: '$AUD'  },
  { code: 'EUR', symbol: '€',    label: '€EUR'  },
  { code: 'JPY', symbol: '¥',    label: '¥JPY'  },
  { code: 'GBP', symbol: '£',    label: '£GBP'  },
  { code: 'CHF', symbol: 'CHF',  label: 'CHF'   },
  { code: 'SGD', symbol: '$SGD', label: '$SGD'  },
] as const;

export type CurrencyCode = (typeof CURRENCIES)[number]['code'];

export const DEFAULT_CURRENCY: CurrencyCode = 'EUR';

export function getCurrency(code: string) {
  return CURRENCIES.find((c) => c.code === code) ?? CURRENCIES[0];
}

// Currencies with no subunit (no decimal places)
const NO_DECIMAL_CURRENCIES = new Set(['JPY']);

// Currencies that use a custom symbol prefix rather than Intl's default
const CUSTOM_FORMAT: Partial<Record<CurrencyCode, (amount: number) => string>> = {
  CAD: (n) => `$CAD ${formatDecimal(n, 2)}`,
  AUD: (n) => `$AUD ${formatDecimal(n, 2)}`,
  CHF: (n) => `CHF ${formatDecimal(n, 2)}`,
  SGD: (n) => `$SGD ${formatDecimal(n, 2)}`,
};

function formatDecimal(amount: number, decimals: number): string {
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(amount);
}

export function formatCurrency(amount: number, currency = 'USD'): string {
  const custom = CUSTOM_FORMAT[currency as CurrencyCode];
  if (custom) return custom(amount);

  const decimals = NO_DECIMAL_CURRENCIES.has(currency) ? 0 : 2;
  const locale = currency === 'JPY' ? 'ja-JP' : 'en-US';
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(amount);
}

export function roundForCurrency(amount: number, currency: string): number {
  return NO_DECIMAL_CURRENCIES.has(currency) ? Math.round(amount) : parseFloat(amount.toFixed(2));
}

// ─── Money in integer minor units ────────────────────────────────────────────
//
// All revenue is computed as whole minor units (cents; yen for JPY) and rounded
// exactly once, at the time entry. Every figure above an entry — description
// group, project, client, report total, invoice line — is an integer sum of
// those leaves, so every level reconciles with every other by construction.
// Amounts in different currencies are never summed together.

export function currencyDecimals(currency: string): number {
  return NO_DECIMAL_CURRENCIES.has(currency) ? 0 : 2;
}

/** Minor units per major unit: 100 for cent currencies, 1 for JPY. */
export function currencyScale(currency: string): number {
  return NO_DECIMAL_CURRENCIES.has(currency) ? 1 : 100;
}

/**
 * Hourly rate as whole hundredths of a major unit. Project.hourlyRate is
 * Decimal(10,2), so this is exact for every rate the schema can store,
 * regardless of the currency's own minor unit.
 */
export function rateToHundredths(rate: unknown): number {
  const n = typeof rate === 'number' ? rate : parseFloat(String(rate ?? 0));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

/**
 * Money for a duration at a rate, in minor units. The single rounding point for
 * all revenue: the duration is never rounded, only the money, once, here.
 * Exact while rateHundredths × seconds stays under 2^53 — a $10,000.00/hr rate
 * would need a ~285-year entry to breach that.
 */
export function amountMinor(seconds: number, rateHundredths: number, currency: string): number {
  if (seconds <= 0 || rateHundredths === 0) return 0;
  // (hundredths of major) × sec ÷ 3600 ÷ (hundredths per minor unit)
  const denom = 3600 * (100 / currencyScale(currency));
  return Math.round((rateHundredths * seconds) / denom);
}

export function fromMinor(minor: number, currency: string): number {
  return minor / currencyScale(currency);
}

export function formatMinor(minor: number, currency: string): string {
  return formatCurrency(fromMinor(minor, currency), currency);
}

/**
 * Largest-remainder apportionment. Returns each value's share of `total` as a
 * percentage with `decimals` places, adjusted so the displayed column sums to
 * exactly the rounded whole (100.0 when the values partition the total) instead
 * of drifting to 99.9 or 100.1.
 */
export function apportionPercents(values: number[], total: number, decimals = 1): number[] {
  const unit = 10 ** decimals;
  if (total <= 0 || values.length === 0) return values.map(() => 0);
  const exact = values.map((v) => (v / total) * 100 * unit);
  const floors = exact.map((e) => Math.floor(e));
  const target = Math.round(exact.reduce((s, e) => s + e, 0));
  let remaining = target - floors.reduce((s, f) => s + f, 0);
  const byRemainder = exact
    .map((e, i) => ({ i, frac: e - Math.floor(e) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  const out = [...floors];
  for (let k = 0; k < byRemainder.length && remaining > 0; k++, remaining--) {
    out[byRemainder[k].i] += 1;
  }
  return out.map((u) => u / unit);
}

export function groupCurrencyTotals(
  rows: { clientCurrency: string; billableAmountMinor: number }[],
): { currency: string; amountMinor: number }[] {
  const map = new Map<string, number>();
  for (const r of rows) {
    map.set(r.clientCurrency, (map.get(r.clientCurrency) ?? 0) + r.billableAmountMinor);
  }
  return [...map.entries()].map(([currency, amountMinor]) => ({ currency, amountMinor }));
}

export function formatGroupedAmounts(totals: { currency: string; amountMinor: number }[]): string {
  const parts = totals
    .filter((t) => t.amountMinor > 0)
    .map((t) => formatMinor(t.amountMinor, t.currency));
  return parts.length > 0 ? parts.join(' · ') : formatCurrency(0);
}
