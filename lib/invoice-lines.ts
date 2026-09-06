// ─── Invoice line construction ───────────────────────────────────────────────
//
// One place where a set of time entries becomes invoice lines, shared by the
// PDF invoice, the QuickBooks payload and the Xero payload so the three cannot
// drift apart.
//
// Money follows the rule established for reports: rounded exactly once per time
// entry into integer minor units, with every total an integer sum of those
// leaves. Each product line additionally foots against its own hours × rate, so
// a client multiplying the printed figures gets the printed amount; the small
// residual between that and the per-entry sum is disclosed as its own line
// rather than hidden inside a product line.

import { amountMinor, rateToHundredths } from '@/lib/currency';

export interface LineEntryLike {
  isBillable: boolean;
  durationSeconds: number | null;
  projectId: string | null;
  project: {
    id: string;
    name: string;
    hourlyRate: unknown;
    client: { id: string; name: string; currency: string } | null;
  } | null;
}

export interface ProjectLine {
  key: string;
  projectName: string;
  /** This line's own client's currency — never inherited from a sibling line. */
  currency: string;
  seconds: number;
  rateHundredths: number;
  /** Σ per-entry minor units: what the report shows for this project. */
  entrySumMinor: number;
  /** round(hours × rate): what the printed line foots to. */
  lineFootMinor: number;
}

export interface InvoiceComposition {
  lines: ProjectLine[];
  /** Σ per-entry minor units across all lines — the authoritative invoice total. */
  totalMinor: number;
  /** Σ of the printed line amounts. */
  linesMinor: number;
  /** totalMinor − linesMinor; goes on its own disclosed line when non-zero. */
  adjustmentMinor: number;
  currency: string;
}

export const ROUNDING_ADJUSTMENT_LABEL = 'Rounding adjustment';

/** Hours at the precision that makes qty × rate reproduce the printed amount. */
export function hoursOf(seconds: number): number {
  return parseFloat((seconds / 3600).toFixed(6));
}

export function composeInvoice(
  entries: LineEntryLike[],
  fallbackCurrency = 'USD',
): InvoiceComposition {
  const byProject = new Map<string, ProjectLine>();

  for (const entry of entries) {
    if (!entry.isBillable) continue;
    const key = entry.projectId ?? '__no_project__';
    const seconds = entry.durationSeconds ?? 0;
    const rateHundredths = entry.project ? rateToHundredths(entry.project.hourlyRate) : 0;
    const currency = (entry.project?.client?.currency ?? fallbackCurrency).toUpperCase();

    if (!byProject.has(key)) {
      byProject.set(key, {
        key,
        projectName: entry.project?.name ?? 'Time',
        currency,
        seconds: 0,
        rateHundredths,
        entrySumMinor: 0,
        lineFootMinor: 0,
      });
    }
    const line = byProject.get(key)!;
    line.seconds += seconds;
    line.entrySumMinor += amountMinor(seconds, rateHundredths, currency);
  }

  const lines = [...byProject.values()];
  for (const line of lines) {
    line.lineFootMinor = amountMinor(line.seconds, line.rateHundredths, line.currency);
  }

  const totalMinor = lines.reduce((s, l) => s + l.entrySumMinor, 0);
  const linesMinor = lines.reduce((s, l) => s + l.lineFootMinor, 0);

  return {
    lines,
    totalMinor,
    linesMinor,
    adjustmentMinor: totalMinor - linesMinor,
    currency: lines[0]?.currency ?? fallbackCurrency.toUpperCase(),
  };
}
