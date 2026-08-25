'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useSession } from 'next-auth/react';
import { Plus, Archive, Pencil, X } from 'lucide-react';
import { getCurrency } from '@/lib/currency';
import { DataTable, StatusBadge, Column } from '@/components/ui/data-table';
import { InlineClientForm } from '@/components/forms/inline-client-form';
import { PROJECT_ICONS, resolveIcon } from '@/lib/project-icons';

interface Client {
  id: string;
  name: string;
  currency: string;
}

interface Project {
  id: string;
  name: string;
  description?: string | null;
  color: string;
  icon?: string | null;
  hourlyRate: number | string;
  isBillable: boolean;
  isArchived: boolean;
  client: Client | null;
}

interface FormState {
  name: string;
  description: string;
  clientId: string;
  color: string;
  icon: string;
  hourlyRate: string;
  isBillable: boolean;
}

const COLOR_OPTIONS = ['#3730A3', '#10B981', '#EF4444', '#F59E0B', '#8B5CF6', '#06B6D4', '#EC4899', '#64748B'];
const DEFAULT_FORM: FormState = { name: '', description: '', clientId: '', color: '#3730A3', icon: '', hourlyRate: '0', isBillable: true };

export default function ProjectsPage() {
  const { data: session } = useSession();
  const isAdmin = ['OWNER', 'ADMIN'].includes((session?.user as { role?: string })?.role ?? '');

  const [orgCurrency, setOrgCurrency] = useState('USD');
  const [projects, setProjects] = useState<Project[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [showDialog, setShowDialog] = useState(false);
  const [editProject, setEditProject] = useState<Project | null>(null);
  const dialogMouseDown = useRef(false);
  const [form, setForm] = useState<FormState>(DEFAULT_FORM);
  const [saving, setSaving] = useState(false);
  const [showInlineClient, setShowInlineClient] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [iconSearch, setIconSearch] = useState('');

  const fetchProjects = useCallback(async () => { const res = await fetch('/api/projects'); if (res.ok) setProjects(await res.json()); }, []);
  const fetchClients = useCallback(async () => { const res = await fetch('/api/clients'); if (res.ok) setClients(await res.json()); }, []);

  useEffect(() => {
    fetchProjects();
    fetchClients();
    fetch('/api/org').then((r) => r.json()).then((d) => { if (d.currency) setOrgCurrency(d.currency); }).catch(() => {});
  }, [fetchProjects, fetchClients]);

  const openNew = () => { setEditProject(null); setForm(DEFAULT_FORM); setIconSearch(''); setShowDialog(true); };
  const openEdit = (p: Project) => { setEditProject(p); setForm({ name: p.name, description: p.description ?? '', clientId: p.client?.id ?? '', color: p.color, icon: p.icon ?? '', hourlyRate: String(Number(p.hourlyRate).toFixed(2)), isBillable: p.isBillable }); setIconSearch(''); setShowDialog(true); };
  const closeDialog = () => { setShowDialog(false); setEditProject(null); setShowInlineClient(false); setIconSearch(''); };

  const handleSubmit = async () => {
    if (!form.name.trim()) return;
    if (!editProject && !form.icon) return;
    setSaving(true);
    try {
      const body = { name: form.name.trim(), description: form.description.trim() || null, color: form.color, icon: form.icon || null, clientId: form.clientId || undefined, hourlyRate: parseFloat(form.hourlyRate) || 0, isBillable: form.isBillable };
      if (editProject) {
        const res = await fetch(`/api/projects/${editProject.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        if (res.ok) { const updated: Project = await res.json(); setProjects((prev) => prev.map((p) => (p.id === editProject.id ? updated : p))); }
      } else {
        const res = await fetch('/api/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        if (res.ok) { const created: Project = await res.json(); setProjects((prev) => [created, ...prev]); }
      }
      closeDialog();
    } finally { setSaving(false); }
  };

  const handleArchive = async (id: string) => {
    if (!confirm('Archive this project? It will no longer appear in the timer.')) return;
    const res = await fetch(`/api/projects/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ isArchived: true }) });
    if (res.ok) setProjects((prev) => prev.map((p) => (p.id === id ? { ...p, isArchived: true } : p)));
  };

  const visibleProjects = projects.filter((p) => showArchived || !p.isArchived);
  const activeCount = projects.filter((p) => !p.isArchived).length;
  const archivedCount = projects.filter((p) => p.isArchived).length;
  const selectedClient = clients.find((c) => c.id === form.clientId) ?? null;
  const rateSymbol = getCurrency(selectedClient?.currency ?? 'USD').symbol;
  const filteredIcons = iconSearch.trim()
    ? PROJECT_ICONS.filter((i) => i.label.toLowerCase().includes(iconSearch.toLowerCase()))
    : PROJECT_ICONS;

  const columns: Column<Project>[] = [
    {
      key: 'name',
      header: 'Project',
      render: (p) => {
        const Icon = resolveIcon(p.icon);
        return (
          <div className="flex items-center gap-3">
            {Icon
              ? <Icon size={28} style={{ color: p.color, width: 28, height: 28, flexShrink: 0 }} />
              : <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: p.color }} />
            }
            <div>
              <span className="font-medium" style={{ color: 'var(--text)' }}>{p.name}</span>
              {p.description && (
                <p className="text-xs mt-0.5 line-clamp-1" style={{ color: 'var(--text-muted)' }}>{p.description}</p>
              )}
            </div>
          </div>
        );
      },
    },
    {
      key: 'client.name',
      header: 'Client',
      render: (p) => <span style={{ color: 'var(--text-secondary)' }}>{p.client?.name ?? '—'}</span>,
    },
    {
      key: 'hourlyRate',
      header: 'Hourly Rate',
      render: (p) => {
        const currency = getCurrency(p.client?.currency ?? 'USD');
        const decimals = p.client?.currency === 'JPY' ? 0 : 2;
        return <span className="" style={{ color: 'var(--text-secondary)' }}>{currency.symbol} {Number(p.hourlyRate).toFixed(decimals)}</span>;
      },
    },
    {
      key: 'status',
      header: 'Status',
      render: (p) => <StatusBadge active={!p.isArchived} activeLabel="Active" inactiveLabel="Archived" />,
    },
  ];

  return (
    <div className="p-6 md:p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-normal" style={{ color: 'var(--text)' }}>Projects</h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--text-secondary)' }}>
            {activeCount} active{archivedCount > 0 ? `, ${archivedCount} archived` : ''}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {archivedCount > 0 && (
            <button onClick={() => setShowArchived((v) => !v)} className="text-sm transition-colors" style={{ color: 'var(--text-muted)' }}>
              {showArchived ? 'Hide archived' : 'Show archived'}
            </button>
          )}
          <button onClick={openNew} className="flex items-center gap-2 text-white text-sm px-4 py-2 rounded-lg transition-colors" style={{ background: 'var(--accent)' }}>
            <Plus className="w-4 h-4" />
            New Project
          </button>
        </div>
      </div>

      <DataTable
        columns={columns}
        data={visibleProjects}
        searchKeys={['name', 'client.name']}
        searchPlaceholder="Search by project or client..."
        emptyMessage="No projects yet. Create your first project to start tracking time."
        actions={(p) =>
          !p.isArchived && isAdmin ? (
            <div className="flex items-center gap-0.5 justify-end">
              <button onClick={() => openEdit(p)} className="p-1.5 transition-colors rounded" style={{ color: 'var(--text-muted)' }} title="Edit project">
                <Pencil className="w-3.5 h-3.5" />
              </button>
              <button onClick={() => handleArchive(p.id)} className="p-1.5 transition-colors rounded hover:text-amber-400" style={{ color: 'var(--text-muted)' }} title="Archive project">
                <Archive className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : null
        }
      />

      {showDialog && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4" onMouseDown={(e) => { dialogMouseDown.current = e.target === e.currentTarget; }} onClick={(e) => { if (e.target === e.currentTarget && dialogMouseDown.current) closeDialog(); }}>
          <div className="rounded-2xl p-6 w-full max-w-md shadow-2xl" style={{ background: 'var(--card)', border: '1px solid var(--border)' }}>
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-normal" style={{ color: 'var(--text)' }}>{editProject ? 'Edit Project' : 'New Project'}</h2>
              <button onClick={closeDialog} className="p-1 rounded transition-colors" style={{ color: 'var(--text-muted)' }}><X className="w-5 h-5" /></button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm mb-1.5" style={{ color: 'var(--text-secondary)' }}>Project name <span style={{ color: 'var(--error)' }}>*</span></label>
                <input type="text" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} className="w-full rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2" style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border)', color: 'var(--text)', '--tw-ring-color': 'var(--accent)' } as React.CSSProperties} placeholder="e.g. Website Redesign" autoFocus />
              </div>
              <div>
                <label className="block text-sm mb-1.5" style={{ color: 'var(--text-secondary)' }}>Description <span className="text-xs" style={{ color: 'var(--text-muted)' }}>(optional)</span></label>
                <textarea
                  value={form.description}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                  rows={2}
                  maxLength={500}
                  className="w-full rounded-lg px-3 py-2.5 text-sm resize-none focus:outline-none focus:ring-2"
                  style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border)', color: 'var(--text)', '--tw-ring-color': 'var(--accent)' } as React.CSSProperties}
                  placeholder="What is this project about?"
                />
              </div>
              <div>
                <label className="block text-sm mb-1.5" style={{ color: 'var(--text-secondary)' }}>Client</label>
                <select value={form.clientId} onChange={(e) => setForm((f) => ({ ...f, clientId: e.target.value }))} className="w-full rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2" style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border)', color: 'var(--text-secondary)', '--tw-ring-color': 'var(--accent)' } as React.CSSProperties}>
                  <option value="">No client</option>
                  {clients.map((c) => (<option key={c.id} value={c.id}>{c.name} ({getCurrency(c.currency).label})</option>))}
                </select>
                {selectedClient && <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>Currency inherited from client: {getCurrency(selectedClient.currency).label}</p>}
                {!showInlineClient ? (
                  <button
                    type="button"
                    onClick={() => setShowInlineClient(true)}
                    className="text-xs mt-1.5 flex items-center gap-1 transition-colors"
                    style={{ color: 'var(--accent)' }}
                  >
                    <Plus className="w-3 h-3" />
                    Create new client
                  </button>
                ) : (
                  <div className="mt-2">
                    <InlineClientForm
                      defaultCurrency={orgCurrency}
                      onCreated={(client) => {
                        setClients((prev) => [{ ...client, email: null, qboCustomerId: null, xeroContactId: null } as Client, ...prev]);
                        setForm((f) => ({ ...f, clientId: client.id }));
                        setShowInlineClient(false);
                      }}
                      onCancel={() => setShowInlineClient(false)}
                    />
                  </div>
                )}
              </div>
              <div>
                <label className="block text-sm mb-2" style={{ color: 'var(--text-secondary)' }}>Color</label>
                <div className="flex gap-2 flex-wrap">
                  {COLOR_OPTIONS.map((color) => (
                    <button key={color} type="button" onClick={() => setForm((f) => ({ ...f, color }))} className={`w-8 h-8 rounded-full transition-all ${form.color === color ? 'scale-125 ring-2 ring-white ring-offset-2' : 'hover:scale-110'}`} style={{ backgroundColor: color, '--tw-ring-offset-color': 'var(--card)' } as React.CSSProperties} title={color} />
                  ))}
                </div>
              </div>
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                    Icon {editProject
                      ? <span className="text-xs ml-0.5" style={{ color: 'var(--text-muted)' }}>(optional)</span>
                      : <span style={{ color: 'var(--error)' }}>*</span>
                    }
                  </label>
                  {form.icon && (
                    <button type="button" onClick={() => setForm((f) => ({ ...f, icon: '' }))} className="text-xs flex items-center gap-1 transition-colors" style={{ color: 'var(--text-muted)' }}>
                      <X className="w-3 h-3" />
                      Clear
                    </button>
                  )}
                </div>
                <input
                  type="text"
                  placeholder="Search icons…"
                  value={iconSearch}
                  onChange={(e) => setIconSearch(e.target.value)}
                  className="w-full rounded-lg px-3 py-2 text-sm mb-2 focus:outline-none focus:ring-2"
                  style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border)', color: 'var(--text)', '--tw-ring-color': 'var(--accent)' } as React.CSSProperties}
                />
                <div
                  className="max-h-40 overflow-y-auto rounded-lg"
                  style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border)' }}
                >
                  <div className="grid grid-cols-8 gap-0.5 p-1.5">
                    {filteredIcons.map(({ key, label, component: Icon }) => (
                      <button
                        key={key}
                        type="button"
                        onClick={() => setForm((f) => ({ ...f, icon: f.icon === key ? '' : key }))}
                        title={label}
                        className="flex items-center justify-center p-2 rounded transition-colors hover:bg-white/10"
                        style={form.icon === key
                          ? { background: 'var(--accent)', color: 'white' }
                          : { color: 'var(--text-muted)' }
                        }
                      >
                        <Icon size={18} />
                      </button>
                    ))}
                    {filteredIcons.length === 0 && (
                      <p className="col-span-8 text-center text-xs py-4" style={{ color: 'var(--text-muted)' }}>No icons match "{iconSearch}"</p>
                    )}
                  </div>
                </div>
                {form.icon && (
                  <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                    Selected: {PROJECT_ICONS.find((i) => i.key === form.icon)?.label}
                  </p>
                )}
              </div>
              <div>
                <label className="block text-sm mb-1.5" style={{ color: 'var(--text-secondary)' }}>Hourly rate{selectedClient ? ` (${getCurrency(selectedClient.currency).label})` : ''}</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm select-none" style={{ color: 'var(--text-muted)' }}>{rateSymbol}</span>
                  <input type="number" min="0" step="0.01" value={form.hourlyRate} onChange={(e) => setForm((f) => ({ ...f, hourlyRate: e.target.value }))} className="w-full rounded-lg pl-14 pr-3 py-2.5 text-sm focus:outline-none focus:ring-2" style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border)', color: 'var(--text)', '--tw-ring-color': 'var(--accent)' } as React.CSSProperties} placeholder="0.00" />
                </div>
              </div>
              <label className="flex items-center gap-3 cursor-pointer">
                <div className="relative">
                  <input type="checkbox" checked={form.isBillable} onChange={(e) => setForm((f) => ({ ...f, isBillable: e.target.checked }))} className="sr-only" />
                  <div className="w-10 h-6 rounded-full transition-colors" style={{ background: form.isBillable ? 'var(--success)' : 'var(--text-muted)' }} />
                  <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-transform ${form.isBillable ? 'translate-x-5' : 'translate-x-1'}`} />
                </div>
                <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>Billable project</span>
              </label>
            </div>
            <div className="flex gap-3 mt-6">
              <button onClick={closeDialog} className="flex-1 py-2.5 rounded-lg text-sm transition-colors" style={{ border: '1px solid var(--border)', color: 'var(--text-secondary)' }}>Cancel</button>
              <button onClick={handleSubmit} disabled={!form.name.trim() || saving || (!editProject && !form.icon)} className="flex-1 text-white py-2.5 rounded-lg text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed" style={{ background: 'var(--accent)' }}>{saving ? 'Saving...' : editProject ? 'Save changes' : 'Create project'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
