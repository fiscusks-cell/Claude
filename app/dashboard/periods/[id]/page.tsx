'use client';
import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { formatDuration, formatCurrency } from '@/lib/utils';
import { groupCurrencyTotals, formatGroupedAmounts } from '@/lib/currency';
import { format } from 'date-fns';
import { CheckCircle, Clock, AlertCircle } from 'lucide-react';
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
  billing?: {
    clients: { id: string | null; name: string; currency: string | null; seconds: number }[];
    currencies: string[];
    currency: string | null;
    invoiceable: boolean;
    conflict: { kind: string; message: string } | null;
  };
  clientRows?: ClientRow[];
  publishState?: 'nothing_to_invoice' | 'unpublished' | 'partial' | 'published';
  issuedCount?: number;
  clientCount?: number;
}

interface ClientRow {
  clientId: string | null;
  clientName: string;
  currency: string | null;
  seconds: number;
  amount: number;
  invoice: {
    invoiceNumber: string;
    status: 'PENDING' | 'ISSUED' | 'FAILED';
    qboInvoiceId: string | null;
    xeroInvoiceId: string | null;
    failureReason: string | null;
    issuedAt: string | null;
  } | null;
}

interface PublishResult {
  clientId: string;
  clientName: string;
  outcome: 'issued' | 'recovered' | 'skipped_already_invoiced' | 'failed';
  invoiceNumber?: string;
  error?: string;
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
  const [invoiceGenerated, setInvoiceGenerated] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/periods/${id}`);
    if (res.ok) setPeriod(await res.json());
    setLoading(false);
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const [successMsg, setSuccessMsg] = useState('');
  const [showAllBillingClients, setShowAllBillingClients] = useState(false);
  const [publishResults, setPublishResults] = useState<PublishResult[] | null>(null);
  const [confirmLive, setConfirmLive] = useState<{
    provider: 'qbo' | 'xero'; destination: string; clients: string[]; invoiceCount: number;
  } | null>(null);
  const [busyClient, setBusyClient] = useState<string | null>(null);

  const doAction = async (url: string, method = 'PATCH') => {
    setActionLoading(true);
    setMessage('');
    setSuccessMsg('');
    const res = await fetch(url, { method });
    const data = await res.json();
    if (!res.ok) {
      setMessage(data.error || data.message || 'Action failed');
    } else {
      await load();
    }
    setActionLoading(false);
  };

  /**
   * Publishing fans the period out into one invoice per client. A live
   * destination answers 428 first, so the confirmation names where the invoices
   * would land and for whom before anything is created.
   */
  const doPublish = async (provider: 'qbo' | 'xero', confirmed = false) => {
    setActionLoading(true);
    setMessage('');
    setSuccessMsg('');
    setPublishResults(null);
    try {
      const res = await fetch(`/api/periods/${id}/publish/${provider}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(confirmed ? { confirmLive: true } : {}),
      });
      const data = await res.json();

      if (res.status === 428) {
        setConfirmLive({
          provider,
          destination: data.destination,
          clients: data.clients ?? [],
          invoiceCount: data.invoiceCount ?? 0,
        });
        return;
      }
      setConfirmLive(null);
      if (!res.ok) {
        setMessage(data.error || 'Publish failed');
        return;
      }
      setPublishResults(data.results ?? []);
      setSuccessMsg(data.message ?? 'Published');
      await load();
    } catch {
      setMessage('Network error while publishing');
    } finally {
      setActionLoading(false);
    }
  };

  const handleGenerateInvoice = async (clientId: string, clientName: string) => {
    setBusyClient(clientId);
    setMessage('');
    try {
      const res = await fetch(`/api/periods/${id}/generate-invoice`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId }),
      });
      if (!res.ok) {
        const data = await res.json();
        setMessage(data.error || `Failed to generate the invoice for ${clientName}`);
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
      await load();
    } catch {
      setMessage(`Failed to generate the invoice for ${clientName}`);
    } finally {
      setBusyClient(null);
    }
  };

  const handleAttachPdf = async (clientId: string, clientName: string) => {
    setBusyClient(clientId);
    setMessage('');
    setSuccessMsg('');
    try {
      const res = await fetch(`/api/periods/${id}/attach-pdf`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId }),
      });
      const data = await res.json();
      if (!res.ok) setMessage(data.error || `Failed to attach the timesheet for ${clientName}`);
      else setSuccessMsg(`Timesheet attached to ${data.invoiceNumber} for ${clientName}`);
    } catch {
      setMessage(`Failed to attach the timesheet for ${clientName}`);
    } finally {
      setBusyClient(null);
    }
  };

  if (loading) return <div className="p-8"><div className="h-32 skeleton rounded-xl" /></div>;
  if (!period) return <div className="p-8" style={{ color: 'var(--text-muted)' }}>Period not found</div>;

  const totalSeconds = period.stats?.totalSeconds ?? (period.entries ?? []).reduce((s, e) => s + (e.durationSeconds || 0), 0);
  // Clients still without an issued invoice - what a publish would actually do.
  const remainingCount = (period.clientRows ?? []).filter((r) => r.invoice?.status !== 'ISSUED').length;
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

      {/* Not invoiceable as one document — shown before the buttons, not as a 409
          after. Deliberately compact: periods here routinely hold 20 clients,
          so the list truncates rather than filling the screen. */}
      {period.billing && !period.billing.invoiceable && (
        <div className="border border-amber-800/60 bg-amber-950/40 text-amber-200 text-sm rounded-lg px-4 py-3 mb-4">
          <div className="flex items-start gap-2">
            <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <div className="min-w-0">
              <p className="font-medium text-amber-100">Cannot be invoiced as one document</p>
              <p className="mt-1 text-amber-200/90">{period.billing.conflict?.message}</p>
              {period.billing.clients.length > 1 && (
                <p className="mt-2 text-xs text-amber-200/80 break-words">
                  {(showAllBillingClients
                    ? period.billing.clients
                    : period.billing.clients.slice(0, 3)
                  )
                    .map((c) =>
                      `${c.name}${c.currency ? ` [${c.currency}]` : ''} ${(c.seconds / 3600).toFixed(2)}h`,
                    )
                    .join('  ·  ')}
                  {period.billing.clients.length > 3 && (
                    <button
                      onClick={() => setShowAllBillingClients((v) => !v)}
                      className="ml-2 underline hover:text-amber-100"
                    >
                      {showAllBillingClients
                        ? 'show fewer'
                        : `+${period.billing.clients.length - 3} more`}
                    </button>
                  )}
                </p>
              )}
            </div>
          </div>
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
        {(period.status === 'APPROVED' || period.status === 'PUBLISHED') && isAdmin && (
          <>
            <OriginButton
              onClick={() => doPublish('qbo')}
              disabled={actionLoading || remainingCount === 0}
              title={remainingCount === 0 ? 'Every client in this period is already invoiced' : undefined}
              className="flex items-center gap-2 text-white text-sm px-4 py-2 rounded-lg transition-colors disabled:opacity-50"
              style={{ background: '#15803d' }}
            >
              <SiQuickbooks size={16} />
              {remainingCount > 0 && remainingCount < (period.clientCount ?? 0)
                ? `Publish remaining (${remainingCount}) to QuickBooks`
                : 'Publish to QuickBooks'}
            </OriginButton>
            <OriginButton
              onClick={() => doPublish('xero')}
              disabled={actionLoading || remainingCount === 0}
              title={remainingCount === 0 ? 'Every client in this period is already invoiced' : undefined}
              className="flex items-center gap-2 text-white text-sm px-4 py-2 rounded-lg transition-colors disabled:opacity-50"
              style={{ background: '#0369a1' }}
            >
              <SiXero size={16} />
              {remainingCount > 0 && remainingCount < (period.clientCount ?? 0)
                ? `Publish remaining (${remainingCount}) to Xero`
                : 'Publish to Xero'}
            </OriginButton>
          </>
        )}
        {invoiceGenerated && (
          <div className="flex items-center gap-2 text-sm text-emerald-400">
            <CheckCircle className="w-4 h-4" /> {invoiceGenerated} generated
          </div>
        )}
      </div>

      {/* Live-publish confirmation. Xero has no sandbox, so this appears on
          every Xero publish; QuickBooks raises it only in production. */}
      {confirmLive && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="bg-slate-900 border border-amber-700 rounded-xl p-6 w-full max-w-lg shadow-2xl">
            <div className="flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
              <div className="min-w-0">
                <h2 className="text-white font-medium">Publish to a live accounting system?</h2>
                <p className="text-sm text-slate-300 mt-2">
                  This creates <strong className="text-white">{confirmLive.invoiceCount}</strong>{' '}
                  invoice{confirmLive.invoiceCount === 1 ? '' : 's'} in {confirmLive.destination}.
                </p>
                <p className="text-xs text-slate-400 mt-3 break-words">
                  {confirmLive.clients.join(' · ')}
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-6">
              <button
                onClick={() => setConfirmLive(null)}
                className="px-4 py-2 text-sm rounded-lg border border-slate-700 text-slate-300 hover:bg-slate-800"
              >
                Cancel
              </button>
              <button
                onClick={() => { const provider = confirmLive.provider; setConfirmLive(null); void doPublish(provider, true); }}
                className="px-4 py-2 text-sm rounded-lg text-white"
                style={{ background: '#b45309' }}
              >
                Create {confirmLive.invoiceCount} invoice{confirmLive.invoiceCount === 1 ? '' : 's'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* One row per client: what each is owed and where its invoice stands.
          Failure reasons render inline, since they are the actionable part. */}
      {isAdmin && (period.clientRows?.length ?? 0) > 0 && (
        <div className="mb-8 rounded-xl overflow-hidden border" style={{ borderColor: 'var(--border)' }}>
          <div className="flex items-center justify-between px-4 py-3" style={{ background: 'var(--surface)' }}>
            <span className="text-sm" style={{ color: 'var(--text)' }}>Invoices by client</span>
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
              {period.issuedCount ?? 0} of {period.clientCount ?? 0} issued
            </span>
          </div>
          <table className="w-full text-sm">
            <tbody>
              {(period.clientRows ?? []).map((row) => {
                const inv = row.invoice;
                const issued = inv?.status === 'ISSUED';
                const failed = inv?.status === 'FAILED';
                const providerId = inv?.qboInvoiceId ?? inv?.xeroInvoiceId ?? null;
                return (
                  <tr key={row.clientId ?? '__none__'} className="border-t" style={{ borderColor: 'var(--border)' }}>
                    <td className="px-4 py-3" style={{ color: 'var(--text)' }}>
                      <div>{row.clientName}</div>
                      {failed && inv?.failureReason && (
                        <div className="text-xs text-red-400 mt-1 break-words max-w-xl">
                          {inv.failureReason}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>
                      {formatDuration(row.seconds)}
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap" style={{ color: 'var(--text)' }}>
                      {row.currency ? formatCurrency(row.amount, row.currency) : '—'}
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      {issued ? (
                        <span className="text-xs text-emerald-400">Issued · {inv!.invoiceNumber}</span>
                      ) : failed ? (
                        <span className="text-xs text-red-400">Failed · {inv!.invoiceNumber}</span>
                      ) : (
                        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Not yet published</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      {row.clientId && (
                        <div className="flex items-center justify-end gap-3">
                          <button
                            onClick={() => handleGenerateInvoice(row.clientId!, row.clientName)}
                            disabled={busyClient === row.clientId}
                            className="text-xs underline disabled:opacity-50"
                            style={{ color: 'var(--text-secondary)' }}
                          >
                            {busyClient === row.clientId ? 'Working…' : 'Invoice PDF'}
                          </button>
                          {issued && providerId && !providerId.startsWith('QBO-DEMO-') && (
                            <button
                              onClick={() => handleAttachPdf(row.clientId!, row.clientName)}
                              disabled={busyClient === row.clientId}
                              className="text-xs underline disabled:opacity-50"
                              style={{ color: 'var(--text-secondary)' }}
                              title="Generate this timesheet and attach it to the issued invoice"
                            >
                              Attach timesheet
                            </button>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Outcome of the last publish run, per client. */}
      {publishResults && publishResults.length > 0 && (
        <div className="mb-8 rounded-lg border px-4 py-3 text-sm" style={{ borderColor: 'var(--border)' }}>
          <p className="mb-2" style={{ color: 'var(--text)' }}>Last publish run</p>
          <ul className="space-y-1">
            {publishResults.map((r) => (
              <li key={r.clientId} className="text-xs break-words" style={{ color: 'var(--text-secondary)' }}>
                <span style={{ color: 'var(--text)' }}>{r.clientName}</span>
                {' — '}
                {r.outcome === 'issued' && <span className="text-emerald-400">issued {r.invoiceNumber}</span>}
                {r.outcome === 'recovered' && (
                  <span className="text-emerald-400">recovered {r.invoiceNumber} from an earlier attempt</span>
                )}
                {r.outcome === 'skipped_already_invoiced' && (
                  <span style={{ color: 'var(--text-muted)' }}>already invoiced as {r.invoiceNumber}</span>
                )}
                {r.outcome === 'failed' && <span className="text-red-400">{r.error}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

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
