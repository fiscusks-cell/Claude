'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { signOut } from 'next-auth/react';
import {
  LayoutDashboard, Clock, FolderKanban, Building2,
  BarChart3, Users, Settings, PieChart, FileText, Sun, Moon, Plug, LogOut, ChevronDown,
} from 'lucide-react';
import { SiQuickbooks, SiXero } from 'react-icons/si';
import { useTheme } from '@/components/ThemeProvider';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { useTimerStore } from '@/store/timerStore';

interface NavUser {
  name: string;
  email: string;
  role: string;
  organizationName: string;
  image?: string | null;
}

interface DashboardNavProps {
  user: NavUser;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type NavItem = { href: string; label: string; icon: any };

const analyzeItems: NavItem[] = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/dashboard/periods', label: 'Reports & Periods', icon: BarChart3 },
  { href: '/dashboard/reports', label: 'Reports', icon: PieChart },
  { href: '/dashboard/invoices', label: 'Invoices', icon: FileText },
];

const manageItems: NavItem[] = [
  { href: '/dashboard/projects', label: 'Projects', icon: FolderKanban },
  { href: '/dashboard/clients', label: 'Clients', icon: Building2 },
];

const adminItems: NavItem[] = [
  { href: '/dashboard/team', label: 'Team', icon: Users },
];

function hoverOn(e: React.MouseEvent<HTMLElement>) {
  (e.currentTarget as HTMLElement).style.background = 'var(--sidebar-item-hover)';
}
function hoverOff(e: React.MouseEvent<HTMLElement>) {
  (e.currentTarget as HTMLElement).style.background = '';
}

