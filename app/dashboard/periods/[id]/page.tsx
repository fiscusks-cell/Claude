'use client';
import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { formatDuration, formatCurrency } from '@/lib/utils';
import { groupCurrencyTotals, formatGroupedAmounts } from '@/lib/currency';
import { format } from 'date-fns';
import { CheckCircle, Clock, AlertCircle, Download } from 'lucide-react';
import { ProjectIconOrDot } from '@/components/ui/ProjectIconOrDot';
import { SiQuickbooks, SiXero } from 'react-icons/si';
import { OriginButton } from '@/components/ui/origin-button';

interface Entry {
  id: string;
  description: string | null;
  startedAt: string;
  stoppedAt: string | null;
  durationSeconds: number | null;
  isBillable: boolean;
  project: { id: string; name: string; color: string; icon?: string | null; hourlyRate: string; client: { name: string; currency: string } | null } | null;
  user: { id: string; name: string };
}

interface Period {
  id: string;
  periodType: string;
  startDate: string;
  endDate: string;
  status: 'OPEN' | 'PENDING_APPROVAL' | 'APPROVED' | 'PUBLISHED';
  qboInvoiceId: string | null;
  xeroInvoiceId: string | null;
  approvedAt: string | null;
  publishedAt: string | null;
  entries: Entry[];
  stats?: { totalEntries: number; totalSeconds: number; totalBillableAmount: number };
  byProject?: Array<{
    projectId: string;
    projectName: string;
    projectColor: string;
    projectIcon: string | null;
    clientName: string | null;
    clientCurrency: string;
    totalSeconds: number;
    billableAmountMinor: number;
    billableAmount: number;
  }>;
}

type StatusKey = Period['status'];

const STATUS_LABEL: Record<StatusKey, { label: string; style: React.CSSProperties }> = {
  OPEN:             { label: 'Open',             style: { background: 'var(--surface-raised)', color: 'var(--text-secondary)' } },
  PENDING_APPROVAL: { label: 'Pending Approval', style: { background: 'rgba(120,53,15,0.4)',   color: '#fcd34d' } },
  APPROVED:         { label: 'Approved',         style: { background: 'rgba(30,58,138,0.4)',   color: '#93c5fd' } },
  PUBLISHED:        { label: 'Published',        style: { background: 'rgba(6,78,59,0.4)',     color: '#6ee7b7' } },
};

