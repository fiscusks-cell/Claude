'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useSession } from 'next-auth/react';
import { Plus, Pencil, Trash2, X, Circle } from 'lucide-react';
import { CURRENCIES, DEFAULT_CURRENCY } from '@/lib/utils';
import { DataTable, StatusBadge, Column } from '@/components/ui/data-table';

interface Client {
  id: string;
  name: string;
  email: string | null;
  currency: string;
  qboCustomerId: string | null;
  xeroContactId: string | null;
  _count?: { projects: number };
}

interface FormState {
  name: string;
  email: string;
  currency: string;
}

export default function ClientsPage() {
  const { data: session } = useSession();
  const isAdmin = ['OWNER', 'ADMIN'].includes((session?.user as { role?: string })?.role ?? '');

  const [orgCurrency, setOrgCurrency] = useState(DEFAULT_CURRENCY);
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [showDialog, setShowDialog] = useState(false);
  const [editClient, setEditClient] = useState<Client | null>(null);
  const dialogMouseDown = useRef(false);
  const [form, setForm] = useState<FormState>({ name: '', email: '', currency: DEFAULT_CURRENCY });
  const [saving, setSaving] = useState(false);

  const fetchClients = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/clients');
      if (res.ok) setClients(await res.json());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchClients();
    fetch('/api/org').then((r) => r.json()).then((d) => { if (d.currency) setOrgCurrency(d.currency); }).catch(() => {});
  }, [fetchClients]);

  const openNew = () => { setEditClient(null); setForm({ name: '', email: '', currency: orgCurrency }); setShowDialog(true); };
  const openEdit = (c: Client) => { setEditClient(c); setForm({ name: c.name, email: c.email ?? '', currency: c.currency }); setShowDialog(true); };
  const closeDialog = () => { setShowDialog(false); setEditClient(null); };

  const handleSubmit = async () => {
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      const body = { name: form.name.trim(), email: form.email.trim() || undefined, currency: form.currency };
      if (editClient) {
        const res = await fetch(`/api/clients/${editClient.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        if (res.ok) { const updated: Client = await res.json(); setClients((prev) => prev.map((c) => (c.id === editClient.id ? { ...c, ...updated } : c))); }
      } else {
        const res = await fetch('/api/clients', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        if (res.ok) await fetchClients();
      }
      closeDialog();
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Delete client "${name}"? This cannot be undone.`)) return;
    const res = await fetch(`/api/clients/${id}`, { method: 'DELETE' });
    if (res.ok) setClients((prev) => prev.filter((c) => c.id !== id));
  };

  const columns: Column<Client>[] = [
    {
      key: 'name',
      header: 'Name',
      render: (c) => <span className="font-medium" style={{ color: 'var(--text)' }}>{c.name}</span>,
    },
    {
      key: 'email',
      header: 'Email',
      render: (c) => <span style={{ color: 'var(--text-secondary)' }}>{c.email ?? '—'}</span>,
    },
    {
      key: 'currency',
      header: 'Currency',
      render: (c) => (
        <span className="inline-flex items-center text-xs px-2 py-0.5 rounded" style={{ background: 'var(--bg-tertiary)', color: 'var(--text-secondary)' }}>
          {c.currency}
        </span>
      ),
    },
    {
      key: 'integrations',
      header: 'Integrations',
      render: (c) => (
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1 text-xs" style={{ color: 'var(--text-muted)' }}>
            <Circle className={`w-2.5 h-2.5 ${c.qboCustomerId ? 'fill-emerald-500 text-emerald-500' : 'fill-current'}`} />
            QBO
          </span>
          <span className="flex items-center gap-1 text-xs" style={{ color: 'var(--text-muted)' }}>
            <Circle className={`w-2.5 h-2.5 ${c.xeroContactId ? 'fill-emerald-500 text-emerald-500' : 'fill-current'}`} />
            Xero
          </span>
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: () => <StatusBadge active={true} />,
    },
  ];

  return (
    <div className="p-6 md:p-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-normal" style={{ color: 'var(--text)' }}>Clients</h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--text-secondary)' }}>{clients.length} client{clients.length !== 1 ? 's' : ''}</p>
        </div>
        <button
          onClick={openNew}
          className="flex items-center gap-2 text-white text-sm px-4 py-2 rounded-lg transition-colors"
          style={{ background: 'var(--accent)' }}
        >
          <Plus className="w-4 h-4" />
          New Client
        </button>
      </div>

      <DataTable
        columns={columns}
        data={clients}
        searchKeys={['name', 'email']}
        searchPlaceholder="Search by name or email..."
        loading={loading}
        emptyMessage="No clients yet. Add your first client to get started."
        actions={(c) =>
          isAdmin ? (
            <div className="flex items-center gap-1 justify-end">
              <button onClick={() => openEdit(c)} className="p-1.5 transition-colors rounded" style={{ color: 'var(--text-muted)' }} title="Edit client">
                <Pencil className="w-3.5 h-3.5" />
              </button>
              <button onClick={() => handleDelete(c.id, c.name)} className="p-1.5 transition-colors rounded hover:text-red-400" style={{ color: 'var(--text-muted)' }} title="Delete client">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : null
        }
      />

      {showDialog && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4" onMouseDown={(e) => { dialogMouseDown.current = e.target === e.currentTarget; }} onClick={(e) => { if (e.target === e.currentTarget && dialogMouseDown.current) closeDialog(); }}>
          <div className="rounded-2xl p-6 w-full max-w-md shadow-2xl" style={{ background: 'var(--card)', border: '1px solid var(--border)' }}>
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-normal" style={{ color: 'var(--text)' }}>{editClient ? 'Edit Client' : 'New Client'}</h2>
              <button onClick={closeDialog} className="p-1 rounded transition-colors" style={{ color: 'var(--text-muted)' }}><X className="w-5 h-5" /></button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm mb-1.5" style={{ color: 'var(--text-secondary)' }}>Name <span style={{ color: 'var(--error)' }}>*</span></label>
                <input type="text" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} className="w-full rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2" style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border)', color: 'var(--text)', '--tw-ring-color': 'var(--accent)' } as React.CSSProperties} placeholder="e.g. Acme Corp" autoFocus />
              </div>
              <div>
                <label className="block text-sm mb-1.5" style={{ color: 'var(--text-secondary)' }}>Email</label>
                <input type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} className="w-full rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2" style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border)', color: 'var(--text)', '--tw-ring-color': 'var(--accent)' } as React.CSSProperties} placeholder="billing@example.com (optional)" />
              </div>
              <div>
                <label className="block text-sm mb-1.5" style={{ color: 'var(--text-secondary)' }}>Currency</label>
                <select value={form.currency} onChange={(e) => setForm((f) => ({ ...f, currency: e.target.value }))} className="w-full rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2" style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border)', color: 'var(--text-secondary)', '--tw-ring-color': 'var(--accent)' } as React.CSSProperties}>
                  {CURRENCIES.map((c) => (<option key={c.code} value={c.code}>{c.label}</option>))}
                </select>
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button onClick={closeDialog} className="flex-1 py-2.5 rounded-lg text-sm transition-colors" style={{ border: '1px solid var(--border)', color: 'var(--text-secondary)' }}>Cancel</button>
              <button onClick={handleSubmit} disabled={!form.name.trim() || saving} className="flex-1 text-white py-2.5 rounded-lg text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed" style={{ background: 'var(--accent)' }}>{saving ? 'Saving...' : editClient ? 'Save changes' : 'Create client'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