export function DashboardNav({ user }: DashboardNavProps) {
  const pathname = usePathname();
  const { theme, toggle } = useTheme();
  const isAdmin = user.role === 'OWNER' || user.role === 'ADMIN';

  const isRunning = useTimerStore((s) => s.isRunning);
  const storeStartedAt = useTimerStore((s) => s.startedAt);
  const [timerLabel, setTimerLabel] = useState('Time Tracker');
  const [analyzeOpen, setAnalyzeOpen] = useState(true);
  const [manageOpen, setManageOpen] = useState(true);

  useEffect(() => {
    if (!isRunning || !storeStartedAt) {
      setTimerLabel('Time Tracker');
      return;
    }
    // storeStartedAt is a Date in memory but an ISO string after Zustand rehydrates
    // from localStorage — new Date(x) handles both.
    const startMs = new Date(storeStartedAt as unknown as string).getTime();
    const tick = () => {
      const sec = Math.max(0, Math.floor((Date.now() - startMs) / 1000));
      const h = Math.floor(sec / 3600);
      const m = Math.floor((sec % 3600) / 60).toString().padStart(2, '0');
      const s = (sec % 60).toString().padStart(2, '0');
      setTimerLabel(`${h}:${m}:${s}`);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => { clearInterval(id); setTimerLabel('Time Tracker'); };
  }, [isRunning, storeStartedAt]);

  function isActive(href: string) {
    return href === '/dashboard' ? pathname === href : pathname.startsWith(href);
  }

  function navLink({ href, label, icon: Icon }: NavItem) {
    const active = isActive(href);
    return (
      <Link
        key={href}
        href={href}
        className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors"
        style={{
          background: active ? 'var(--sidebar-item-active)' : undefined,
          color: active ? 'var(--sidebar-text)' : 'var(--sidebar-muted)',
        }}
        onMouseEnter={(e) => { if (!active) hoverOn(e); }}
        onMouseLeave={(e) => { if (!active) hoverOff(e); }}
      >
        <Icon size={18} />
        {label}
      </Link>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <nav className="flex-1 px-3 py-4">
        {/* Timer — label shows live elapsed time when running */}
        <div className="space-y-1 mb-1">
          {(() => {
            const active = isActive('/dashboard/timer');
            return (
              <Link
                href="/dashboard/timer"
                className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors"
                style={{
                  background: active ? 'var(--sidebar-item-active)' : undefined,
                  color: active ? 'var(--sidebar-text)' : 'var(--sidebar-muted)',
                }}
                onMouseEnter={(e) => { if (!active) hoverOn(e); }}
                onMouseLeave={(e) => { if (!active) hoverOff(e); }}
              >
                <Clock size={18} />
                {timerLabel}
              </Link>
            );
          })()}
        </div>

        <div style={{ borderTop: '1px solid var(--sidebar-border)', margin: '4px 4px 0' }} />

        {/* Analyze */}
        <button
          type="button"
          onClick={() => setAnalyzeOpen((v) => !v)}
          aria-expanded={analyzeOpen}
          className="flex items-center justify-between w-full px-3 pt-4 pb-1 text-[10px] uppercase tracking-[0.1em] transition-opacity hover:opacity-75"
          style={{ color: 'var(--sidebar-muted)' }}
        >
          Analyze
          <ChevronDown
            size={11}
            className="transition-transform duration-200"
            style={{ transform: analyzeOpen ? 'rotate(0deg)' : 'rotate(-90deg)' }}
          />
        </button>
        {analyzeOpen && <div className="space-y-1">{analyzeItems.map(navLink)}</div>}

        <div style={{ borderTop: '1px solid var(--sidebar-border)', margin: '8px 4px 0' }} />

        {/* Manage */}
        <button
          type="button"
          onClick={() => setManageOpen((v) => !v)}
          aria-expanded={manageOpen}
          className="flex items-center justify-between w-full px-3 pt-4 pb-1 text-[10px] uppercase tracking-[0.1em] transition-opacity hover:opacity-75"
          style={{ color: 'var(--sidebar-muted)' }}
        >
          Manage
          <ChevronDown
            size={11}
            className="transition-transform duration-200"
            style={{ transform: manageOpen ? 'rotate(0deg)' : 'rotate(-90deg)' }}
          />
        </button>
        {manageOpen && (
          <div className="space-y-1">
            {[...manageItems, ...(isAdmin ? adminItems : [])].map(navLink)}
          </div>
        )}
      </nav>

      <div className="px-3 py-3 space-y-1" style={{ borderTop: '1px solid var(--sidebar-border)' }}>
        {/* Settings */}
        {(() => {
          const active =
            pathname.startsWith('/dashboard/settings') && !pathname.includes('tab=integrations');
          return (
            <Link
              href="/dashboard/settings"
              className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors"
              style={{
                background: active ? 'var(--sidebar-item-active)' : undefined,
                color: active ? 'var(--sidebar-text)' : 'var(--sidebar-muted)',
              }}
              onMouseEnter={(e) => { if (!active) hoverOn(e); }}
              onMouseLeave={(e) => { if (!active) hoverOff(e); }}
            >
              <Settings size={18} />
              Settings
            </Link>
          );
        })()}

        {/* Integrations */}
        {(() => {
          const active = pathname.includes('tab=integrations');
          return (
            <Link
              href="/dashboard/settings?tab=integrations"
              className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors"
              style={{
                background: active ? 'var(--sidebar-item-active)' : undefined,
                color: active ? 'var(--sidebar-text)' : 'var(--sidebar-muted)',
              }}
              onMouseEnter={(e) => { if (!active) hoverOn(e); }}
              onMouseLeave={(e) => { if (!active) hoverOff(e); }}
            >
              <Plug size={18} />
              <span className="flex-1">Integrations</span>
              <span className="flex items-center gap-1 opacity-50">
                <SiQuickbooks size={11} />
                <SiXero size={11} />
              </span>
            </Link>
          );
        })()}

        {/* Theme toggle */}
        <button
          type="button"
          onClick={toggle}
          className="flex items-center gap-3 w-full px-3 py-2 rounded-lg text-sm transition-colors"
          style={{ color: 'var(--sidebar-muted)' }}
          onMouseEnter={hoverOn}
          onMouseLeave={hoverOff}
        >
          {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
          {theme === 'dark' ? 'Light mode' : 'Dark mode'}
        </button>

        {/* User info */}
        <div className="flex items-center gap-3 px-3 py-2.5">
          <Avatar className="w-7 h-7 shrink-0">
            <AvatarImage src={user.image ?? undefined} alt={user.name} />
            <AvatarFallback
              className="text-xs text-white"
              style={{ background: 'var(--sidebar-active)' }}
            >
              {user.name?.[0]?.toUpperCase() ?? '?'}
            </AvatarFallback>
          </Avatar>
          <div className="overflow-hidden flex-1">
            <p className="text-sm font-medium truncate" style={{ color: 'var(--sidebar-text)' }}>
              {user.name}
            </p>
            <p className="text-xs truncate" style={{ color: 'var(--sidebar-muted)' }}>
              {user.organizationName}
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => signOut({ callbackUrl: '/auth/signin' })}
          className="flex items-center gap-2 w-full px-3 py-2 text-sm rounded-lg transition-colors"
          style={{ color: 'var(--sidebar-muted)' }}
          onMouseEnter={hoverOn}
          onMouseLeave={hoverOff}
        >
          <LogOut className="w-4 h-4" />
          Sign out
        </button>
      </div>
    </div>
  );
}