export default function PeriodDetailPage() {
  const params = useParams();
  const id = params.id as string;
  const { data: session } = useSession();
  const isAdmin = ['OWNER', 'ADMIN'].includes((session?.user as { role?: string })?.role ?? '');

  const [period, setPeriod] = useState<Period | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [tab, setTab] = useState<'summary' | 'entries'>('summary');
  const [invoiceLoading, setInvoiceLoading] = useState(false);
  const [invoiceGenerated, setInvoiceGenerated] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/periods/${id}`);
    if (res.ok) setPeriod(await res.json());
    setLoading(false);
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const [successMsg, setSuccessMsg] = useState('');

  const doAction = async (url: string, method = 'PATCH') => {
    setActionLoading(true);
    setMessage('');
    setSuccessMsg('');
    const res = await fetch(url, { method });
    const data = await res.json();
    if (!res.ok) {
      setMessage(data.error || data.message || 'Action failed');
    } else {
      if (data.pdfAttached === true) setSuccessMsg('Invoice created + PDF attached');
      else if (data.pdfAttached === false) setSuccessMsg('Invoice created (PDF attachment failed)');
      await load();
    }
    setActionLoading(false);
  };

  const handleGenerateInvoice = async () => {
    setInvoiceLoading(true);
    setMessage('');
    try {
      const res = await fetch(`/api/periods/${id}/generate-invoice`, { method: 'POST' });
      if (!res.ok) {
        const data = await res.json();
        setMessage(data.error || 'Failed to generate invoice');
        return;
      }
      const invNum = res.headers.get('X-Invoice-Number') || 'invoice';
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${invNum}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
      setInvoiceGenerated(invNum);
    } catch {
      setMessage('Failed to generate invoice');
    } finally {
      setInvoiceLoading(false);
    }
  };

  if (loading) return <div className="p-8"><div className="h-32 skeleton rounded-xl" /></div>;
  if (!period) return <div className="p-8" style={{ color: 'var(--text-muted)' }}>Period not found</div>;

  const totalSeconds = period.stats?.totalSeconds ?? (period.entries ?? []).reduce((s, e) => s + (e.durationSeconds || 0), 0);
  const totalAmount = period.stats?.totalBillableAmount ?? 0;
  const s = STATUS_LABEL[period.status];

  return (
    <div className="p-8">
      <div className="mb-8">
        <div className="flex items-start justify-between mb-4">
          <div>
            <div className="text-sm mb-1" style={{ color: 'var(--text-muted)' }}>Billing Period</div>
            <h1 className="text-2xl font-normal" style={{ color: 'var(--text)' }}>
              {format(new Date(period.startDate), 'MMM d')} – {format(new Date(period.endDate), 'MMM d, yyyy')}
            </h1>
          </div>
          <span className="text-xs px-3 py-1.5 rounded-full" style={s.style}>{s.label}</span>
        </div>

        <div className="flex gap-6">
          <div>
            <div className="text-xs" style={{ color: 'var(--text-muted)' }}>Total Hours</div>
            <div className="text-xl tabular-nums" style={{ color: 'var(--text)' }}>{formatDuration(totalSeconds)}</div>
          </div>
          <div>
            <div className="text-xs" style={{ color: 'var(--text-muted)' }}>Billable Amount</div>
            <div className="text-xl" style={{ color: 'var(--text)' }}>{formatGroupedAmounts(groupCurrencyTotals(period.byProject ?? []))}</div>
          </div>
          <div>
            <div className="text-xs" style={{ color: 'var(--text-muted)' }}>Entries</div>
            <div className="text-xl" style={{ color: 'var(--text)' }}>{(period.entries ?? []).length}</div>
          </div>
        </div>
      </div>

      {period.status === 'PUBLISHED' && (
        <div className="bg-emerald-900/20 border border-emerald-800 rounded-xl px-4 py-3 mb-6 flex items-center gap-3">
          <CheckCircle className="w-5 h-5 text-emerald-400 flex-shrink-0" />
          <div className="text-sm text-emerald-300">
            Published {period.publishedAt ? format(new Date(period.publishedAt), 'MMM d, yyyy') : ''}
            {period.qboInvoiceId && <span className="ml-3">· QBO: {period.qboInvoiceId}</span>}
            {period.xeroInvoiceId && (
              <span className="ml-3">
                · <a
                    href={`https://go.xero.com/AccountsReceivable/View.aspx?InvoiceID=${period.xeroInvoiceId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-emerald-300 underline hover:text-emerald-200"
                  >
                    View in Xero
                  </a>
              </span>
            )}
          </div>
        </div>
      )}

      {message && (
        <div className="bg-red-950 border border-red-800 text-red-300 text-sm px-3 py-2 rounded-lg mb-4 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          {message}
        </div>
      )}

      {successMsg && (
        <div className="bg-emerald-950 border border-emerald-800 text-emerald-300 text-sm px-3 py-2 rounded-lg mb-4 flex items-center gap-2">
          <CheckCircle className="w-4 h-4 flex-shrink-0" />
          {successMsg}
        </div>
      )}

      <div className="flex gap-3 mb-8">
        {period.status === 'OPEN' && (
          <OriginButton
            onClick={() => doAction(`/api/periods/${id}/submit`)}
            disabled={actionLoading || (period.entries ?? []).length === 0}
            className="flex items-center gap-2 text-white text-sm px-4 py-2 rounded-lg transition-colors disabled:opacity-50"
            style={{ background: '#d97706' }}
          >
            <Clock className="w-4 h-4" /> Submit for Approval
          </OriginButton>
        )}
        {period.status === 'PENDING_APPROVAL' && isAdmin && (
          <OriginButton
            onClick={() => doAction(`/api/periods/${id}/approve`)}
            disabled={actionLoading}
            className="flex items-center gap-2 text-white text-sm px-4 py-2 rounded-lg transition-colors disabled:opacity-50"
            style={{ background: '#2563eb' }}
          >
            <CheckCircle className="w-4 h-4" /> Approve Period
          </OriginButton>
        )}
        {period.status === 'APPROVED' && isAdmin && (
          <>
            <OriginButton
              onClick={() => doAction(`/api/periods/${id}/publish/qbo`, 'POST')}
              disabled={actionLoading}
              className="flex items-center gap-2 text-white text-sm px-4 py-2 rounded-lg transition-colors disabled:opacity-50"
              style={{ background: '#15803d' }}
            >
              <SiQuickbooks size={16} /> Publish to QuickBooks
            </OriginButton>
            <OriginButton
              onClick={() => doAction(`/api/periods/${id}/publish/xero`, 'POST')}
              disabled={actionLoading}
              className="flex items-center gap-2 text-white text-sm px-4 py-2 rounded-lg transition-colors disabled:opacity-50"
              style={{ background: '#0369a1' }}
            >
              <SiXero size={16} /> Publish to Xero
            </OriginButton>
            <OriginButton
              onClick={handleGenerateInvoice}
              disabled={invoiceLoading}
              className="flex items-center gap-2 text-white text-sm px-4 py-2 rounded-lg transition-colors disabled:opacity-50"
              style={{ background: '#4338ca' }}
            >
              <Download className="w-4 h-4" /> {invoiceLoading ? 'Generating…' : 'Download Invoice PDF'}
            </OriginButton>
          </>
        )}
        {invoiceGenerated && (
          <div className="flex items-center gap-2 text-sm text-emerald-400">
            <CheckCircle className="w-4 h-4" /> {invoiceGenerated} generated
          </div>
        )}
      </div>

      <div className="flex gap-1 mb-6" style={{ borderBottom: '1px solid var(--border)' }}>
        {(['summary', 'entries'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className="px-4 py-2.5 text-sm capitalize transition-colors border-b-2 -mb-px"
            style={
              tab === t
                ? { borderColor: '#6366f1', color: 'var(--text)' }
                : { borderColor: 'transparent', color: 'var(--text-muted)' }
            }
          >
            {t}
          </button>
        ))}
      </div>

      {tab === 'summary' && (
        <div className="space-y-3">
          {(period.byProject ?? []).map((p) => (
            <div
              key={p.projectId}
              className="rounded-xl p-4"
              style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <ProjectIconOrDot icon={p.projectIcon} color={p.projectColor} size={24} dotClassName="w-3 h-3" />
                  <span style={{ color: 'var(--text)' }}>{p.projectName}</span>
                  {p.clientName && <span className="text-xs" style={{ color: 'var(--text-muted)' }}>· {p.clientName}</span>}
                </div>
                <div className="flex gap-6 text-right">
                  <div>
                    <div className="text-xs" style={{ color: 'var(--text-muted)' }}>Hours</div>
                    <div className="text-sm" style={{ color: 'var(--text-secondary)' }}>{formatDuration(p.totalSeconds)}</div>
                  </div>
                  <div>
                    <div className="text-xs" style={{ color: 'var(--text-muted)' }}>Amount</div>
                    <div className="text-sm" style={{ color: 'var(--text)' }}>{formatCurrency(p.billableAmount, p.clientCurrency)}</div>
                  </div>
                </div>
              </div>
            </div>
          ))}
          <div className="flex justify-between items-center pt-4" style={{ borderTop: '1px solid var(--border)' }}>
            <span style={{ color: 'var(--text)' }}>Total</span>
            <div className="flex gap-6">
              <span style={{ color: 'var(--text)' }}>{formatDuration(totalSeconds)}</span>
              <span style={{ color: 'var(--text)' }}>{formatGroupedAmounts(groupCurrencyTotals(period.byProject ?? []))}</span>
            </div>
          </div>
        </div>
      )}

      {tab === 'entries' && (
        <div className="rounded-xl overflow-hidden" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
          {(period.entries ?? []).length === 0 ? (
            <div className="text-center py-8" style={{ color: 'var(--text-muted)' }}>No entries in this period</div>
          ) : (
            <table className="w-full">
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  {['Date', 'Description', 'Project', 'User', 'Duration', 'Billable'].map(h => (
                    <th
                      key={h}
                      className="text-left px-4 py-3 text-xs uppercase tracking-wider"
                      style={{ color: 'var(--text-muted)' }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(period.entries ?? []).map(e => (
                  <tr
                    key={e.id}
                    className="last:border-0"
                    style={{ borderBottom: '1px solid var(--border)' }}
                  >
                    <td className="px-4 py-3 text-sm" style={{ color: 'var(--text-muted)' }}>
                      {format(new Date(e.startedAt), 'MMM d')}
                    </td>
                    <td className="px-4 py-3 text-sm max-w-xs truncate" style={{ color: 'var(--text)' }}>
                      {e.description || <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>—</span>}
                    </td>
                    <td className="px-4 py-3 text-sm" style={{ color: 'var(--text-muted)' }}>
                      {e.project ? (
                        <span className="flex items-center gap-1.5">
                          <ProjectIconOrDot icon={e.project.icon} color={e.project.color} size={20} dotClassName="w-2 h-2" />
                          {e.project.name}
                        </span>
                      ) : '—'}
                    </td>
                    <td className="px-4 py-3 text-sm" style={{ color: 'var(--text-muted)' }}>{e.user.name}</td>
                    <td className="px-4 py-3 text-sm tabular-nums" style={{ color: 'var(--text-secondary)' }}>
                      {formatDuration(e.durationSeconds || 0)}
                    </td>
                    <td className="px-4 py-3 text-sm">
                      {e.isBillable
                        ? <span className="text-emerald-400">Yes</span>
                        : <span style={{ color: 'var(--text-muted)' }}>No</span>
                      }
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
