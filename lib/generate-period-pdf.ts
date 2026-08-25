import { renderToBuffer } from '@react-pdf/renderer';
import { PeriodReport } from '@/components/reports/PeriodReport';
import { createElement } from 'react';

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

  const projectMap = new Map<string, { projectName: string; currency: string; hours: number; rate: number; subtotal: number }>();

  for (const entry of period.entries) {
    if (!entry.isBillable) continue;
    const key = entry.projectId ?? entry.project?.name ?? '__none__';
    const rate = entry.project ? parseFloat(String(entry.project.hourlyRate)) : 0;
    const hours = (entry.durationSeconds ?? 0) / 3600;
    const currency = entry.project?.client?.currency ?? 'USD';

    if (!projectMap.has(key)) {
      projectMap.set(key, {
        projectName: entry.project?.name ?? 'No Project',
        currency,
        hours: 0,
        rate,
        subtotal: 0,
      });
    }

    const p = projectMap.get(key)!;
    p.hours += hours;
    p.subtotal += hours * rate;
  }

  const projectSummaries = Array.from(projectMap.values());

  const currencyMap = new Map<string, number>();
  for (const p of projectSummaries) {
    currencyMap.set(p.currency, (currencyMap.get(p.currency) ?? 0) + p.subtotal);
  }
  const currencyTotals = [...currencyMap.entries()].map(([currency, amount]) => ({ currency, amount }));

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
