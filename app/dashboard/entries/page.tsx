'use client';
import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Check, X, Play, MoreVertical, Pencil, Trash2 } from 'lucide-react';
import { ProjectIconOrDot } from '@/components/ui/ProjectIconOrDot';
import { format, startOfWeek, endOfWeek, subWeeks } from 'date-fns';

// ─── types ────────────────────────────────────────────────────────────────────

interface Entry {
  id: string;
  description: string | null;
  startedAt: string;
  stoppedAt: string | null;
  durationSeconds: number | null;
  isBillable: boolean;
  project: {
    id: string;
    name: string;
    color: string;
    icon?: string | null;
    hourlyRate: number | string;
    client?: { name: string } | null;
  } | null;
  user: { name: string };
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function fmtHM(s: number): string {
  const totalMinutes = Math.round(s / 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${h}:${String(m).padStart(2, '0')}`;
}

function fmtTime(iso: string): string {
  return format(new Date(iso), 'HH:mm');
}

function calcAmount(e: Entry): number | null {
  if (!e.isBillable || !e.project?.hourlyRate || !e.durationSeconds) return null;
  return (e.durationSeconds / 3600) * parseFloat(String(e.project.hourlyRate));
}

function weekKey(date: Date): string {
  return format(startOfWeek(date, { weekStartsOn: 1 }), 'yyyy-MM-dd');
}

function weekLabel(weekStartDate: Date): string {
  const now = new Date();
  const thisStart = startOfWeek(now, { weekStartsOn: 1 });
  const lastStart = subWeeks(thisStart, 1);
  if (+weekStartDate >= +thisStart) return 'This week';
  if (+weekStartDate >= +lastStart) return 'Last week';
  const weekEnd = endOfWeek(weekStartDate, { weekStartsOn: 1 });
  return `${format(weekStartDate, 'MMM d')} – ${format(weekEnd, 'MMM d, yyyy')}`;
}

// ─── row ─────────────────────────────────────────────────────────────────────

function EntryRow({
  entry,
  editId,
  editDesc,
  openMenuId,
  onEdit,
  onSave,
  onCancelEdit,
  onEditDescChange,
  onDelete,
  onPlay,
  onMenuToggle,
}: {
  entry: Entry;
  editId: string | null;
  editDesc: string;
  openMenuId: string | null;
  onEdit: (e: Entry) => void;
  onSave: (id: string) => void;
  onCancelEdit: () => void;
  onEditDescChange: (v: string) => void;
  onDelete: (id: string) => void;
  onPlay: (e: Entry) => void;
  onMenuToggle: (id: string) => void;
}) {
  const isEditing = editId === entry.id;
  const menuOpen = openMenuId === entry.id;
  const amount = calcAmount(entry);

  return (
    <div className="group flex items-center gap-3 py-2.5 border-b last:border-0" style={{ borderColor: 'var(--border)' }}>
      <ProjectIconOrDot icon={entry.project?.icon} color={entry.project?.color ?? '#4b5563'} size={20} dotClassName="w-2 h-2 mt-0.5" />

      {/* description + project/client — grows to fill */}
      <div className="flex-1 min-w-0">
        {isEditing ? (
          <input
            autoFocus
            value={editDesc}
            onChange={(e) => onEditDescChange(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') onSave(entry.id); if (e.key === 'Escape') onCancelEdit(); }}
            className="w-full text-sm rounded px-2 py-1 focus:outline-none focus:ring-2"
            style={{ background: 'var(--surface-raised)', border: '1px solid var(--border)', color: 'var(--text)', ['--tw-ring-color' as string]: 'var(--accent)' }}
          />
        ) : (
          <span className="text-sm truncate block" style={{ color: 'var(--text)' }}>
            {entry.description ?? <em style={{ color: 'var(--text-muted)' }}>No description</em>}
          </span>
        )}
        {entry.project && (
          <span className="text-xs truncate block" style={{ color: 'var(--text-muted)' }}>
            {entry.project.name}
            {entry.project.client?.name && ` — ${entry.project.client.name}`}
          </span>
        )}
      </div>

      {/* time range — hidden on mobile */}
      <span className="text-xs tabular-nums hidden md:block flex-shrink-0" style={{ color: 'var(--text-secondary)' }}>
        {fmtTime(entry.startedAt)}–{entry.stoppedAt ? fmtTime(entry.stoppedAt) : '?'}
      </span>

      {/* duration */}
      <span className="text-sm tabular-nums w-14 text-right flex-shrink-0" style={{ color: 'var(--text-secondary)' }}>
        {fmtHM(entry.durationSeconds ?? 0)}
      </span>

      {/* billable amount */}
      <span className="text-sm tabular-nums w-20 text-right flex-shrink-0" style={{ color: amount != null ? 'var(--text-secondary)' : 'var(--text-muted)' }}>
        {amount != null ? `$${amount.toFixed(2)}` : '—'}
      </span>

      {/* actions */}
      <div className="flex items-center gap-0.5 flex-shrink-0">
        {isEditing ? (
          <>
            <button onClick={() => onSave(entry.id)} className="p-1.5 rounded transition-colors" style={{ color: 'var(--accent)' }} title="Save">
              <Check className="w-4 h-4" />
            </button>
            <button onClick={onCancelEdit} className="p-1.5 rounded transition-colors" style={{ color: 'var(--text-muted)' }} title="Cancel">
              <X className="w-4 h-4" />
            </button>
          </>
        ) : (
          <>
            {/* play — visible on hover */}
            <button
              onClick={() => onPlay(entry)}
              title="Restart"
              className="p-1.5 rounded transition-colors opacity-0 group-hover:opacity-100"
              style={{ color: 'var(--text-muted)' }}
            >
              <Play className="w-3.5 h-3.5" />
            </button>

            {/* ⋮ menu */}
            <div className="relative" data-menu="true">
              <button
                onClick={() => onMenuToggle(entry.id)}
                title="More"
                className="p-1.5 rounded transition-colors opacity-0 group-hover:opacity-100"
                style={{ color: 'var(--text-muted)' }}
              >
                <MoreVertical className="w-3.5 h-3.5" />
              </button>

              {menuOpen && (
                <div
                  className="absolute right-0 mt-1 w-36 rounded-lg shadow-xl z-30 overflow-hidden"
                  style={{ background: 'var(--surface-raised)', border: '1px solid var(--border)' }}
                >
                  <button
                    onClick={() => { onEdit(entry); onMenuToggle(entry.id); }}
                    className="flex items-center gap-2 w-full px-3 py-2 text-sm transition-colors text-left"
                    style={{ color: 'var(--text-secondary)' }}
                  >
                    <Pencil className="w-3.5 h-3.5" /> Edit
                  </button>
                  <button
                    onClick={() => { onDelete(entry.id); onMenuToggle(entry.id); }}
                    className="flex items-center gap-2 w-full px-3 py-2 text-sm transition-colors text-left hover:text-red-400"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    <Trash2 className="w-3.5 h-3.5" /> Delete
                  </button>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── page ─────────────────────────────────────────────────────────────────────

export default function EntriesPage() {
  const router = useRouter();
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [editId, setEditId] = useState<string | null>(null);
  const [editDesc, setEditDesc] = useState('');
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch('/api/time-entries');
    if (res.ok) setEntries(await res.json());
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // close ⋮ menu on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (!(e.target as Element).closest('[data-menu]')) setOpenMenuId(null);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this time entry?')) return;
    await fetch(`/api/time-entries/${id}`, { method: 'DELETE' });
    setEntries((prev) => prev.filter((e) => e.id !== id));
  };

  const handleEdit = (e: Entry) => { setEditId(e.id); setEditDesc(e.description ?? ''); };
  const handleCancelEdit = () => setEditId(null);

  const handleSave = async (id: string) => {
    await fetch(`/api/time-entries/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: editDesc || null }),
    });
    setEntries((prev) => prev.map((e) => (e.id === id ? { ...e, description: editDesc || null } : e)));
    setEditId(null);
  };

  const handlePlay = async (entry: Entry) => {
    await fetch('/api/time-entries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        startedAt: new Date().toISOString(),
        description: entry.description ?? undefined,
        projectId: entry.project?.id ?? undefined,
        isBillable: entry.isBillable,
      }),
    });
    router.push('/dashboard/timer');
  };

  // ── grouping: week → day → entries ───────────────────────────────────────

  const completed = entries.filter((e) => e.stoppedAt);

  // Build ordered week groups (newest first)
  const weekMap = new Map<string, { label: string; start: Date; entries: Entry[] }>();
  for (const e of completed) {
    const d = new Date(e.startedAt);
    const k = weekKey(d);
    if (!weekMap.has(k)) {
      const start = startOfWeek(d, { weekStartsOn: 1 });
      weekMap.set(k, { label: weekLabel(start), start, entries: [] });
    }
    weekMap.get(k)!.entries.push(e);
  }
  const weeks = Array.from(weekMap.entries())
    .sort(([a], [b]) => b.localeCompare(a));

  return (
    <div className="p-6 md:p-8">
      <h1 className="text-2xl font-normal mb-8" style={{ color: 'var(--text)' }}>Time Entries</h1>

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-10 rounded-lg skeleton" />
          ))}
        </div>
      ) : weeks.length === 0 ? (
        <p className="text-center py-16 text-sm" style={{ color: 'var(--text-muted)' }}>
          No time entries yet. Start tracking from the Timer page.
        </p>
      ) : (
        <div className="space-y-8">
          {weeks.map(([wk, { label, entries: wEntries }]) => {
            const weekTotal = wEntries.reduce((s, e) => s + (e.durationSeconds ?? 0), 0);
            const weekAmount = wEntries.reduce((s, e) => {
              const a = calcAmount(e);
              return s + (a ?? 0);
            }, 0);

            // Group this week's entries by day
            const dayMap = new Map<string, Entry[]>();
            for (const e of wEntries) {
              const dk = format(new Date(e.startedAt), 'yyyy-MM-dd');
              if (!dayMap.has(dk)) dayMap.set(dk, []);
              dayMap.get(dk)!.push(e);
            }
            const days = Array.from(dayMap.entries()).sort(([a], [b]) => b.localeCompare(a));

            return (
              <section key={wk}>
                {/* Week header */}
                <div className="flex items-center justify-between py-2 mb-1 border-b-2" style={{ borderColor: 'var(--border)' }}>
                  <span className="text-sm uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
                    {label}
                  </span>
                  <div className="flex items-center gap-4 text-sm" style={{ color: 'var(--text-secondary)' }}>
                    {weekAmount > 0 && (
                      <span className="tabular-nums">${weekAmount.toFixed(2)}</span>
                    )}
                    <span className="tabular-nums">{fmtHM(weekTotal)}</span>
                  </div>
                </div>

                {/* Days within this week */}
                <div className="space-y-4">
                  {days.map(([dk, dayEntries]) => {
                    const dayTotal = dayEntries.reduce((s, e) => s + (e.durationSeconds ?? 0), 0);
                    return (
                      <div key={dk}>
                        {/* Day sub-header */}
                        <div className="flex items-center justify-between py-1.5 mb-0.5">
                          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                            {format(new Date(dk), 'EEEE, MMMM d')}
                          </span>
                          <span className="text-xs tabular-nums" style={{ color: 'var(--text-muted)' }}>
                            {fmtHM(dayTotal)}
                          </span>
                        </div>

                        {/* Entry rows */}
                        <div>
                          {dayEntries.map((e) => (
                            <EntryRow
                              key={e.id}
                              entry={e}
                              editId={editId}
                              editDesc={editDesc}
                              openMenuId={openMenuId}
                              onEdit={handleEdit}
                              onSave={handleSave}
                              onCancelEdit={handleCancelEdit}
                              onEditDescChange={setEditDesc}
                              onDelete={handleDelete}
                              onPlay={handlePlay}
                              onMenuToggle={(id) => setOpenMenuId((prev) => (prev === id ? null : id))}
                            />
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
