'use client';

import { useState, useEffect, useCallback } from 'react';
import { Plus, X, ExternalLink } from 'lucide-react';
import Link from 'next/link';
import { format } from 'date-fns';

// ─── types ───────────────────────────────────────────────────────────────────

type PeriodStatus = 'OPEN' | 'PENDING_APPROVAL' | 'APPROVED' | 'PUBLISHED';

interface TimeEntryLite {
  durationSeconds: number | null;
  isBillable: boolean;
  project: { hourlyRate: string } | null;
}

interface Period {
  id: string;
  periodType: string;
  startDate: string;
  endDate: string;
  status: PeriodStatus;
  _count: { entries: number };
  entries: TimeEntryLite[];
}

interface FormState {
  startDate: string;
  endDate: string;
  type: string;
}

// ─── constants ────────────────────────────────────────────────────────────────

const STATUS_STYLES: Record<PeriodStatus, React.CSSProperties> = {
  OPEN:             { background: 'var(--surface-raised)', color: 'var(--text-secondary)' },
  PENDING_APPROVAL: { background: 'rgba(120,53,15,0.4)',   color: '#fcd34d' },
  APPROVED:         { background: 'rgba(30,58,138,0.4)',   color: '#93c5fd' },
  PUBLISHED:        { background: 'rgba(6,78,59,0.4)',     color: '#6ee7b7' },
};

const STATUS_LABELS: Record<PeriodStatus, string> = {
  OPEN: 'Open',
  PENDING_APPROVAL: 'Pending Approval',
  APPROVED: 'Approved',
  PUBLISHED: 'Published',
};

const DEFAULT_FORM: FormState = { startDate: '', endDate: '', type: 'MONTHLY' };

// ─── helpers ──────────────────────────────────────────────────────────────────

function sumSeconds(entries: TimeEntryLite[] | undefined): number {
  return (entries ?? []).reduce((acc, e) => acc + (e.durationSeconds ?? 0), 0);
}

