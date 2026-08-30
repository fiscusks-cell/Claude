import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { redirect } from 'next/navigation';
import { ProjectIconOrDot } from '@/components/ui/ProjectIconOrDot';
import {
  startOfDay,
  endOfDay,
  startOfWeek,
  endOfWeek,
  startOfMonth,
  endOfMonth,
  subWeeks,
  format,
} from 'date-fns';

// ─── helpers ────────────────────────────────────────────────────────────────

function sumSeconds(
  entries: { startedAt: Date; stoppedAt: Date | null; durationSeconds: number | null }[]
): number {
  return entries.reduce((acc, e) => {
    if (e.durationSeconds != null) return acc + e.durationSeconds;
    if (e.stoppedAt) return acc + Math.round((e.stoppedAt.getTime() - e.startedAt.getTime()) / 1000);
    return acc;
  }, 0);
}

function formatHM(totalSeconds: number): string {
  const totalMinutes = Math.round(totalSeconds / 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${h}:${String(m).padStart(2, '0')}`;
}

function formatCurrency(amount: number, currency = 'USD'): string {
  const locale = currency === 'JPY' ? 'ja-JP' : 'en-US';
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(amount);
}

// ─── stat card ───────────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  sub,
  highlight,
}: {
  label: string;
  value: string;
  sub?: string;
  highlight?: boolean;
}) {
  return (
    <div
      className="rounded-xl p-5"
      style={
        highlight
          ? { background: 'rgba(6,78,59,0.25)', border: '1px solid #065f46' }
          : { background: 'var(--surface)', border: '1px solid var(--border)' }
      }
    >
      <p className="text-xs uppercase tracking-wider mb-2" style={{ color: 'var(--text-muted)' }}>{label}</p>
      <p className="text-3xl tabular-nums" style={{ color: highlight ? '#34d399' : 'var(--text)' }}>
        {value}
      </p>
      {sub && <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>{sub}</p>}
    </div>
  );
}

// ─── page ────────────────────────────────────────────────────────────────────

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user) redirect('/auth/signin');

  const sessionUser = session.user as {
    id: string;
    name?: string | null;
    email?: string | null;
    role: string;
    organizationId: string;
  };

  const now = new Date();
  const todayStart = startOfDay(now);
  const todayEnd = endOfDay(now);
  const weekStart = startOfWeek(now, { weekStartsOn: 1 });
  const weekEnd = endOfWeek(now, { weekStartsOn: 1 });
  const lastWeekStart = startOfWeek(subWeeks(now, 1), { weekStartsOn: 1 });
  const lastWeekEnd = endOfWeek(subWeeks(now, 1), { weekStartsOn: 1 });
  const monthStart = startOfMonth(now);
  const monthEnd = endOfMonth(now);

  const [
    todayEntries,
    weekEntries,
    lastWeekEntries,
    monthBillableEntries,
    activeEntry,
    recentEntries,
  ] = await Promise.all([
    prisma.timeEntry.findMany({
      where: {
        userId: sessionUser.id,
        startedAt: { gte: todayStart, lte: todayEnd },
        stoppedAt: { not: null },
      },
    }),
    prisma.timeEntry.findMany({
      where: {
        userId: sessionUser.id,
        startedAt: { gte: weekStart, lte: weekEnd },
        stoppedAt: { not: null },
      },
    }),
    prisma.timeEntry.findMany({
      where: {
        userId: sessionUser.id,
        startedAt: { gte: lastWeekStart, lte: lastWeekEnd },
        stoppedAt: { not: null },
      },
    }),
    prisma.timeEntry.findMany({
      where: {
        userId: sessionUser.id,
        startedAt: { gte: monthStart, lte: monthEnd },
        stoppedAt: { not: null },
        isBillable: true,
      },
      include: { project: true },
    }),
    prisma.timeEntry.findFirst({
      where: { userId: sessionUser.id, stoppedAt: null },
    }),
    prisma.timeEntry.findMany({
      where: { userId: sessionUser.id, stoppedAt: { not: null } },
      orderBy: { startedAt: 'desc' },
      take: 10,
      include: { project: { include: { client: true } } },
    }),
  ]);

  // Compute totals
  const todaySeconds = sumSeconds(todayEntries);
  const weekSeconds = sumSeconds(weekEntries);
  const lastWeekSeconds = sumSeconds(lastWeekEntries);

  const monthBillable = monthBillableEntries.reduce((acc, e) => {
    const seconds = e.durationSeconds ?? (e.stoppedAt ? Math.round((e.stoppedAt.getTime() - e.startedAt.getTime()) / 1000) : 0);
    const rate = e.project ? Number(e.project.hourlyRate) : 0;
    return acc + (seconds / 3600) * rate;
  }, 0);

  // Greeting
  const hour = now.getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const firstName = sessionUser.name?.split(' ')[0] ?? sessionUser.email ?? 'there';

  // Group recent entries by date
  const byDate: Record<string, typeof recentEntries> = {};
  for (const entry of recentEntries) {
    const key = format(entry.startedAt, 'yyyy-MM-dd');
    if (!byDate[key]) byDate[key] = [];
    byDate[key].push(entry);
  }

  return (
    <div className="p-6 md:p-8 space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-normal" style={{ color: 'var(--text)' }}>
          {greeting}, {firstName}
        </h1>
        <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>Here&apos;s your time tracking overview.</p>
      </div>

      {/* Active timer banner */}
      {activeEntry && (
        <div className="flex items-center gap-3 bg-amber-950 border border-amber-800 rounded-xl px-5 py-4">
          <span className="w-2.5 h-2.5 rounded-full bg-amber-400 animate-pulse flex-shrink-0" />
          <div>
            <p className="text-sm text-amber-300">Timer is running</p>
            <p className="text-xs text-amber-500">
              Started at {format(activeEntry.startedAt, 'h:mm a')} ·{' '}
              <a href="/dashboard/timer" className="underline underline-offset-2 hover:text-amber-300">
                Go to timer →
              </a>
            </p>
          </div>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Today" value={formatHM(todaySeconds)} />
        <StatCard label="This week" value={formatHM(weekSeconds)} />
        <StatCard label="Last week" value={formatHM(lastWeekSeconds)} />
        <StatCard
          label="Month billable"
          value={formatCurrency(monthBillable)}
          highlight
        />
      </div>

      {/* Recent entries */}
      <div>
        <h2 className="text-sm uppercase tracking-wider mb-4" style={{ color: 'var(--text-muted)' }}>
          Recent entries
        </h2>

        {Object.keys(byDate).length === 0 ? (
          <div
            className="rounded-xl p-12 text-center"
            style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
          >
            <p style={{ color: 'var(--text-muted)' }}>
              No time entries yet.{' '}
              <a href="/dashboard/timer" className="text-indigo-400 hover:text-indigo-300 underline">
                Start the timer
              </a>{' '}
              to track your first entry.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {Object.entries(byDate).map(([dateKey, entries]) => {
              const dayTotal = sumSeconds(entries);
              return (
                <div
                  key={dateKey}
                  className="rounded-xl overflow-hidden"
                  style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
                >
                  {/* Date header */}
                  <div
                    className="flex items-center justify-between px-5 py-3"
                    style={{ borderBottom: '1px solid var(--border)', background: 'var(--surface-raised)' }}
                  >
                    <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                      {format(new Date(dateKey + 'T12:00:00'), 'EEEE, MMMM d')}
                    </span>
                    <span className="text-sm tabular-nums" style={{ color: 'var(--text-muted)' }}>
                      {formatHM(dayTotal)}
                    </span>
                  </div>

                  {/* Entry rows */}
                  {entries.map((entry) => {
                    const entrySeconds =
                      entry.durationSeconds ??
                      (entry.stoppedAt
                        ? Math.round((entry.stoppedAt.getTime() - entry.startedAt.getTime()) / 1000)
                        : 0);

                    return (
                      <div
                        key={entry.id}
                        className="flex items-center gap-4 px-5 py-3 last:border-0 hover:bg-white/5 transition-colors"
                        style={{ borderBottom: '1px solid var(--border)' }}
                      >
                        {entry.project
                          ? <ProjectIconOrDot icon={entry.project.icon} color={entry.project.color} size={20} dotClassName="w-2 h-2" />
                          : <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: 'var(--text-muted)' }} />
                        }

                        {/* Description + project */}
                        <div className="flex-1 min-w-0">
                          <p className="text-sm truncate" style={{ color: 'var(--text)' }}>
                            {entry.description ? (
                              entry.description
                            ) : (
                              <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>No description</span>
                            )}
                          </p>
                          {entry.project && (
                            <p className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>
                              {entry.project.name}
                              {entry.project.client ? ` · ${entry.project.client.name}` : ''}
                            </p>
                          )}
                        </div>

                        {/* Time range */}
                        <span className="text-xs hidden sm:block flex-shrink-0" style={{ color: 'var(--text-muted)' }}>
                          {format(entry.startedAt, 'HH:mm')}
                          {entry.stoppedAt ? ` – ${format(entry.stoppedAt, 'HH:mm')}` : ''}
                        </span>

                        {/* Duration */}
                        <span className="text-sm tabular-nums flex-shrink-0" style={{ color: 'var(--text-secondary)' }}>
                          {formatHM(entrySeconds)}
                        </span>

                        {/* Billable badge */}
                        {entry.isBillable && (
                          <span
                            className="text-xs px-1.5 py-0.5 rounded flex-shrink-0 hidden sm:block"
                            style={{ background: 'rgba(52,211,153,0.15)', color: '#34d399' }}
                          >
                            $
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
