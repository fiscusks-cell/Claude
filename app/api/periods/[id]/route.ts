import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { amountMinor, fromMinor, rateToHundredths } from '@/lib/currency';
import { analyzePeriodBilling } from '@/lib/period-billing';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const organizationId = (session.user as { organizationId: string }).organizationId;
    const { id } = await params;

    const period = await prisma.timePeriod.findFirst({
      where: { id, organizationId },
      include: {
        entries: {
          include: {
            user: { select: { id: true, name: true, email: true, avatarUrl: true } },
            project: {
              include: {
                client: { select: { id: true, name: true, currency: true } },
              },
            },
          },
          orderBy: { startedAt: 'asc' },
        },
      },
    });

    if (!period) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    // Compute aggregate stats.
    // Money is rounded once per time entry into integer minor units — the same
    // leaf Reports and the invoice routes use — so this page reconciles exactly
    // with the invoice generated from it.
    const totalEntries = period.entries.length;
    const totalSeconds = period.entries.reduce(
      (sum, e) => sum + (e.durationSeconds ?? 0),
      0,
    );

    // Group entries by project
    const projectMap = new Map<
      string,
      {
        projectId: string;
        projectName: string;
        projectColor: string;
        projectIcon: string | null;
        clientName: string | null;
        clientCurrency: string;
        totalSeconds: number;
        billableSeconds: number;
        billableAmountMinor: number;
        entryCount: number;
      }
    >();

    for (const entry of period.entries) {
      const key = entry.projectId ?? '__no_project__';
      const projectName = entry.project?.name ?? 'No Project';
      const projectColor = entry.project?.color ?? '#6B7280';
      const projectIcon = entry.project?.icon ?? null;
      const clientName = entry.project?.client?.name ?? null;
      const clientCurrency = entry.project?.client?.currency ?? 'USD';

      if (!projectMap.has(key)) {
        projectMap.set(key, {
          projectId: key,
          projectName,
          projectColor,
          projectIcon,
          clientName,
          clientCurrency,
          totalSeconds: 0,
          billableSeconds: 0,
          billableAmountMinor: 0,
          entryCount: 0,
        });
      }

      const group = projectMap.get(key)!;
      const seconds = entry.durationSeconds ?? 0;
      group.totalSeconds += seconds;
      group.entryCount += 1;

      if (entry.isBillable && entry.project) {
        group.billableSeconds += seconds;
        group.billableAmountMinor += amountMinor(
          seconds,
          rateToHundredths(entry.project.hourlyRate),
          clientCurrency,
        );
      }
    }

    const byProject = Array.from(projectMap.values()).map((g) => ({
      ...g,
      // Major-unit convenience value, derived from the integer sum — display only.
      billableAmount: fromMinor(g.billableAmountMinor, g.clientCurrency),
    }));

    // Whether this period can become one invoice, so the review screen can say
    // so before anyone reaches a publish button rather than after a 409.
    const billing = analyzePeriodBilling(period.entries);

    return NextResponse.json({
      ...period,
      billing,
      stats: {
        totalEntries,
        totalSeconds,
        // Legacy: a cross-currency sum, only meaningful for single-currency periods.
        totalBillableAmount: byProject.reduce((s, g) => s + g.billableAmount, 0),
      },
      byProject,
    });
  } catch (err) {
    console.error('[periods/:id GET] error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