function formatHM(totalSeconds: number): string {
  const totalMinutes = Math.round(totalSeconds / 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${h}:${String(m).padStart(2, '0')}`;
}

function calcBillableAmount(entries: TimeEntryLite[] | undefined): number {
  return (entries ?? [])
    .filter((e) => e.isBillable && e.project?.hourlyRate)
    .reduce((acc, e) => acc + ((e.durationSeconds ?? 0) / 3600) * parseFloat(e.project!.hourlyRate), 0);
}

// ─── page ────────────────────────────────────────────────────────────────────

export default function PeriodsPage() {
  const [periods, setPeriods] = useState<Period[]>([]);
  const [loading, setLoading] = useState(true);
  const [showDialog, setShowDialog] = useState(false);
  const [form, setForm] = useState<FormState>(DEFAULT_FORM);
  const [saving, setSaving] = useState(false);

  const fetchPeriods = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/periods');
      if (res.ok) setPeriods(await res.json());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchPeriods(); }, [fetchPeriods]);

  const handleCreate = async () => {
    if (!form.startDate || !form.endDate) return;
    setSaving(true);
    try {
      const res = await fetch('/api/periods', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          periodType: form.type,
          startDate: new Date(form.startDate).toISOString(),
          endDate: new Date(form.endDate + 'T23:59:59').toISOString(),
        }),
      });
      if (res.ok) {
        await fetchPeriods();
        setShowDialog(false);
        setForm(DEFAULT_FORM);
      }
    } finally {
      setSaving(false);
    }
  };

  const inputStyle: React.CSSProperties = {
    background: 'var(--bg-tertiary)',
    border: '1px solid var(--border)',
    color: 'var(--text)',
  };

  return (
    <div className="p-6 md:p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-normal" style={{ color: 'var(--text)' }}>Reports &amp; Periods</h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--text-muted)' }}>
            Manage billing periods and submit for approval
          </p>
        </div>
        <button
          onClick={() => setShowDialog(true)}
          className="flex items-center gap-2 text-white text-sm px-4 py-2 rounded-lg transition-colors"
          style={{ background: 'var(--accent)' }}
        >
          <Plus className="w-4 h-4" />
          Create Period
        </button>
      </div>

      {/* Content */}
      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-14 animate-pulse rounded-xl" style={{ background: 'var(--surface)' }} />
          ))}
        </div>
      ) : periods.length === 0 ? (
        <div
          className="text-center py-16 rounded-xl"
          style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text-muted)' }}
        >
          No billing periods yet. Create your first period to start the approval workflow.
        </div>
      ) : (
        <div className="rounded-xl overflow-x-auto" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
          <table className="w-full text-sm min-w-[640px]">
            <thead>
              <tr className="text-left" style={{ borderBottom: '1px solid var(--border)' }}>
                {['Date Range', 'Type', 'Status', 'Total Hours', 'Billable Amount', ''].map((h) => (
                  <th
                    key={h}
                    className="px-4 py-3 text-xs uppercase tracking-wider"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {periods.map((p) => {
                const totalSeconds = sumSeconds(p.entries);
                const billable = calcBillableAmount(p.entries);
                return (
                  <tr
                    key={p.id}
                    className="last:border-0 hover:bg-white/5 transition-colors"
                    style={{ borderBottom: '1px solid var(--border)' }}
                  >
                    <td className="px-4 py-3" style={{ color: 'var(--text)' }}>
                      {format(new Date(p.startDate), 'MMM d')} –{' '}
                      {format(new Date(p.endDate), 'MMM d, yyyy')}
                    </td>
                    <td className="px-4 py-3 capitalize" style={{ color: 'var(--text-muted)' }}>
                      {p.periodType.charAt(0) + p.periodType.slice(1).toLowerCase()}
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-xs px-2.5 py-1 rounded" style={STATUS_STYLES[p.status]}>
                        {STATUS_LABELS[p.status]}
                      </span>
                    </td>
                    <td className="px-4 py-3 tabular-nums" style={{ color: 'var(--text-secondary)' }}>
                      {formatHM(totalSeconds)}
                    </td>
                    <td className="px-4 py-3" style={{ color: 'var(--text-secondary)' }}>
                      ${billable.toFixed(2)}
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/dashboard/periods/${p.id}`}
                        className="flex items-center gap-1 text-indigo-400 hover:text-indigo-300 transition-colors text-xs"
                      >
                        View
                        <ExternalLink className="w-3 h-3" />
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Dialog ─────────────────────────────────────────────────────── */}
      {showDialog && (
        <div
          className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4"
          onClick={(e) => { if (e.target === e.currentTarget) setShowDialog(false); }}
        >
          <div
            className="rounded-2xl p-6 w-full max-w-md shadow-2xl"
            style={{ background: 'var(--card)', border: '1px solid var(--border)' }}
          >
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-normal" style={{ color: 'var(--text)' }}>Create Billing Period</h2>
              <button
                onClick={() => setShowDialog(false)}
                className="p-1 rounded transition-colors"
                style={{ color: 'var(--text-muted)' }}
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm mb-1.5" style={{ color: 'var(--text-secondary)' }}>Period type</label>
                <select
                  value={form.type}
                  onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}
                  className="w-full rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  style={{ ...inputStyle, color: 'var(--text-secondary)' }}
                >
                  <option value="WEEKLY">Weekly</option>
                  <option value="BIWEEKLY">Bi-weekly</option>
                  <option value="MONTHLY">Monthly</option>
                  <option value="CUSTOM">Custom</option>
                </select>
              </div>

              <div>
                <label className="block text-sm mb-1.5" style={{ color: 'var(--text-secondary)' }}>
                  Start date <span className="text-red-400">*</span>
                </label>
                <input
                  type="date"
                  value={form.startDate}
                  onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))}
                  className="w-full rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  style={inputStyle}
                />
              </div>

              <div>
                <label className="block text-sm mb-1.5" style={{ color: 'var(--text-secondary)' }}>
                  End date <span className="text-red-400">*</span>
                </label>
                <input
                  type="date"
                  value={form.endDate}
                  min={form.startDate}
                  onChange={(e) => setForm((f) => ({ ...f, endDate: e.target.value }))}
                  className="w-full rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  style={inputStyle}
                />
              </div>
            </div>

            <div className="flex gap-3 mt-6">
              <button
                onClick={() => setShowDialog(false)}
                className="flex-1 py-2.5 rounded-lg text-sm transition-colors"
                style={{ border: '1px solid var(--border)', color: 'var(--text-secondary)' }}
              >
                Cancel
              </button>
              <button
                onClick={handleCreate}
                disabled={!form.startDate || !form.endDate || saving}
                className="flex-1 text-white py-2.5 rounded-lg text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                style={{ background: 'var(--accent)' }}
              >
                {saving ? 'Creating…' : 'Create Period'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
