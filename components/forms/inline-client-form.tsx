'use client';

import { useState } from 'react';
import { X } from 'lucide-react';
import { CURRENCIES, DEFAULT_CURRENCY, type CurrencyCode } from '@/lib/utils';

interface Props {
  onCreated: (client: { id: string; name: string; currency: string }) => void;
  onCancel: () => void;
  defaultCurrency?: string;
}

export function InlineClientForm({ onCreated, onCancel, defaultCurrency }: Props) {
  const [name, setName] = useState('');
  const [currency, setCurrency] = useState<CurrencyCode>((defaultCurrency ?? DEFAULT_CURRENCY) as CurrencyCode);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleCreate = async () => {
    if (!name.trim()) return;
    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/clients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), currency }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? 'Failed to create client');
        return;
      }
      const client = await res.json();
      onCreated({ id: client.id, name: client.name, currency: client.currency });
    } catch {
      setError('Network error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-lg p-3 space-y-3" style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border)' }}>
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>Quick add client</span>
        <button onClick={onCancel} className="p-0.5" style={{ color: 'var(--text-muted)' }}>
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Client name"
        autoFocus
        className="w-full rounded px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1"
        style={{ background: 'var(--card)', border: '1px solid var(--border)', color: 'var(--text)', '--tw-ring-color': 'var(--accent)' } as React.CSSProperties}
      />
      <select
        value={currency}
        onChange={(e) => setCurrency(e.target.value as CurrencyCode)}
        className="w-full rounded px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1"
        style={{ background: 'var(--card)', border: '1px solid var(--border)', color: 'var(--text-secondary)', '--tw-ring-color': 'var(--accent)' } as React.CSSProperties}
      >
        {CURRENCIES.map((c) => (
          <option key={c.code} value={c.code}>{c.label}</option>
        ))}
      </select>
      {error && <p className="text-xs" style={{ color: 'var(--error)' }}>{error}</p>}
      <button
        onClick={handleCreate}
        disabled={!name.trim() || saving}
        className="w-full py-1.5 rounded text-xs font-semibold text-white transition-colors disabled:opacity-50"
        style={{ background: 'var(--accent)' }}
      >
        {saving ? 'Creating...' : 'Create client'}
      </button>
    </div>
  );
}
