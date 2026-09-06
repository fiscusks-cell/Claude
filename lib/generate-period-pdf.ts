import { renderToBuffer } from '@react-pdf/renderer';
import { PeriodReport } from '@/components/reports/PeriodReport';
import { createElement } from 'react';
import { amountMinor, fromMinor, rateToHundredths } from '@/lib/currency';

interface PeriodEntry {
  id: string;
  description: string | null;
  startedAt: Date;
  durationSeconds: number | null;
  isBillable: boolean;
  user: { name: string };
  project: { name: string; hourlyRate: any; client?: { name?: string; currency?: string } | null } | null;
  projectId?: string | null;
}

interface PeriodData {
  id: string;
  startDate: Date;
  endDate: Date;
  status: string;
  entries: PeriodEntry[];
  organization?: { name: string };
}

export async function generatePeriodPdf(period: PeriodData, orgName?: string): Promise<Buffer> {
  const resolvedOrgName = orgName ?? period.organization?.name ?? 'ORA';

  // Money is rounded once per time entry into integer minor units — the same
  // leaf the Reports aggregation and invoice totals use — so this attachment
  // reconciles exactly with the invoice it accompanies. Totals are summed per
  // currency, never across currencies.
  const projectMap = new Map<
    string,
    { projectName: string; currency: string; seconds: number; rateHundredths: number; minor: number }
  >();

  for (const entry of period.entries) {
    if (!entry.isBillable) continue;
    const key = entry.projectId ?? entry.project?.name ?? '__none__';
    const rateHundredths = entry.project ? rateToHundredths(entry.project.hourlyRate) : 0;
    const secs = entry.durationSeconds ?? 0;
    const currency = entry.project?.client?.currency ?? 'USD';

    if (!projectMap.has(key)) {
      projectMap.set(key, {
        projectName: entry.project?.name ?? 'No Project',
        currency,
        seconds: 0,
        rateHundredths,
        minor: 0,
      });
    }

    const p = projectMap.get(key)!;
    p.seconds += secs;
    p.minor += amountMinor(secs, rateHundredths, currency);
  }

  const projectSummaries = Array.from(projectMap.values()).map((p) => ({
    projectName: p.projectName,
    currency: p.currency,
    hours: p.seconds / 3600,
    rate: p.rateHundredths / 100,
    subtotal: fromMinor(p.minor, p.currency),
  }));

  const currencyMinor = new Map<string, number>();
  for (const p of projectMap.values()) {
    currencyMinor.set(p.currency, (currencyMinor.get(p.currency) ?? 0) + p.minor);
  }
  const currencyTotals = [...currencyMinor.entries()].map(([currency, minor]) => ({
    currency,
    amount: fromMinor(minor, currency),
  }));

  const totalSeconds = period.entries.reduce((s, e) => s + (e.durationSeconds ?? 0), 0);

  const doc = createElement(PeriodReport, {
    orgName: resolvedOrgName,
    periodStart: period.startDate,
    periodEnd: period.endDate,
    status: period.status,
    entries: period.entries as any[],
    projectSummaries,
    totalSeconds,
    currencyTotals,
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const buffer = await renderToBuffer(doc as any);
  return Buffer.from(buffer);
}
