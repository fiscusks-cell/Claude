'use client';
import { useState, useEffect, useRef } from 'react';
import { useSession } from 'next-auth/react';
import { useSearchParams } from 'next/navigation';
import { CheckCircle } from 'lucide-react';
import { SiQuickbooks, SiXero } from 'react-icons/si';
import { PLANS, type PlanKey } from '@/lib/plans';
import { CURRENCIES } from '@/lib/currency';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';

type Tab = 'profile' | 'organization' | 'billing' | 'integrations';

interface IntegrationStatus {
  connectedQBO: boolean;
  connectedXero: boolean;
  xeroOrgName: string | null;
}

interface OrgInfo {
  name: string;
  plan: PlanKey;
  billingPeriod: string;
  currency: string;
}

const card: React.CSSProperties = { background: 'var(--surface)', border: '1px solid var(--border)' };
const inputStyle: React.CSSProperties = { background: 'var(--bg-tertiary)', border: '1px solid var(--border)', color: 'var(--text)' };
const inputReadOnly: React.CSSProperties = { background: 'var(--bg-tertiary)', border: '1px solid var(--border)', color: 'var(--text-muted)', cursor: 'not-allowed' };

export default function SettingsPage() {
  const { data: session, update } = useSession();
  const searchParams = useSearchParams();
  const [tab, setTab] = useState<Tab>(() =>
    searchParams.get('tab') === 'integrations' ? 'integrations' : 'profile'
  );
  const [integrations, setIntegrations] = useState<IntegrationStatus>({ connectedQBO: false, connectedXero: false, xeroOrgName: null });
  const [qboMsg, setQboMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [xeroMsg, setXeroMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [org, setOrg] = useState<OrgInfo | null>(null);
  const [weekStartDay, setWeekStartDay] = useState(1);
  const [weekStartSaving, setWeekStartSaving] = useState(false);

  const [orgCurrency, setOrgCurrency] = useState('USD');
  const [orgCurrencySaving, setOrgCurrencySaving] = useState(false);
  const [orgCurrencySaved, setOrgCurrencySaved] = useState(false);

  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [avatarSaving, setAvatarSaving] = useState(false);
  const [avatarError, setAvatarError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (session?.user?.name) setName(session.user.name);
  }, [session?.user?.name]);

  useEffect(() => {
    fetch('/api/org')
      .then((r) => r.json())
      .then((d) => { setOrg(d); if (d.currency) setOrgCurrency(d.currency); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetch('/api/user/avatar')
      .then((r) => r.json())
      .then((d) => setAvatarUrl(d.url ?? null))
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetch('/api/user/preferences')
      .then((r) => r.json())
      .then((d) => { if (typeof d.weekStartDay === 'number') setWeekStartDay(d.weekStartDay); })
      .catch(() => {});
  }, []);

  const handleWeekStartChange = async (value: number) => {
    setWeekStartDay(value);
    setWeekStartSaving(true);
    try {
      await fetch('/api/user/preferences', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ weekStartDay: value }),
      });
    } finally {
      setWeekStartSaving(false);
    }
  };

  useEffect(() => {
    return () => { if (previewUrl) URL.revokeObjectURL(previewUrl); };
  }, [previewUrl]);

  useEffect(() => {
    fetch('/api/integrations/qbo/status')
      .then((r) => r.json())
      .then((d) => setIntegrations((prev) => ({ ...prev, connectedQBO: !!d.connected })))
      .catch(() => {});
    fetch('/api/integrations/xero/status')
      .then((r) => r.json())
      .then((d) => setIntegrations((prev) => ({ ...prev, connectedXero: !!d.connected, xeroOrgName: d.orgName ?? null })))
      .catch(() => {});
  }, []);

  useEffect(() => {
    const qbo = searchParams.get('qbo');
    if (qbo === 'connected') setQboMsg({ ok: true, text: 'QuickBooks connected successfully!' });
    if (qbo === 'error') setQboMsg({ ok: false, text: 'QuickBooks connection failed. Please try again.' });
    const xero = searchParams.get('xero');
    if (xero === 'connected') setXeroMsg({ ok: true, text: 'Xero connected successfully!' });
    if (xero === 'error') {
      const msg = searchParams.get('msg');
      setXeroMsg({ ok: false, text: msg ? `Xero connection failed: ${msg}` : 'Xero connection failed. Please try again.' });
    }
  }, [searchParams]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setAvatarError('Only JPEG, PNG, or WebP images are allowed.');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setAvatarError('Image must be under 5 MB.');
      return;
    }
    setAvatarError('');
    setPendingFile(file);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(URL.createObjectURL(file));
  };

  const handleCancelPending = () => {
    setPendingFile(null);
    if (previewUrl) { URL.revokeObjectURL(previewUrl); setPreviewUrl(null); }
    setAvatarError('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleSaveAvatar = async () => {
    if (!pendingFile) return;
    setAvatarSaving(true);
    setAvatarError('');
    try {
      const fd = new FormData();
      fd.append('avatar', pendingFile);
      const res = await fetch('/api/user/avatar', { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok) { setAvatarError(data.error ?? 'Upload failed'); return; }
      setAvatarUrl(data.url);
      setPendingFile(null);
      if (previewUrl) { URL.revokeObjectURL(previewUrl); setPreviewUrl(null); }
      if (fileInputRef.current) fileInputRef.current.value = '';
    } finally {
      setAvatarSaving(false);
    }
  };

  const handleRemoveAvatar = async () => {
    setAvatarSaving(true);
    setAvatarError('');
    try {
      const res = await fetch('/api/user/avatar', { method: 'DELETE' });
      if (res.ok) { setAvatarUrl(null); }
      else { const d = await res.json(); setAvatarError(d.error ?? 'Remove failed'); }
    } finally {
      setAvatarSaving(false);
    }
  };

  const handleSaveName = async () => {
    setSaving(true);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
    setSaving(false);
  };

  const handleSaveOrgCurrency = async () => {
    setOrgCurrencySaving(true);
    try {
      const res = await fetch('/api/org', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currency: orgCurrency }),
      });
      if (res.ok) {
        setOrgCurrencySaved(true);
        setTimeout(() => setOrgCurrencySaved(false), 2000);
      }
    } finally {
      setOrgCurrencySaving(false);
    }
  };

  const openBillingPortal = async () => {
    const res = await fetch('/api/billing/portal', { method: 'POST' });
    const data = await res.json();
    if (data.url) window.open(data.url, '_blank');
    else alert(data.error || 'Billing portal unavailable');
  };

  const tabs: { id: Tab; label: string }[] = [
    { id: 'profile', label: 'Profile' },
    { id: 'organization', label: 'Organization' },
    { id: 'billing', label: 'Billing' },
    { id: 'integrations', label: 'Integrations' },
  ];

  return (
    <div className="p-8">
      <h1 className="text-2xl font-normal mb-8" style={{ color: 'var(--text)' }}>Settings</h1>

      {/* Tab nav */}
      <div className="flex gap-1 mb-8" style={{ borderBottom: '1px solid var(--border)' }}>
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className="px-4 py-2.5 text-sm transition-colors border-b-2 -mb-px"
            style={
              tab === t.id
                ? { borderColor: '#6366f1', color: 'var(--text)' }
                : { borderColor: 'transparent', color: 'var(--text-muted)' }
            }
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'profile' && (
        <div className="space-y-6">
          {/* Profile photo */}
          <div className="rounded-xl p-6" style={card}>
            <h2 className="text-base font-normal mb-4" style={{ color: 'var(--text)' }}>Profile photo</h2>
            <div className="flex items-center gap-5">
              <Avatar className="w-16 h-16 shrink-0">
                <AvatarImage
                  src={previewUrl ?? avatarUrl ?? undefined}
                  alt={session?.user?.name ?? ''}
                />
                <AvatarFallback
                  className="text-xl text-white"
                  style={{ background: 'var(--sidebar-active)' }}
                >
                  {session?.user?.name?.[0]?.toUpperCase() ?? '?'}
                </AvatarFallback>
              </Avatar>
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={avatarSaving}
                    className="text-white text-sm px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
                    style={{ background: 'var(--surface-raised)' }}
                  >
                    {pendingFile ? 'Change' : 'Upload photo'}
                  </button>
                  {pendingFile && (
                    <>
                      <button
                        onClick={handleSaveAvatar}
                        disabled={avatarSaving}
                        className="text-white text-sm px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
                        style={{ background: 'var(--accent)' }}
                      >
                        {avatarSaving ? 'Saving…' : 'Save photo'}
                      </button>
                      <button
                        onClick={handleCancelPending}
                        disabled={avatarSaving}
                        className="text-sm transition-colors"
                        style={{ color: 'var(--text-muted)' }}
                      >
                        Discard
                      </button>
                    </>
                  )}
                  {avatarUrl && !pendingFile && (
                    <button
                      onClick={handleRemoveAvatar}
                      disabled={avatarSaving}
                      className="text-sm transition-colors hover:text-red-400"
                      style={{ color: 'var(--text-muted)' }}
                    >
                      {avatarSaving ? 'Removing…' : 'Remove'}
                    </button>
                  )}
                </div>
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>JPEG, PNG, or WebP · max 5 MB</p>
                {avatarError && <p className="text-xs text-red-400">{avatarError}</p>}
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={handleFileChange}
              />
            </div>
          </div>

          <div className="rounded-xl p-6" style={card}>
            <h2 className="text-base font-normal mb-4" style={{ color: 'var(--text)' }}>Personal information</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm mb-1.5" style={{ color: 'var(--text-muted)' }}>Display name</label>
                <input
                  value={name}
                  onChange={e => setName(e.target.value)}
                  className="w-full rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  style={inputStyle}
                />
              </div>
              <div>
                <label className="block text-sm mb-1.5" style={{ color: 'var(--text-muted)' }}>Email</label>
                <input
                  readOnly
                  value={session?.user?.email || ''}
                  className="w-full rounded-lg px-3 py-2.5 text-sm focus:outline-none"
                  style={inputReadOnly}
                />
                <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>Email cannot be changed</p>
              </div>
              <button
                onClick={handleSaveName}
                disabled={saving}
                className="text-white text-sm px-4 py-2 rounded-lg transition-colors disabled:opacity-50"
                style={{ background: 'var(--accent)' }}
              >
                {saved ? '✓ Saved' : saving ? 'Saving…' : 'Save changes'}
              </button>
            </div>
          </div>

          <div className="rounded-xl p-6" style={card}>
            <h2 className="text-base font-normal mb-4" style={{ color: 'var(--text)' }}>Time preferences</h2>
            <div>
              <label className="block text-sm mb-1.5" style={{ color: 'var(--text-muted)' }}>Week starts on</label>
              <select
                value={weekStartDay}
                onChange={(e) => handleWeekStartChange(Number(e.target.value))}
                disabled={weekStartSaving}
                className="w-full rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:opacity-50"
                style={{ ...inputStyle, color: 'var(--text-secondary)' }}
              >
                <option value={0}>Sunday</option>
                <option value={1}>Monday</option>
                <option value={6}>Saturday</option>
              </select>
            </div>
          </div>

          <div className="rounded-xl p-6" style={card}>
            <h2 className="text-base font-normal mb-2" style={{ color: 'var(--text)' }}>Change password</h2>
            <p className="text-sm mb-4" style={{ color: 'var(--text-muted)' }}>Leave blank to keep your current password</p>
            <div className="space-y-4">
              <input
                type="password"
                placeholder="Current password"
                className="w-full rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                style={{ ...inputStyle, '--tw-placeholder-color': 'var(--text-muted)' } as React.CSSProperties}
              />
              <input
                type="password"
                placeholder="New password (min 8 chars)"
                className="w-full rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                style={{ ...inputStyle, '--tw-placeholder-color': 'var(--text-muted)' } as React.CSSProperties}
              />
              <button
                className="text-white text-sm px-4 py-2 rounded-lg transition-colors"
                style={{ background: 'var(--accent)' }}
              >
                Update password
              </button>
            </div>
          </div>
        </div>
      )}

      {tab === 'organization' && (
        <div className="rounded-xl p-6 space-y-4" style={card}>
          <h2 className="text-base font-normal mb-4" style={{ color: 'var(--text)' }}>Organization settings</h2>
          <div>
            <label className="block text-sm mb-1.5" style={{ color: 'var(--text-muted)' }}>Organization name</label>
            <input
              className="w-full rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              style={inputStyle}
            />
          </div>
          <div>
            <label className="block text-sm mb-1.5" style={{ color: 'var(--text-muted)' }}>Default billing period</label>
            <select
              className="w-full rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500"
              style={{ ...inputStyle, color: 'var(--text-secondary)' }}
            >
              <option value="WEEKLY">Weekly</option>
              <option value="BIWEEKLY">Bi-weekly</option>
              <option value="MONTHLY">Monthly</option>
            </select>
          </div>
          <div>
            <label className="block text-sm mb-1.5" style={{ color: 'var(--text-muted)' }}>Default currency</label>
            <p className="text-xs mb-2" style={{ color: 'var(--text-muted)' }}>New clients will default to this currency. Existing clients are unaffected.</p>
            <div className="flex gap-2">
              <select
                value={orgCurrency}
                onChange={(e) => setOrgCurrency(e.target.value)}
                disabled={orgCurrencySaving}
                className="flex-1 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:opacity-50"
                style={{ ...inputStyle, color: 'var(--text-secondary)' }}
              >
                {CURRENCIES.map((c) => (
                  <option key={c.code} value={c.code}>{c.label}</option>
                ))}
              </select>
              <button
                onClick={handleSaveOrgCurrency}
                disabled={orgCurrencySaving}
                className="text-white text-sm px-4 py-2 rounded-lg transition-colors disabled:opacity-50 whitespace-nowrap"
                style={{ background: 'var(--accent)' }}
              >
                {orgCurrencySaved ? '✓ Saved' : orgCurrencySaving ? 'Saving…' : 'Save currency'}
              </button>
            </div>
          </div>
          <button
            className="text-white text-sm px-4 py-2 rounded-lg transition-colors"
            style={{ background: 'var(--accent)' }}
          >
            Save
          </button>
        </div>
      )}

      {tab === 'billing' && (
        <div className="space-y-4">
          <div className="rounded-xl p-6" style={card}>
            <h2 className="text-base font-normal mb-2" style={{ color: 'var(--text)' }}>Current plan</h2>
            {org ? (() => {
              const currentPlan = PLANS[org.plan] ?? PLANS.FREE;
              const seatsText = currentPlan.seats === null ? 'Unlimited users' : `${currentPlan.seats} user${currentPlan.seats === 1 ? '' : 's'}`;
              return (
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-2xl" style={{ color: 'var(--text)' }}>{currentPlan.name}</div>
                    <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>
                      {seatsText} · {org.billingPeriod.toLowerCase()} billing
                    </p>
                  </div>
                  <span
                    className="text-xs px-3 py-1.5 rounded-full"
                    style={{ background: 'var(--surface-raised)', color: 'var(--text-muted)' }}
                  >
                    Current plan
                  </span>
                </div>
              );
            })() : (
              <div className="h-12 rounded-lg animate-pulse" style={{ background: 'var(--surface-raised)' }} />
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="rounded-xl p-5" style={{ background: 'var(--surface)', border: '1px solid #4338ca' }}>
              <div className="mb-1" style={{ color: 'var(--text)' }}>{PLANS.PRO.name}</div>
              <div className="text-2xl mb-2" style={{ color: 'var(--text)' }}>
                ${PLANS.PRO.monthlyPrice}
                <span className="text-sm font-normal" style={{ color: 'var(--text-muted)' }}>/mo</span>
              </div>
              <ul className="text-xs space-y-1 mb-4" style={{ color: 'var(--text-muted)' }}>
                {PLANS.PRO.features.slice(0, 3).map((f) => <li key={f}>✓ {f}</li>)}
              </ul>
              <button className="w-full text-white text-sm py-2 rounded-lg" style={{ background: 'var(--accent)' }}>Upgrade</button>
            </div>
            <div className="rounded-xl p-5" style={card}>
              <div className="mb-1" style={{ color: 'var(--text)' }}>{PLANS.TEAM.name}</div>
              <div className="text-2xl mb-2" style={{ color: 'var(--text)' }}>
                ${PLANS.TEAM.monthlyPrice}
                <span className="text-sm font-normal" style={{ color: 'var(--text-muted)' }}>/mo</span>
              </div>
              <ul className="text-xs space-y-1 mb-4" style={{ color: 'var(--text-muted)' }}>
                {PLANS.TEAM.features.slice(0, 3).map((f) => <li key={f}>✓ {f}</li>)}
              </ul>
              <button className="w-full text-white text-sm py-2 rounded-lg" style={{ background: 'var(--accent)' }}>Upgrade</button>
            </div>
          </div>

          <button onClick={openBillingPortal} className="text-sm text-indigo-400 hover:text-indigo-300 underline">
            Open billing portal →
          </button>
        </div>
      )}

      {tab === 'integrations' && (
        <div className="space-y-4">
          {qboMsg && (
            <div className={`flex items-center gap-2 text-sm px-4 py-3 rounded-lg border ${
              qboMsg.ok ? 'bg-emerald-950 text-emerald-300 border-emerald-800' : 'bg-red-950 text-red-300 border-red-800'
            }`}>
              {qboMsg.ok && <CheckCircle className="w-4 h-4 flex-shrink-0" />}
              {qboMsg.text}
            </div>
          )}

          <div className="rounded-xl p-6" style={card}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-green-600 rounded-lg flex items-center justify-center">
                  <SiQuickbooks size={22} className="text-white" />
                </div>
                <div>
                  <div style={{ color: 'var(--text)' }}>QuickBooks Online</div>
                  <div className="text-sm" style={{ color: 'var(--text-muted)' }}>
                    {integrations.connectedQBO ? 'Connected — invoices will be published to your QBO account' : 'Publish invoices directly to QuickBooks'}
                  </div>
                </div>
              </div>
              {integrations.connectedQBO ? (
                <span className="flex items-center gap-1.5 text-emerald-400 text-sm">
                  <CheckCircle className="w-4 h-4" /> Connected
                </span>
              ) : (
                <a href="/api/integrations/qbo/connect" className="text-white text-sm px-4 py-2 rounded-lg transition-colors" style={{ background: '#15803d' }}>
                  Connect
                </a>
              )}
            </div>
            {!integrations.connectedQBO && (
              <div className="mt-3 text-xs rounded px-3 py-2" style={{ background: 'var(--surface-raised)', color: 'var(--text-muted)' }}>
                Set INTUIT_CLIENT_ID and INTUIT_CLIENT_SECRET in your environment to enable.
              </div>
            )}
          </div>

          {xeroMsg && (
            <div className={`flex items-center gap-2 text-sm px-4 py-3 rounded-lg border ${
              xeroMsg.ok ? 'bg-emerald-950 text-emerald-300 border-emerald-800' : 'bg-red-950 text-red-300 border-red-800'
            }`}>
              {xeroMsg.ok && <CheckCircle className="w-4 h-4 flex-shrink-0" />}
              {xeroMsg.text}
            </div>
          )}

          <div className="rounded-xl p-6" style={card}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-sky-500 rounded-lg flex items-center justify-center">
                  <SiXero size={22} className="text-white" />
                </div>
                <div>
                  <div style={{ color: 'var(--text)' }}>Xero</div>
                  <div className="text-sm" style={{ color: 'var(--text-muted)' }}>
                    {integrations.connectedXero
                      ? `Connected${integrations.xeroOrgName ? ` to ${integrations.xeroOrgName}` : ''} — invoices will be published to your Xero organisation`
                      : 'Publish invoices directly to Xero'}
                  </div>
                </div>
              </div>
              {integrations.connectedXero ? (
                <div className="flex items-center gap-3">
                  <span className="flex items-center gap-1.5 text-emerald-400 text-sm">
                    <CheckCircle className="w-4 h-4" /> Connected
                  </span>
                  <button
                    onClick={async () => {
                      const res = await fetch('/api/integrations/xero/disconnect', { method: 'POST' });
                      if (res.ok) setIntegrations((prev) => ({ ...prev, connectedXero: false }));
                    }}
                    className="text-xs transition-colors hover:text-red-400"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    Disconnect
                  </button>
                </div>
              ) : (
                <a href="/api/integrations/xero/connect" className="text-white text-sm px-4 py-2 rounded-lg transition-colors" style={{ background: '#0369a1' }}>
                  Connect
                </a>
              )}
            </div>
            {!integrations.connectedXero && (
              <div className="mt-3 text-xs rounded px-3 py-2" style={{ background: 'var(--surface-raised)', color: 'var(--text-muted)' }}>
                Set XERO_CLIENT_ID and XERO_CLIENT_SECRET in your environment to enable.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
