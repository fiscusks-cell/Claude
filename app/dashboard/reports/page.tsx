'use client';

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  format,
  startOfWeek,
  endOfWeek,
  startOfMonth,
  endOfMonth,
  startOfYear,
  endOfYear,
  subWeeks,
  subMonths,
  eachDayOfInterval,
  parseISO,
} from 'date-fns';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
} from 'recharts';
import {
  Download,
  ChevronDown,
  ChevronRight,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Bookmark,
  Play,
  Trash2,
  X,
} from 'lucide-react';
import { formatCurrency } from '@/lib/utils';
import { groupCurrencyTotals, formatGroupedAmounts } from '@/lib/currency';
import { ProjectCombobox } from '@/components/ui/ProjectCombobox';
import { ProjectIconOrDot } from '@/components/ui/ProjectIconOrDot';

// ─── Types ───────────────────────────────────────────────────────────────────

interface TimeEntry {
  id: string;
  userId: string;
  projectId: string | null;
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
    hourlyRate: any;
    isBillable: boolean;
    client: { id: string; name: string; currency: string } | null;
  } | null;
  user: { id: string; name: string | null };
}

interface ByDay {
  date: string;
  seconds: number;
  billableSeconds: number;
}

interface MemberStat {
  userId: string;
  userName: string;
  totalSeconds: number;
  billableSeconds: number;
  billableAmount: number;
}

interface ProjectStat {
  projectId: string | null;
  projectName: string;
  projectColor: string;
  projectIcon: string | null;
  clientId: string | null;
  clientName: string | null;
  clientCurrency: string;
  totalSeconds: number;
  billableSeconds: number;
  billableAmount: number;
  members: MemberStat[];
}

interface ReportData {
  entries: TimeEntry[];
  byDay: ByDay[];
  byProject: ProjectStat[];
  totals: {
    totalSeconds: number;
    billableSeconds: number;
    totalAmount: number;
    activeDays: number;
  };
}

interface TeamMember {
  id: string;
  name: string | null;
  email: string;
  role: string;
  kind?: string;
}

interface ProjectOption {
  id: string;
  name: string;
  color: string;
  icon?: string | null;
  clientName?: string | null;
}

type Preset =
  | 'today'
  | 'this_week'
  | 'last_week'
  | 'this_month'
  | 'last_month'
  | 'this_year'
  | 'custom';

type ActiveTab = 'summary' | 'detailed' | 'workload' | 'profitability' | 'my_reports';

interface SavedReport {
  id: string;
  name: string;
  tab: 'summary' | 'detailed' | 'workload' | 'profitability';
  preset: Preset;
  customStart: string;
  customEnd: string;
  filters: { clientId: string; projectId: string; userId: string; billable: string };
  savedAt: string;
}

type EditingCell = {
  entryId: string;
  field: 'description' | 'projectId' | 'startedAt' | 'stoppedAt' | 'duration' | 'isBillable';
} | null;

// ─── Constants ───────────────────────────────────────────────────────────────

const PRESETS: { value: Preset; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: 'this_week', label: 'This Week' },
  { value: 'last_week', label: 'Last Week' },
  { value: 'this_month', label: 'This Month' },
  { value: 'last_month', label: 'Last Month' },
  { value: 'this_year', label: 'This Year' },
  { value: 'custom', label: 'Custom Range' },
];

const TABS: { value: ActiveTab; label: string }[] = [
  { value: 'summary', label: 'Summary' },
  { value: 'detailed', label: 'Detailed' },
  { value: 'workload', label: 'Workload' },
  { value: 'profitability', label: 'Profitability' },
  { value: 'my_reports', label: 'My Reports' },
];

const LS_KEY = 'ora-saved-reports';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtHours(seconds: number) {
  const totalMinutes = Math.round(seconds / 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${h}:${String(m).padStart(2, '0')}`;
}

function fmtHoursChart(seconds: number) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}:${String(m).padStart(2, '0')}`;
}

function fmtTime(isoString: string) {
  try {
    return format(new Date(isoString), 'HH:mm');
  } catch {
    return '—';
  }
}

function workloadCellClass(seconds: number) {
  const h = seconds / 3600;
  if (h === 0) return 'bg-slate-800 text-slate-600';
  if (h < 4) return 'bg-indigo-950 text-indigo-400';
  if (h < 6) return 'bg-indigo-900 text-indigo-300';
  if (h < 8) return 'bg-indigo-700 text-indigo-100';
  return 'bg-emerald-800 text-emerald-200';
}

function downloadCSV(rows: string[][], filename: string) {
  const csv = rows.map((r) => r.map((v) => `"${v}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Small components ─────────────────────────────────────────────────────────

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
      <p className="text-xs text-slate-500 uppercase tracking-wide mb-1">{label}</p>
      <p className="text-2xl text-white">{value}</p>
    </div>
  );
}

function SortIcon({
  col,
  sortCol,
  sortDir,
}: {
  col: string;
  sortCol: string;
  sortDir: 'asc' | 'desc';
}) {
  if (sortCol !== col) return <ArrowUpDown size={12} className="ml-1 inline text-slate-600" />;
  return sortDir === 'asc' ? (
    <ArrowUp size={12} className="ml-1 inline text-indigo-400" />
  ) : (
    <ArrowDown size={12} className="ml-1 inline text-indigo-400" />
  );
}

const SELECT_CLS =
  'bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-indigo-500';

// ─── Main component ───────────────────────────────────────────────────────────

export default function ReportsPage() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('summary');
  const [preset, setPreset] = useState<Preset>('this_week');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [filters, setFilters] = useState({
    clientId: '',
    projectId: '',
    userId: '',
    billable: '' as '' | 'true' | 'false',
  });
  const [data, setData] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(false);
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [allClients, setAllClients] = useState<{ id: string; name: string }[]>([]);
  const [allFilterProjects, setAllFilterProjects] = useState<{ id: string; name: string; isArchived: boolean }[]>([]);
  const [projectDetails, setProjectDetails] = useState<
    Record<string, NonNullable<TimeEntry['project']>>
  >({});
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set());

  // Detailed tab state
  const [detailPage, setDetailPage] = useState(0);
  const [sortCol, setSortCol] = useState('date');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const PAGE_SIZE = 50;

  // Inline editing state
  const [editingCell, setEditingCell] = useState<EditingCell>(null);
  const [editValue, setEditValue] = useState<string>('');
  const [rowStates, setRowStates] = useState<
    Record<string, 'idle' | 'saving' | 'saved' | 'error'>
  >({});

  // My Reports state
  const [savedReports, setSavedReports] = useState<SavedReport[]>([]);
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [saveReportName, setSaveReportName] = useState('');
  const saveInputRef = useRef<HTMLInputElement>(null);

  // PDF export state
  const [orgName, setOrgName] = useState('');
  const [pdfGenerating, setPdfGenerating] = useState(false);

  // ── Load saved reports ──────────────────────────────────────────────────────
  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) setSavedReports(JSON.parse(raw) as SavedReport[]);
    } catch {
      // ignore
    }
  }, []);

  // ── Date range ──────────────────────────────────────────────────────────────
  const dateRange = useMemo(() => {
    const now = new Date();
    switch (preset) {
      case 'today':
        return { start: format(now, 'yyyy-MM-dd'), end: format(now, 'yyyy-MM-dd') };
      case 'this_week':
        return {
          start: format(startOfWeek(now, { weekStartsOn: 1 }), 'yyyy-MM-dd'),
          end: format(endOfWeek(now, { weekStartsOn: 1 }), 'yyyy-MM-dd'),
        };
      case 'last_week': {
        const lw = subWeeks(now, 1);
        return {
          start: format(startOfWeek(lw, { weekStartsOn: 1 }), 'yyyy-MM-dd'),
          end: format(endOfWeek(lw, { weekStartsOn: 1 }), 'yyyy-MM-dd'),
        };
      }
      case 'this_month':
        return {
          start: format(startOfMonth(now), 'yyyy-MM-dd'),
          end: format(endOfMonth(now), 'yyyy-MM-dd'),
        };
      case 'last_month': {
        const lm = subMonths(now, 1);
        return {
          start: format(startOfMonth(lm), 'yyyy-MM-dd'),
          end: format(endOfMonth(lm), 'yyyy-MM-dd'),
        };
      }
      case 'this_year':
        return {
          start: format(startOfYear(now), 'yyyy-MM-dd'),
          end: format(endOfYear(now), 'yyyy-MM-dd'),
        };
      case 'custom':
        return { start: customStart, end: customEnd };
    }
  }, [preset, customStart, customEnd]);

  // ── Fetch reports ───────────────────────────────────────────────────────────
  // byDay / byProject / totals are aggregated server-side, so this request is the only
  // thing that can bring them back in step after an entry changes.
  const reportSeq = useRef(0);
  const activeLoads = useRef(0);
  const pendingEdits = useRef(new Map<string, Partial<TimeEntry>>());

  // An in-flight edit is re-applied over a freshly fetched list, so a response issued
  // before that edit landed can't visibly undo the user's own change.
  const applyPendingEdits = useCallback((d: ReportData): ReportData => {
    if (pendingEdits.current.size === 0) return d;
    return {
      ...d,
      entries: d.entries.map((e) => {
        const patch = pendingEdits.current.get(e.id);
        return patch ? { ...e, ...patch } : e;
      }),
    };
  }, []);

  const fetchReport = useCallback(
    async ({ silent = false }: { silent?: boolean } = {}): Promise<boolean> => {
      if (!dateRange.start || !dateRange.end) return false;
      const params = new URLSearchParams({
        startDate: dateRange.start,
        endDate: dateRange.end + 'T23:59:59',
      });
      if (filters.clientId) params.set('clientId', filters.clientId);
      if (filters.projectId) params.set('projectId', filters.projectId);
      if (filters.userId) params.set('userId', filters.userId);
      if (filters.billable) params.set('billable', filters.billable);

      const seq = ++reportSeq.current;
      if (!silent) {
        activeLoads.current += 1;
        setLoading(true);
      }
      try {
        const res = await fetch(`/api/reports?${params}`);
        if (!res.ok) throw new Error(`Reports request failed: ${res.status}`);
        const d = (await res.json()) as ReportData;
        // Superseded while in flight — dropping it stops a slow earlier response from
        // overwriting newer data.
        if (seq !== reportSeq.current) return true;
        setData(applyPendingEdits(d));
        setRefreshError(null);
        return true;
      } catch (err) {
        console.error(err);
        // Only the newest request reports failure; a superseded one is not the
        // caller's answer.
        return seq !== reportSeq.current;
      } finally {
        if (!silent) {
          activeLoads.current -= 1;
          if (activeLoads.current === 0) setLoading(false);
        }
      }
    },
    [dateRange, filters, applyPendingEdits],
  );

  useEffect(() => {
    void fetchReport();
  }, [fetchReport]);

  // ── Fetch org-scoped filter options (once on mount, independent of report filters) ──
  useEffect(() => {
    Promise.all([
      fetch('/api/team').then((r) => (r.ok ? r.json() : [])),
      fetch('/api/clients').then((r) => (r.ok ? r.json() : [])),
      fetch('/api/projects?includeArchived=true').then((r) => (r.ok ? r.json() : [])),
    ])
      .then(([team, clients, rawProjects]) => {
        setTeamMembers(team as TeamMember[]);
        setAllClients((clients as { id: string; name: string }[]).map(({ id, name }) => ({ id, name })));
        const rp = rawProjects as {
          id: string; name: string; color: string; icon?: string | null;
          hourlyRate: string | number; isBillable: boolean; isArchived: boolean;
          client?: { id: string; name: string; currency: string } | null;
        }[];
        setAllFilterProjects(rp.map((p) => ({ id: p.id, name: p.name, isArchived: p.isArchived })));
        setProjects(rp.map((p) => ({
          id: p.id, name: p.name, color: p.color,
          icon: p.icon ?? null, clientName: p.client?.name ?? null,
        })));
        // Full project shape for inline edits. The PATCH response's project include
        // omits icon and client currency, so reconcile against this rather than it.
        setProjectDetails(
          Object.fromEntries(
            rp.map((p) => [
              p.id,
              {
                id: p.id, name: p.name, color: p.color, icon: p.icon ?? null,
                hourlyRate: p.hourlyRate, isBillable: p.isBillable, client: p.client ?? null,
              },
            ]),
          ),
        );
      })
      .catch(console.error);
  }, []);

  // ── Fetch org name (for PDF footer) ─────────────────────────────────────────
  useEffect(() => {
    fetch('/api/org')
      .then((r) => r.json())
      .then((d: { name?: string }) => setOrgName(d.name ?? ''))
      .catch(() => {});
  }, []);


  // ── Bar chart data ──────────────────────────────────────────────────────────
  const barData = useMemo(() => {
    if (!dateRange.start || !dateRange.end) return [];
    const dayMap = new Map<string, number>();
    if (data) {
      for (const d of data.byDay) dayMap.set(d.date, d.seconds);
    }
    const start = parseISO(dateRange.start);
    const end = parseISO(dateRange.end);
    return eachDayOfInterval({ start, end }).map((day) => {
      const key = format(day, 'yyyy-MM-dd');
      return { date: format(day, 'MMM d'), hours: (dayMap.get(key) ?? 0) / 3600 };
    });
  }, [data, dateRange]);

  // ── Pie chart data ──────────────────────────────────────────────────────────
  const pieData = useMemo(() => {
    if (!data) return [];
    return data.byProject.map((p) => ({
      name: p.projectName,
      value: p.totalSeconds,
      color: p.projectColor,
    }));
  }, [data]);

  // ── Workload grid ───────────────────────────────────────────────────────────
  const workloadDays = useMemo((): Date[] => {
    if (!dateRange.start || !dateRange.end) return [];
    return eachDayOfInterval({ start: parseISO(dateRange.start), end: parseISO(dateRange.end) });
  }, [dateRange]);

  const workloadMap = useMemo(() => {
    if (!data) return new Map<string, Map<string, number>>();
    const map = new Map<string, Map<string, number>>();
    for (const entry of data.entries) {
      const day = entry.startedAt.slice(0, 10);
      if (!map.has(entry.userId)) map.set(entry.userId, new Map());
      const dayMap = map.get(entry.userId)!;
      dayMap.set(day, (dayMap.get(day) ?? 0) + (entry.durationSeconds ?? 0));
    }
    return map;
  }, [data]);

  // ── Sorted detailed entries ─────────────────────────────────────────────────
  const sortedEntries = useMemo(() => {
    if (!data) return [];
    const entries = [...data.entries];
    entries.sort((a, b) => {
      let av: string | number = 0;
      let bv: string | number = 0;
      switch (sortCol) {
        case 'date':
        case 'start':
          av = a.startedAt; bv = b.startedAt; break;
        case 'member':
          av = a.user.name ?? ''; bv = b.user.name ?? ''; break;
        case 'client':
          av = a.project?.client?.name ?? ''; bv = b.project?.client?.name ?? ''; break;
        case 'project':
          av = a.project?.name ?? ''; bv = b.project?.name ?? ''; break;
        case 'description':
          av = a.description ?? ''; bv = b.description ?? ''; break;
        case 'end':
          av = a.stoppedAt ?? ''; bv = b.stoppedAt ?? ''; break;
        case 'duration':
          av = a.durationSeconds ?? 0; bv = b.durationSeconds ?? 0; break;
        case 'billable':
          av = a.isBillable ? 1 : 0; bv = b.isBillable ? 1 : 0; break;
        case 'amount':
          av = a.isBillable && a.project ? ((a.durationSeconds ?? 0) / 3600) * Number(a.project.hourlyRate) : 0;
          bv = b.isBillable && b.project ? ((b.durationSeconds ?? 0) / 3600) * Number(b.project.hourlyRate) : 0;
          break;
      }
      if (av < bv) return sortDir === 'asc' ? -1 : 1;
      if (av > bv) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
    return entries;
  }, [data, sortCol, sortDir]);

  const pagedEntries = useMemo(
    () => sortedEntries.slice(detailPage * PAGE_SIZE, (detailPage + 1) * PAGE_SIZE),
    [sortedEntries, detailPage],
  );

  // ── Profitability rows ──────────────────────────────────────────────────────
  const profitRows = useMemo(() => {
    if (!data) return [];
    return [...data.byProject].sort((a, b) => b.billableAmount - a.billableAmount);
  }, [data]);

  // ── Sort handler ────────────────────────────────────────────────────────────
  const handleSort = useCallback((col: string) => {
    setSortCol((prev) => {
      if (prev === col) {
        setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
        return prev;
      }
      setSortDir('asc');
      return col;
    });
    setDetailPage(0);
  }, []);

  // ── Toggle project expand ───────────────────────────────────────────────────
  function toggleProject(key: string) {
    setExpandedProjects((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  // ── Inline editing ──────────────────────────────────────────────────────────
  function startEdit(entryId: string, field: NonNullable<EditingCell>['field'], value: string) {
    setEditingCell({ entryId, field });
    setEditValue(value);
  }

  function cancelEdit() {
    setEditingCell(null);
    setEditValue('');
  }

  const patchEntry = useCallback((entryId: string, patch: Partial<TimeEntry>) => {
    setData((prev) =>
      prev
        ? { ...prev, entries: prev.entries.map((e) => (e.id === entryId ? { ...e, ...patch } : e)) }
        : prev,
    );
  }, []);

  const resolveProject = useCallback(
    (projectId: string | null | undefined): TimeEntry['project'] =>
      projectId ? projectDetails[projectId] ?? null : null,
    [projectDetails],
  );

  // The PATCH body plus the matching local patch, so the row shows the new value before
  // the round trip finishes. Duration mirrors the server's own recalculation.
  function buildEditPatch(
    entry: TimeEntry,
    field: NonNullable<EditingCell>['field'],
    value: string,
  ): { body: Record<string, unknown>; optimistic: Partial<TimeEntry> } | null {
    const secondsBetween = (startedAt: string, stoppedAt: string) =>
      Math.max(
        0,
        Math.round((new Date(stoppedAt).getTime() - new Date(startedAt).getTime()) / 1000),
      );
    const atTime = (base: string, hhmm: string): string | null => {
      const [h, m] = hhmm.split(':').map(Number);
      if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
      const d = new Date(base);
      d.setHours(h, m, 0, 0);
      return d.toISOString();
    };

    switch (field) {
      case 'description':
        return { body: { description: value }, optimistic: { description: value } };
      case 'projectId': {
        const projectId = value || null;
        return {
          body: { projectId },
          optimistic: { projectId, project: resolveProject(projectId) },
        };
      }
      case 'startedAt': {
        const startedAt = atTime(entry.startedAt, value);
        if (!startedAt) return null;
        return {
          body: { startedAt },
          optimistic: {
            startedAt,
            durationSeconds: entry.stoppedAt ? secondsBetween(startedAt, entry.stoppedAt) : null,
          },
        };
      }
      case 'stoppedAt': {
        if (!entry.stoppedAt) return null;
        const stoppedAt = atTime(entry.stoppedAt, value);
        if (!stoppedAt) return null;
        return {
          body: { stoppedAt },
          optimistic: { stoppedAt, durationSeconds: secondsBetween(entry.startedAt, stoppedAt) },
        };
      }
      case 'duration': {
        const parts = value.split(':');
        const totalSecs = (parseInt(parts[0]) || 0) * 3600 + (parseInt(parts[1] || '0') || 0) * 60;
        const stoppedAt = new Date(
          new Date(entry.startedAt).getTime() + totalSecs * 1000,
        ).toISOString();
        return { body: { stoppedAt }, optimistic: { stoppedAt, durationSeconds: totalSecs } };
      }
      case 'isBillable': {
        const isBillable = value === 'true';
        return { body: { isBillable }, optimistic: { isBillable } };
      }
    }
  }

  async function commitEditValue(
    entry: TimeEntry,
    field: NonNullable<EditingCell>['field'],
    value: string,
  ) {
    const patch = buildEditPatch(entry, field, value);
    if (!patch) return;

    // Rollback snapshot: every field an inline edit can touch.
    const before: Partial<TimeEntry> = {
      description: entry.description,
      projectId: entry.projectId,
      project: entry.project,
      startedAt: entry.startedAt,
      stoppedAt: entry.stoppedAt,
      durationSeconds: entry.durationSeconds,
      isBillable: entry.isBillable,
    };

    setRowStates((prev) => ({ ...prev, [entry.id]: 'saving' }));
    pendingEdits.current.set(entry.id, patch.optimistic);
    patchEntry(entry.id, patch.optimistic);

    try {
      const res = await fetch(`/api/time-entries/${entry.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch.body),
      });
      if (!res.ok) throw new Error(`Save failed: ${res.status}`);
      const updated = (await res.json()) as TimeEntry;

      const reconciled: Partial<TimeEntry> = {
        description: updated.description,
        projectId: updated.projectId,
        project: resolveProject(updated.projectId) ?? updated.project,
        startedAt: updated.startedAt,
        stoppedAt: updated.stoppedAt,
        durationSeconds: updated.durationSeconds,
        isBillable: updated.isBillable,
      };
      pendingEdits.current.set(entry.id, reconciled);
      patchEntry(entry.id, reconciled);
      setRowStates((prev) => ({ ...prev, [entry.id]: 'saved' }));
      setTimeout(() => setRowStates((prev) => ({ ...prev, [entry.id]: 'idle' })), 1500);

      // Re-run the report so the aggregates match the entry list again.
      const refreshed = await fetchReport({ silent: true });
      pendingEdits.current.delete(entry.id);
      if (!refreshed) {
        // A patched entry beside stale aggregates is the bug this exists to remove, so
        // put the row back and say the report is out of date.
        patchEntry(entry.id, before);
        setRefreshError(
          'Your change was saved, but the report could not be refreshed — the figures shown are out of date.',
        );
      }
    } catch (err) {
      console.error(err);
      pendingEdits.current.delete(entry.id);
      patchEntry(entry.id, before);
      setRowStates((prev) => ({ ...prev, [entry.id]: 'error' }));
      setTimeout(() => setRowStates((prev) => ({ ...prev, [entry.id]: 'idle' })), 2000);
    }
  }

  async function commitEdit(entry: TimeEntry) {
    if (!editingCell || editingCell.entryId !== entry.id) return;
    const { field } = editingCell;
    const value = editValue;
    cancelEdit();
    await commitEditValue(entry, field, value);
  }

  // ── CSV exports ─────────────────────────────────────────────────────────────
  async function exportReportPDF() {
    if (!data) return;
    setPdfGenerating(true);
    try {
      const [{ pdf }, { ReportPDF }] = await Promise.all([
        import('@react-pdf/renderer'),
        import('@/components/reports/ReportPDF'),
      ]);
      const element = React.createElement(ReportPDF, {
        orgName: orgName || 'Ora',
        dateRange,
        entries: data.entries,
        byDay: data.byDay,
        byProject: data.byProject,
        totals: {
          totalSeconds: data.totals.totalSeconds,
          billableSeconds: data.totals.billableSeconds,
          activeDays: data.totals.activeDays,
        },
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const blob = await pdf(element as any).toBlob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `ora-report-${dateRange.start || 'custom'}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('PDF generation failed:', err);
    } finally {
      setPdfGenerating(false);
    }
  }

  function exportSummaryCSV() {
    if (!data) return;
    const rows: string[][] = [
      ['Project', 'Client', 'Member', 'Date', 'Duration (h)', 'Billable', 'Amount'],
    ];
    for (const entry of data.entries) {
      rows.push([
        entry.project?.name ?? 'No Project',
        entry.project?.client?.name ?? '',
        entry.user.name ?? '',
        format(new Date(entry.startedAt), 'yyyy-MM-dd'),
        ((entry.durationSeconds ?? 0) / 3600).toFixed(2),
        entry.isBillable ? 'Yes' : 'No',
        entry.isBillable && entry.project
          ? (((entry.durationSeconds ?? 0) / 3600) * Number(entry.project.hourlyRate)).toFixed(2)
          : '0',
      ]);
    }
    downloadCSV(rows, 'ora-summary.csv');
  }

  function exportDetailedCSV() {
    if (!data) return;
    const rows: string[][] = [
      ['Date', 'Member', 'Client', 'Project', 'Description', 'Start', 'End', 'Duration (h)', 'Billable', 'Amount'],
    ];
    for (const entry of sortedEntries) {
      rows.push([
        format(new Date(entry.startedAt), 'yyyy-MM-dd'),
        entry.user.name ?? '',
        entry.project?.client?.name ?? '',
        entry.project?.name ?? 'No Project',
        entry.description ?? '',
        fmtTime(entry.startedAt),
        entry.stoppedAt ? fmtTime(entry.stoppedAt) : '',
        ((entry.durationSeconds ?? 0) / 3600).toFixed(2),
        entry.isBillable ? 'Yes' : 'No',
        entry.isBillable && entry.project
          ? (((entry.durationSeconds ?? 0) / 3600) * Number(entry.project.hourlyRate)).toFixed(2)
          : '0',
      ]);
    }
    downloadCSV(rows, 'ora-detailed.csv');
  }

  // ── Save / load reports ─────────────────────────────────────────────────────
  function openSaveModal() {
    setSaveReportName('');
    setShowSaveModal(true);
    setTimeout(() => saveInputRef.current?.focus(), 50);
  }

  function saveReport() {
    if (!saveReportName.trim()) return;
    const tab = activeTab === 'my_reports' ? 'summary' : activeTab;
    const report: SavedReport = {
      id: crypto.randomUUID(),
      name: saveReportName.trim(),
      tab,
      preset,
      customStart,
      customEnd,
      filters: { ...filters },
      savedAt: new Date().toISOString(),
    };
    const next = [report, ...savedReports];
    setSavedReports(next);
    try { localStorage.setItem(LS_KEY, JSON.stringify(next)); } catch { /* ignore */ }
    setShowSaveModal(false);
  }

  function deleteReport(id: string) {
    const next = savedReports.filter((r) => r.id !== id);
    setSavedReports(next);
    try { localStorage.setItem(LS_KEY, JSON.stringify(next)); } catch { /* ignore */ }
  }

  function runReport(report: SavedReport) {
    setPreset(report.preset);
    setCustomStart(report.customStart);
    setCustomEnd(report.customEnd);
    setFilters({
      clientId: report.filters.clientId,
      projectId: report.filters.projectId,
      userId: report.filters.userId,
      billable: report.filters.billable as '' | 'true' | 'false',
    });
    setActiveTab(report.tab);
  }

  // ── Filter bar ──────────────────────────────────────────────────────────────
  function FilterBar({
    showMember = true,
    showBillable = true,
    showProject = true,
    showClient = true,
  }: {
    showMember?: boolean;
    showBillable?: boolean;
    showProject?: boolean;
    showClient?: boolean;
  }) {
    return (
      <div className="flex gap-3 flex-wrap">
        {showClient && (
          <select
            value={filters.clientId}
            onChange={(e) => setFilters((f) => ({ ...f, clientId: e.target.value, projectId: '' }))}
            className={SELECT_CLS}
          >
            <option value="">All Clients</option>
            {allClients.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        )}
        {showProject && (
          <select
            value={filters.projectId}
            onChange={(e) => setFilters((f) => ({ ...f, projectId: e.target.value }))}
            className={SELECT_CLS}
          >
            <option value="">All Projects</option>
            {allFilterProjects.map((p) => (
              <option key={p.id} value={p.id}>{p.isArchived ? `${p.name} (archived)` : p.name}</option>
            ))}
          </select>
        )}
        {showMember && (
          <select
            value={filters.userId}
            onChange={(e) => setFilters((f) => ({ ...f, userId: e.target.value }))}
            className={SELECT_CLS}
          >
            <option value="">All Members</option>
            {teamMembers.filter((m) => m.kind === 'member').map((m) => (
              <option key={m.id} value={m.id}>{m.name ?? m.email}</option>
            ))}
          </select>
        )}
        {showBillable && (
          <select
            value={filters.billable}
            onChange={(e) =>
              setFilters((f) => ({ ...f, billable: e.target.value as '' | 'true' | 'false' }))
            }
            className={SELECT_CLS}
          >
            <option value="">All</option>
            <option value="true">Billable only</option>
            <option value="false">Non-billable only</option>
          </select>
        )}
      </div>
    );
  }

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="p-6 md:p-8 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-normal text-white">Reports</h1>
        <div className="flex gap-2">
          {activeTab !== 'my_reports' && (
            <button
              onClick={openSaveModal}
              className="flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white text-sm rounded-lg border border-slate-700 transition-colors"
            >
              <Bookmark size={15} />
              Save Report
            </button>
          )}
          {(activeTab === 'summary' || activeTab === 'detailed') && (
            <>
              <button
                onClick={exportReportPDF}
                disabled={!data || data.entries.length === 0 || pdfGenerating}
                className="flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm rounded-lg border border-slate-700 transition-colors"
              >
                <Download size={15} />
                {pdfGenerating ? 'Generating…' : 'Export PDF'}
              </button>
              <button
                onClick={activeTab === 'summary' ? exportSummaryCSV : exportDetailedCSV}
                disabled={!data || data.entries.length === 0}
                className="flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm rounded-lg border border-slate-700 transition-colors"
              >
                <Download size={15} />
                Export CSV
              </button>
            </>
          )}
        </div>
      </div>

      {/* Stale-report warning: the edit landed, the refresh didn't */}
      {refreshError && (
        <div className="flex items-center justify-between gap-4 px-4 py-3 rounded-lg border border-amber-800/60 bg-amber-950/40 text-sm text-amber-200">
          <span>{refreshError}</span>
          <button
            onClick={() => void fetchReport()}
            className="px-3 py-1 rounded-md border border-amber-700/70 text-amber-100 hover:bg-amber-900/40 transition-colors whitespace-nowrap"
          >
            Retry
          </button>
        </div>
      )}

      {/* Save report modal */}
      {showSaveModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="bg-slate-900 border border-slate-700 rounded-xl p-6 w-full max-w-sm shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-white font-normal">Save Report</h2>
              <button onClick={() => setShowSaveModal(false)} className="text-slate-400 hover:text-white">
                <X size={18} />
              </button>
            </div>
            <input
              ref={saveInputRef}
              type="text"
              placeholder="Report name…"
              value={saveReportName}
              onChange={(e) => setSaveReportName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') saveReport();
                if (e.key === 'Escape') setShowSaveModal(false);
              }}
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 mb-4"
            />
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setShowSaveModal(false)}
                className="px-4 py-2 text-sm text-slate-400 hover:text-white rounded-lg"
              >
                Cancel
              </button>
              <button
                onClick={saveReport}
                disabled={!saveReportName.trim()}
                className="px-4 py-2 text-sm bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-lg transition-colors"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Tab bar */}
      <div className="flex gap-1 bg-slate-900 border border-slate-800 rounded-xl p-1 w-fit">
        {TABS.map((tab) => (
          <button
            key={tab.value}
            onClick={() => setActiveTab(tab.value)}
            className={`px-4 py-1.5 rounded-lg text-sm transition-colors whitespace-nowrap ${
              activeTab === tab.value
                ? 'bg-indigo-600 text-white'
                : 'text-slate-400 hover:text-white hover:bg-slate-800'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Date range presets */}
      {activeTab !== 'my_reports' && (
        <div className="flex gap-1 flex-wrap">
          {PRESETS.map((p) => (
            <button
              key={p.value}
              onClick={() => setPreset(p.value)}
              className={`px-3 py-1.5 rounded-lg text-sm transition-colors whitespace-nowrap border ${
                preset === p.value
                  ? 'bg-slate-700 border-slate-600 text-white'
                  : 'border-slate-800 text-slate-400 hover:text-white hover:bg-slate-800'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      )}

      {/* Custom date inputs */}
      {activeTab !== 'my_reports' && preset === 'custom' && (
        <div className="flex gap-3 items-center">
          <input
            type="date"
            value={customStart}
            onChange={(e) => setCustomStart(e.target.value)}
            className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
          <span className="text-slate-500 text-sm">to</span>
          <input
            type="date"
            value={customEnd}
            onChange={(e) => setCustomEnd(e.target.value)}
            className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
        </div>
      )}

      {/* ══════════════════════════════ SUMMARY TAB ══════════════════════════════ */}
      {activeTab === 'summary' && (
        <div className="space-y-6">
          <FilterBar />

          {loading && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="bg-slate-900 border border-slate-800 rounded-xl p-5 animate-pulse">
                  <div className="h-3 bg-slate-800 rounded w-24 mb-3" />
                  <div className="h-7 bg-slate-800 rounded w-20" />
                </div>
              ))}
            </div>
          )}

          {!loading && data && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <StatCard label="Total Hours" value={fmtHours(data.totals.totalSeconds)} />
              <StatCard label="Billable Hours" value={fmtHours(data.totals.billableSeconds)} />
              <StatCard label="Total Amount" value={formatGroupedAmounts(groupCurrencyTotals(data.byProject))} />
              <StatCard
                label="Avg Daily Hours"
                value={data.totals.activeDays > 0 ? fmtHours(data.totals.totalSeconds / data.totals.activeDays) : '0.0h'}
              />
            </div>
          )}

          {!loading && data && data.entries.length === 0 && (
            <div className="flex flex-col items-center justify-center py-20 text-slate-500">
              <p className="text-lg text-slate-400">No time entries found</p>
              <p className="text-sm mt-1">Try adjusting the date range or filters</p>
            </div>
          )}

          {!loading && data && data.entries.length > 0 && (
            <div className="grid grid-cols-1 lg:grid-cols-[55fr_45fr] gap-6">
              {/* Bar chart */}
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
                <h2 className="text-sm text-slate-300 mb-4">Hours by Day</h2>
                <ResponsiveContainer width="100%" height={350}>
                  <BarChart
                    data={barData}
                    barSize={Math.max(6, Math.min(24, 120 / (barData.length || 1)))}
                  >
                    <XAxis
                      dataKey="date"
                      tick={{ fill: '#94a3b8', fontSize: 11 }}
                      axisLine={false}
                      tickLine={false}
                      interval="preserveStartEnd"
                    />
                    <YAxis
                      tick={{ fill: '#94a3b8', fontSize: 11 }}
                      axisLine={false}
                      tickLine={false}
                      tickFormatter={(v: number) => fmtHoursChart(v * 3600)}
                      width={40}
                    />
                    <Tooltip
                      cursor={{ fill: 'rgba(99,102,241,0.08)' }}
                      contentStyle={{
                        background: '#1e293b',
                        border: '1px solid #334155',
                        borderRadius: '8px',
                        color: '#f1f5f9',
                        fontSize: 12,
                      }}
                      formatter={
                        ((value: number | undefined) => [
                          fmtHoursChart((value ?? 0) * 3600),
                          'Duration',
                        ]) as never
                      }
                    />
                    <Bar dataKey="hours" fill="#3730A3" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              {/* Donut chart */}
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
                <h2 className="text-sm text-slate-300 mb-4">By Project</h2>
                <div className="relative" style={{ minHeight: 300 }}>
                  <ResponsiveContainer width="100%" height={350}>
                    <PieChart>
                      <Pie
                        data={pieData}
                        cx="50%"
                        cy="45%"
                        innerRadius={60}
                        outerRadius={90}
                        paddingAngle={2}
                        dataKey="value"
                        isAnimationActive={false}
                      >
                        {pieData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.color} />
                        ))}
                      </Pie>
                      <Legend
                        layout="horizontal"
                        iconType="circle"
                        iconSize={8}
                        wrapperStyle={{ paddingTop: '20px' }}
                        formatter={(value, entry) => {
                          const total = pieData.reduce((s, d) => s + d.value, 0);
                          const item = pieData.find((d) => d.name === value);
                          const pct = item && total > 0 ? ((item.value / total) * 100).toFixed(1) : '0';
                          return (
                            <span style={{ color: '#94a3b8', fontSize: 11 }}>{value} ({pct}%)</span>
                          );
                        }}
                      />
                      <Tooltip
                        contentStyle={{
                          background: '#1e293b',
                          border: '1px solid #334155',
                          borderRadius: '8px',
                          color: '#f1f5f9',
                          fontSize: 12,
                        }}
                        formatter={
                          ((value: number | undefined) => [fmtHours(value ?? 0), 'Duration']) as never
                        }
                      />
                    </PieChart>
                  </ResponsiveContainer>
                  <div
                    className="absolute top-0 left-0 right-0 flex flex-col items-center justify-center pointer-events-none"
                    style={{ height: 200 }}
                  >
                    <span className="text-xl text-white">
                      {fmtHours(data.totals.totalSeconds)}
                    </span>
                    <span className="text-xs text-slate-500">total</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Breakdown table */}
          {!loading && data && data.byProject.length > 0 && (
            <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-800">
                    <th className="text-left px-4 py-3 text-slate-400">Project</th>
                    <th className="text-left px-4 py-3 text-slate-400 hidden md:table-cell">Client</th>
                    <th className="text-right px-4 py-3 text-slate-400">Duration</th>
                    <th className="text-right px-4 py-3 text-slate-400 hidden sm:table-cell">%</th>
                    <th className="text-right px-4 py-3 text-slate-400">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {data.byProject.map((proj) => {
                    const key = proj.projectId ?? '__none__';
                    const isExpanded = expandedProjects.has(key);
                    const pct =
                      data.totals.totalSeconds > 0
                        ? ((proj.totalSeconds / data.totals.totalSeconds) * 100).toFixed(1)
                        : '0.0';
                    return (
                      <React.Fragment key={key}>
                        <tr
                          className="border-b border-slate-800/60 hover:bg-slate-800/30 cursor-pointer"
                          onClick={() => toggleProject(key)}
                        >
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              {isExpanded ? (
                                <ChevronDown size={14} className="text-slate-500 flex-shrink-0" />
                              ) : (
                                <ChevronRight size={14} className="text-slate-500 flex-shrink-0" />
                              )}
                              <ProjectIconOrDot icon={proj.projectIcon} color={proj.projectColor} size={24} />
                              <span className="text-white truncate">{proj.projectName}</span>
                            </div>
                          </td>
                          <td className="px-4 py-3 text-slate-400 hidden md:table-cell">
                            {proj.clientName ?? <span className="text-slate-600">—</span>}
                          </td>
                          <td className="px-4 py-3 text-right text-slate-200">
                            {fmtHours(proj.totalSeconds)}
                          </td>
                          <td className="px-4 py-3 text-right text-slate-400 hidden sm:table-cell">
                            {pct}%
                          </td>
                          <td className="px-4 py-3 text-right text-slate-200">
                            {proj.billableAmount > 0 ? (
                              formatCurrency(proj.billableAmount, proj.clientCurrency)
                            ) : (
                              <span className="text-slate-600">—</span>
                            )}
                          </td>
                        </tr>
                        {isExpanded &&
                          proj.members.map((member) => {
                            const memberPct =
                              proj.totalSeconds > 0
                                ? ((member.totalSeconds / proj.totalSeconds) * 100).toFixed(1)
                                : '0.0';
                            return (
                              <tr key={`${key}-${member.userId}`} className="border-b border-slate-800/30 bg-slate-900/50">
                                <td className="px-4 py-2.5 pl-12">
                                  <span className="text-slate-400">{member.userName}</span>
                                </td>
                                <td className="px-4 py-2.5 hidden md:table-cell" />
                                <td className="px-4 py-2.5 text-right text-slate-400">
                                  {fmtHours(member.totalSeconds)}
                                </td>
                                <td className="px-4 py-2.5 text-right text-slate-500 hidden sm:table-cell">
                                  {memberPct}%
                                </td>
                                <td className="px-4 py-2.5 text-right text-slate-400">
                                  {member.billableAmount > 0 ? (
                                    formatCurrency(member.billableAmount, proj.clientCurrency)
                                  ) : (
                                    <span className="text-slate-600">—</span>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                      </React.Fragment>
                    );
                  })}
                  <tr className="bg-slate-800/40">
                    <td className="px-4 py-3 text-white">Total</td>
                    <td className="hidden md:table-cell" />
                    <td className="px-4 py-3 text-right text-white">
                      {fmtHours(data.totals.totalSeconds)}
                    </td>
                    <td className="px-4 py-3 text-right text-slate-400 hidden sm:table-cell">100%</td>
                    <td className="px-4 py-3 text-right text-white">
                      {formatGroupedAmounts(groupCurrencyTotals(data.byProject))}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ══════════════════════════════ DETAILED TAB ══════════════════════════════ */}
      {activeTab === 'detailed' && (
        <div className="space-y-6">
          <FilterBar />

          {loading && (
            <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-800 flex gap-4">
                {[80, 100, 80, 120, 160, 60, 60, 60, 60, 80].map((w, i) => (
                  <div key={i} className="h-3 bg-slate-800 rounded animate-pulse" style={{ width: w }} />
                ))}
              </div>
              {[1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="px-4 py-3.5 border-b border-slate-800/60 flex gap-4 animate-pulse">
                  {[80, 100, 80, 120, 200, 60, 60, 60, 60, 80].map((w, j) => (
                    <div key={j} className="h-3 bg-slate-800 rounded" style={{ width: w }} />
                  ))}
                </div>
              ))}
            </div>
          )}

          {!loading && data && data.entries.length === 0 && (
            <div className="flex flex-col items-center justify-center py-20 text-slate-500">
              <p className="text-lg text-slate-400">No entries for this period</p>
              <p className="text-sm mt-1">Try adjusting the date range or filters</p>
            </div>
          )}

          {!loading && data && data.entries.length > 0 && (
            <>
              <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-x-auto">
                <table className="w-full text-sm min-w-[1000px]">
                  <thead>
                    <tr className="border-b border-slate-800">
                      {(
                        [
                          ['date', 'Date'],
                          ['member', 'Member'],
                          ['client', 'Client'],
                          ['project', 'Project'],
                          ['description', 'Description'],
                          ['start', 'Start'],
                          ['end', 'End'],
                          ['duration', 'Duration'],
                          ['billable', '$'],
                          ['amount', 'Amount'],
                        ] as [string, string][]
                      ).map(([col, label]) => (
                        <th
                          key={col}
                          className="px-4 py-3 text-left text-slate-400 cursor-pointer select-none hover:text-slate-200 whitespace-nowrap"
                          onClick={() => handleSort(col)}
                        >
                          {label}
                          <SortIcon col={col} sortCol={sortCol} sortDir={sortDir} />
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {pagedEntries.map((entry) => {
                      const rowState = rowStates[entry.id] ?? 'idle';
                      const isEditing = editingCell?.entryId === entry.id;
                      const amount =
                        entry.isBillable && entry.project
                          ? ((entry.durationSeconds ?? 0) / 3600) * Number(entry.project.hourlyRate)
                          : 0;

                      let rowCls = 'border-b border-slate-800/60 ';
                      if (rowState === 'saved') rowCls += 'bg-emerald-950/40 transition-colors';
                      else if (rowState === 'error') rowCls += 'bg-red-950/40 transition-colors';
                      else if (rowState === 'saving') rowCls += 'opacity-60';
                      else rowCls += 'hover:bg-slate-800/30';

                      return (
                        <tr key={entry.id} className={rowCls}>
                          {/* Date */}
                          <td className="px-4 py-3 text-slate-300 whitespace-nowrap">
                            <div className="flex items-center gap-1.5">
                              {isEditing && (
                                <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse flex-shrink-0" />
                              )}
                              {format(new Date(entry.startedAt), 'MMM d, yyyy')}
                            </div>
                          </td>

                          {/* Member */}
                          <td className="px-4 py-3 text-slate-300 whitespace-nowrap">
                            {entry.user.name ?? '—'}
                          </td>

                          {/* Client */}
                          <td className="px-4 py-3 text-slate-400 whitespace-nowrap">
                            {entry.project?.client?.name ?? <span className="text-slate-600">—</span>}
                          </td>

                          {/* Project */}
                          <td
                            className="px-4 py-3 whitespace-nowrap cursor-pointer"
                            onClick={() => startEdit(entry.id, 'projectId', entry.projectId ?? '')}
                          >
                            {editingCell?.entryId === entry.id && editingCell.field === 'projectId' ? (
                              <div className="w-48">
                                <ProjectCombobox
                                  projects={projects}
                                  value={editValue || null}
                                  onChange={(id) => {
                                    setEditValue(id ?? '');
                                    void commitEditValue(entry, 'projectId', id ?? '');
                                    cancelEdit();
                                  }}
                                />
                              </div>
                            ) : (
                              <div className="flex items-center gap-1.5">
                                {entry.project && (
                                  <ProjectIconOrDot icon={entry.project.icon} color={entry.project.color} size={20} dotClassName="w-2 h-2" />
                                )}
                                <span className="text-slate-300 hover:text-white">
                                  {entry.project?.name ?? <span className="text-slate-600">No project</span>}
                                </span>
                              </div>
                            )}
                          </td>

                          {/* Description */}
                          <td
                            className="px-4 py-3 max-w-[200px] cursor-pointer"
                            onClick={() => startEdit(entry.id, 'description', entry.description ?? '')}
                          >
                            {editingCell?.entryId === entry.id && editingCell.field === 'description' ? (
                              <input
                                autoFocus
                                value={editValue}
                                onChange={(e) => setEditValue(e.target.value)}
                                onBlur={() => void commitEdit(entry)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') void commitEdit(entry);
                                  if (e.key === 'Escape') cancelEdit();
                                }}
                                className="bg-slate-800 border border-indigo-500 rounded px-2 py-0.5 text-sm text-white w-full focus:outline-none"
                              />
                            ) : (
                              <span className="text-slate-400 truncate block hover:text-slate-200">
                                {entry.description ?? <span className="text-slate-600">—</span>}
                              </span>
                            )}
                          </td>

                          {/* Start */}
                          <td
                            className="px-4 py-3 whitespace-nowrap cursor-pointer"
                            onClick={() => startEdit(entry.id, 'startedAt', fmtTime(entry.startedAt))}
                          >
                            {editingCell?.entryId === entry.id && editingCell.field === 'startedAt' ? (
                              <input
                                type="time"
                                autoFocus
                                value={editValue}
                                onChange={(e) => setEditValue(e.target.value)}
                                onBlur={() => void commitEdit(entry)}
                                className="bg-slate-800 border border-indigo-500 rounded px-2 py-0.5 text-sm text-white focus:outline-none"
                              />
                            ) : (
                              <span className="text-slate-400 hover:text-white">{fmtTime(entry.startedAt)}</span>
                            )}
                          </td>

                          {/* End */}
                          <td
                            className="px-4 py-3 whitespace-nowrap cursor-pointer"
                            onClick={() =>
                              startEdit(entry.id, 'stoppedAt', entry.stoppedAt ? fmtTime(entry.stoppedAt) : '')
                            }
                          >
                            {editingCell?.entryId === entry.id && editingCell.field === 'stoppedAt' ? (
                              <input
                                type="time"
                                autoFocus
                                value={editValue}
                                onChange={(e) => setEditValue(e.target.value)}
                                onBlur={() => void commitEdit(entry)}
                                className="bg-slate-800 border border-indigo-500 rounded px-2 py-0.5 text-sm text-white focus:outline-none"
                              />
                            ) : (
                              <span className="text-slate-400 hover:text-white">
                                {entry.stoppedAt ? fmtTime(entry.stoppedAt) : <span className="text-slate-600">—</span>}
                              </span>
                            )}
                          </td>

                          {/* Duration */}
                          <td
                            className="px-4 py-3 whitespace-nowrap cursor-pointer"
                            onClick={() => {
                              const secs = entry.durationSeconds ?? 0;
                              const h = Math.floor(secs / 3600);
                              const m = Math.floor((secs % 3600) / 60);
                              startEdit(entry.id, 'duration', `${h}:${String(m).padStart(2, '0')}`);
                            }}
                          >
                            {editingCell?.entryId === entry.id && editingCell.field === 'duration' ? (
                              <input
                                type="text"
                                autoFocus
                                placeholder="H:MM"
                                value={editValue}
                                onChange={(e) => setEditValue(e.target.value)}
                                onBlur={() => void commitEdit(entry)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') void commitEdit(entry);
                                  if (e.key === 'Escape') cancelEdit();
                                }}
                                className="bg-slate-800 border border-indigo-500 rounded px-2 py-0.5 text-sm text-white w-20 focus:outline-none"
                              />
                            ) : (
                              <span className="text-slate-200 hover:text-white">
                                {fmtHours(entry.durationSeconds ?? 0)}
                              </span>
                            )}
                          </td>

                          {/* Billable toggle */}
                          <td className="px-4 py-3 whitespace-nowrap">
                            <button
                              onClick={() =>
                                void commitEditValue(entry, 'isBillable', entry.isBillable ? 'false' : 'true')
                              }
                              className={`text-xs px-2 py-0.5 rounded-full transition-colors ${
                                entry.isBillable
                                  ? 'bg-emerald-900/50 text-emerald-400 hover:bg-emerald-800/50'
                                  : 'bg-slate-800 text-slate-500 hover:bg-slate-700'
                              }`}
                            >
                              $
                            </button>
                          </td>

                          {/* Amount */}
                          <td className="px-4 py-3 text-slate-200 text-right whitespace-nowrap">
                            {amount > 0 ? (
                              formatCurrency(amount, entry.project?.client?.currency ?? 'USD')
                            ) : (
                              <span className="text-slate-600">—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {sortedEntries.length > PAGE_SIZE && (
                <div className="flex items-center justify-between text-sm text-slate-400">
                  <span>
                    Showing {detailPage * PAGE_SIZE + 1}–
                    {Math.min((detailPage + 1) * PAGE_SIZE, sortedEntries.length)} of{' '}
                    {sortedEntries.length} entries
                  </span>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setDetailPage((p) => Math.max(0, p - 1))}
                      disabled={detailPage === 0}
                      className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg border border-slate-700 text-white transition-colors"
                    >
                      Previous
                    </button>
                    <button
                      onClick={() =>
                        setDetailPage((p) => Math.min(Math.ceil(sortedEntries.length / PAGE_SIZE) - 1, p + 1))
                      }
                      disabled={(detailPage + 1) * PAGE_SIZE >= sortedEntries.length}
                      className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg border border-slate-700 text-white transition-colors"
                    >
                      Next
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ══════════════════════════════ WORKLOAD TAB ══════════════════════════════ */}
      {activeTab === 'workload' && (
        <div className="space-y-6">
          <div className="flex gap-3 flex-wrap">
            <select
              value={filters.userId}
              onChange={(e) => setFilters((f) => ({ ...f, userId: e.target.value }))}
              className={SELECT_CLS}
            >
              <option value="">All Members</option>
              {teamMembers.map((m) => (
                <option key={m.id} value={m.id}>{m.name ?? m.email}</option>
              ))}
            </select>
          </div>

          {loading && (
            <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden animate-pulse">
              <div className="p-4 space-y-3">
                {[1, 2, 3, 4].map((i) => (
                  <div key={i} className="flex gap-2">
                    <div className="h-8 bg-slate-800 rounded w-32" />
                    {[1, 2, 3, 4, 5, 6, 7].map((j) => (
                      <div key={j} className="h-8 bg-slate-800 rounded flex-1" />
                    ))}
                  </div>
                ))}
              </div>
            </div>
          )}

          {!loading && (
            <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-x-auto">
              <table className="text-xs min-w-max w-full">
                <thead>
                  <tr className="border-b border-slate-800">
                    <th className="px-4 py-3 text-left text-slate-400 sticky left-0 bg-slate-900 min-w-[140px]">
                      Member
                    </th>
                    {workloadDays.map((day) => (
                      <th
                        key={day.toISOString()}
                        className="px-2 py-3 text-center text-slate-400 min-w-[64px]"
                      >
                        <div>{format(day, 'EEE')}</div>
                        <div className="text-slate-600 font-normal">{format(day, 'MMM d')}</div>
                      </th>
                    ))}
                    <th className="px-4 py-3 text-right text-slate-400 whitespace-nowrap">
                      Total
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {teamMembers
                    .filter((m) => !filters.userId || m.id === filters.userId)
                    .map((member) => {
                      const userMap = workloadMap.get(member.id);
                      const rowTotal = userMap
                        ? Array.from(userMap.values()).reduce((s, v) => s + v, 0)
                        : 0;
                      return (
                        <tr key={member.id} className="border-b border-slate-800/60">
                          <td className="px-4 py-2 sticky left-0 bg-slate-900">
                            <div className="text-slate-200">{member.name ?? member.email}</div>
                            <div className="text-slate-600 text-xs">{member.role}</div>
                          </td>
                          {workloadDays.map((day) => {
                            const key = format(day, 'yyyy-MM-dd');
                            const secs = userMap?.get(key) ?? 0;
                            return (
                              <td key={key} className="px-1 py-2 text-center">
                                <div
                                  className={`mx-auto rounded-md flex items-center justify-center h-8 w-14 ${workloadCellClass(secs)}`}
                                >
                                  {secs > 0 ? fmtHours(secs) : '—'}
                                </div>
                              </td>
                            );
                          })}
                          <td className="px-4 py-2 text-right text-slate-200">
                            {fmtHours(rowTotal)}
                          </td>
                        </tr>
                      );
                    })}
                  {teamMembers.filter((m) => !filters.userId || m.id === filters.userId).length === 0 && (
                    <tr>
                      <td
                        colSpan={workloadDays.length + 2}
                        className="px-4 py-12 text-center text-slate-500"
                      >
                        No members found
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ══════════════════════════════ PROFITABILITY TAB ══════════════════════════════ */}
      {activeTab === 'profitability' && (
        <div className="space-y-6">
          <FilterBar showMember={false} showBillable={false} />

          {loading && (
            <div className="space-y-4 animate-pulse">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="bg-slate-900 border border-slate-800 rounded-xl p-5">
                    <div className="h-3 bg-slate-800 rounded w-24 mb-3" />
                    <div className="h-7 bg-slate-800 rounded w-28" />
                  </div>
                ))}
              </div>
            </div>
          )}

          {!loading && data && (
            <>
              {(() => {
                const revenueTotals = groupCurrencyTotals(profitRows);
                const totalSecs = profitRows.reduce((s, r) => s + r.totalSeconds, 0);
                const billSecs = profitRows.reduce((s, r) => s + r.billableSeconds, 0);
                const billPct = totalSecs > 0 ? (billSecs / totalSecs) * 100 : 0;
                const mostProfitable = profitRows[0];
                return (
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
                      <p className="text-xs text-slate-500 uppercase tracking-wide mb-1">
                        Most Profitable Client
                      </p>
                      <p className="text-xl text-white truncate">
                        {mostProfitable?.clientName ?? mostProfitable?.projectName ?? '—'}
                      </p>
                      {mostProfitable && (
                        <p className="text-sm text-slate-400 mt-1">
                          {formatCurrency(mostProfitable.billableAmount, mostProfitable.clientCurrency)}
                        </p>
                      )}
                    </div>
                    <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
                      <p className="text-xs text-slate-500 uppercase tracking-wide mb-1">
                        Overall Billable %
                      </p>
                      <p
                        className={`text-2xl ${
                          billPct >= 80 ? 'text-emerald-400' : billPct >= 50 ? 'text-amber-400' : 'text-red-400'
                        }`}
                      >
                        {billPct.toFixed(1)}%
                      </p>
                    </div>
                    <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
                      <p className="text-xs text-slate-500 uppercase tracking-wide mb-1">
                        Total Revenue
                      </p>
                      <p className="text-2xl text-white">
                        {formatGroupedAmounts(revenueTotals)}
                      </p>
                    </div>
                  </div>
                );
              })()}

              {profitRows.length === 0 && (
                <div className="flex flex-col items-center justify-center py-20 text-slate-500">
                  <p className="text-lg text-slate-400">No data for this period</p>
                  <p className="text-sm mt-1">Try adjusting the date range or filters</p>
                </div>
              )}

              {profitRows.length > 0 && (
                <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-800">
                        <th className="text-left px-4 py-3 text-slate-400">Project</th>
                        <th className="text-left px-4 py-3 text-slate-400 hidden md:table-cell">Client</th>
                        <th className="text-right px-4 py-3 text-slate-400">Tracked Hours</th>
                        <th className="text-right px-4 py-3 text-slate-400 hidden sm:table-cell">Billable Hours</th>
                        <th className="text-right px-4 py-3 text-slate-400">Billable %</th>
                        <th className="text-right px-4 py-3 text-slate-400">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {profitRows.map((proj) => {
                        const billPct =
                          proj.totalSeconds > 0
                            ? (proj.billableSeconds / proj.totalSeconds) * 100
                            : 0;
                        const billColor =
                          billPct >= 80 ? 'text-emerald-400' : billPct >= 50 ? 'text-amber-400' : 'text-red-400';
                        return (
                          <tr
                            key={proj.projectId ?? '__none__'}
                            className="border-b border-slate-800/60 hover:bg-slate-800/20"
                          >
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-2">
                                <ProjectIconOrDot icon={proj.projectIcon} color={proj.projectColor} size={24} />
                                <span className="text-white truncate">{proj.projectName}</span>
                              </div>
                            </td>
                            <td className="px-4 py-3 text-slate-400 hidden md:table-cell">
                              {proj.clientName ?? <span className="text-slate-600">—</span>}
                            </td>
                            <td className="px-4 py-3 text-right text-slate-200">
                              {fmtHours(proj.totalSeconds)}
                            </td>
                            <td className="px-4 py-3 text-right text-slate-200 hidden sm:table-cell">
                              {fmtHours(proj.billableSeconds)}
                            </td>
                            <td className={`px-4 py-3 text-right ${billColor}`}>
                              {billPct.toFixed(1)}%
                            </td>
                            <td className="px-4 py-3 text-right text-slate-200">
                              {proj.billableAmount > 0 ? (
                                formatCurrency(proj.billableAmount, proj.clientCurrency)
                              ) : (
                                <span className="text-slate-600">—</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                      {(() => {
                        const totalTracked = profitRows.reduce((s, r) => s + r.totalSeconds, 0);
                        const totalBillable = profitRows.reduce((s, r) => s + r.billableSeconds, 0);
                        const overallPct = totalTracked > 0 ? (totalBillable / totalTracked) * 100 : 0;
                        const billColor =
                          overallPct >= 80 ? 'text-emerald-400' : overallPct >= 50 ? 'text-amber-400' : 'text-red-400';
                        return (
                          <tr className="bg-slate-800/40">
                            <td className="px-4 py-3 text-white">Total</td>
                            <td className="hidden md:table-cell" />
                            <td className="px-4 py-3 text-right text-white">
                              {fmtHours(totalTracked)}
                            </td>
                            <td className="px-4 py-3 text-right text-white hidden sm:table-cell">
                              {fmtHours(totalBillable)}
                            </td>
                            <td className={`px-4 py-3 text-right ${billColor}`}>
                              {overallPct.toFixed(1)}%
                            </td>
                            <td className="px-4 py-3 text-right text-white">
                              {formatGroupedAmounts(groupCurrencyTotals(profitRows))}
                            </td>
                          </tr>
                        );
                      })()}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ══════════════════════════════ MY REPORTS TAB ══════════════════════════════ */}
      {activeTab === 'my_reports' && (
        <div className="space-y-4">
          {savedReports.length === 0 && (
            <div className="flex flex-col items-center justify-center py-24 text-slate-500">
              <Bookmark size={40} className="mb-4 text-slate-700" />
              <p className="text-lg text-slate-400">No saved reports yet</p>
              <p className="text-sm mt-1">
                Click <span className="text-indigo-400">Save Report</span> on any tab to bookmark your filters and date range.
              </p>
            </div>
          )}

          {savedReports.map((report) => {
            const tabColors: Record<string, string> = {
              summary: 'bg-indigo-900/50 text-indigo-300',
              detailed: 'bg-blue-900/50 text-blue-300',
              workload: 'bg-violet-900/50 text-violet-300',
              profitability: 'bg-emerald-900/50 text-emerald-300',
            };
            return (
              <div
                key={report.id}
                className="bg-slate-900 border border-slate-800 rounded-xl p-5 flex items-center justify-between gap-4"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-white truncate">{report.name}</span>
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full flex-shrink-0 capitalize ${
                        tabColors[report.tab] ?? 'bg-slate-800 text-slate-400'
                      }`}
                    >
                      {report.tab.replace('_', ' ')}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-slate-500">
                    <span>
                      {PRESETS.find((p) => p.value === report.preset)?.label ?? report.preset}
                      {report.preset === 'custom' && report.customStart && report.customEnd
                        ? `: ${report.customStart} – ${report.customEnd}`
                        : ''}
                    </span>
                    <span>Saved {format(parseISO(report.savedAt), 'MMM d, yyyy')}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button
                    onClick={() => runReport(report)}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-sm rounded-lg transition-colors"
                  >
                    <Play size={13} />
                    Run
                  </button>
                  <button
                    onClick={() => deleteReport(report.id)}
                    className="p-1.5 text-slate-500 hover:text-red-400 hover:bg-slate-800 rounded-lg transition-colors"
                    title="Delete report"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
