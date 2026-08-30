'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useSession } from 'next-auth/react';
import { format } from 'date-fns';
import { Play, Square, DollarSign, MoreHorizontal, ChevronDown, Tag, X, Check } from 'lucide-react';
import { OriginButton } from '@/components/ui/origin-button';
import { ProjectCombobox } from '@/components/ui/ProjectCombobox';
import { TagCombobox, type TagOption } from '@/components/ui/TagCombobox';
import { useTimerStore } from '@/store/timerStore';
import { ProjectIconOrDot } from '@/components/ui/ProjectIconOrDot';

// ─── types ───────────────────────────────────────────────────────────────────

interface Project {
  id: string;
  name: string;
  color: string;
  icon?: string | null;
  hourlyRate: number;
  isBillable: boolean;
  clientName?: string | null;
  client: { id: string; name: string } | null;
}

interface RecentDesc {
  description: string;
  projectName: string;
  projectId: string | null;
  tagIds: string[];
}

interface TimeEntry {
  id: string;
  description: string | null;
  startedAt: string;
  stoppedAt: string | null;
  durationSeconds: number | null;
  isBillable: boolean;
  tags: TagOption[];
  project: {
    id: string;
    name: string;
    color: string;
    icon?: string | null;
    client: { id: string; name: string } | null;
  } | null;
}

interface EntryGroup {
  key: string;
  entries: TimeEntry[];
}
interface DayBucket {
  dateKey: string;
  groups: EntryGroup[];
  total: number;
}
interface WeekBucket {
  weekKey: string;
  start: Date;
  end: Date;
  label: string;
  days: DayBucket[];
  total: number;
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function formatElapsed(seconds: number): string {
  const h = Math.floor(seconds / 3600).toString().padStart(2, '0');
  const m = Math.floor((seconds % 3600) / 60).toString().padStart(2, '0');
  const s = (seconds % 60).toString().padStart(2, '0');
  return `${h}:${m}:${s}`;
}

function formatHM(seconds: number): string {
  const totalMinutes = Math.round(seconds / 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${h}:${String(m).padStart(2, '0')}`;
}

function formatTime(dateStr: string): string {
  return format(new Date(dateStr), 'h:mma');
}

function getWeekStart(d: Date, weekStartDay: number): Date {
  const result = new Date(d);
  result.setHours(0, 0, 0, 0);
  const diff = (result.getDay() - weekStartDay + 7) % 7;
  result.setDate(result.getDate() - diff);
  return result;
}

function getWeekEnd(weekStart: Date): Date {
  const result = new Date(weekStart);
  result.setDate(result.getDate() + 6);
  result.setHours(23, 59, 59, 999);
  return result;
}

function weekLabel(start: Date, end: Date, weekStartDay: number): string {
  const now = new Date();
  const thisWeekStart = getWeekStart(now, weekStartDay);
  const lastWeekStart = new Date(thisWeekStart);
  lastWeekStart.setDate(lastWeekStart.getDate() - 7);
  if (start.getTime() === thisWeekStart.getTime()) return 'This week';
  if (start.getTime() === lastWeekStart.getTime()) return 'Last week';
  return `${format(start, 'MMM d')} – ${format(end, 'MMM d')}`;
}

function collapseToGroups(entries: TimeEntry[]): EntryGroup[] {
  const groups: EntryGroup[] = [];
  for (const entry of entries) {
    const last = groups[groups.length - 1];
    if (
      last &&
      (last.entries[0].description ?? null) === (entry.description ?? null) &&
      (last.entries[0].project?.id ?? null) === (entry.project?.id ?? null)
    ) {
      last.entries.push(entry);
    } else {
      groups.push({
        key: `${entry.description ?? ''}|${entry.project?.id ?? ''}|${entry.id}`,
        entries: [entry],
      });
    }
  }
  return groups;
}

function buildWeekBuckets(entries: TimeEntry[], weekStartDay: number): WeekBucket[] {
  const byWeek = new Map<string, { start: Date; entries: TimeEntry[] }>();
  for (const entry of entries) {
    const ws = getWeekStart(new Date(entry.startedAt), weekStartDay);
    const key = ws.toISOString();
    if (!byWeek.has(key)) byWeek.set(key, { start: ws, entries: [] });
    byWeek.get(key)!.entries.push(entry);
  }

  return [...byWeek.values()]
    .sort((a, b) => b.start.getTime() - a.start.getTime())
    .map(({ start, entries: we }) => {
      const end = getWeekEnd(start);
      const byDay = new Map<string, TimeEntry[]>();
      for (const entry of we) {
        const dk = format(new Date(entry.startedAt), 'yyyy-MM-dd');
        if (!byDay.has(dk)) byDay.set(dk, []);
        byDay.get(dk)!.push(entry);
      }
      const days: DayBucket[] = [...byDay.entries()]
        .sort(([a], [b]) => b.localeCompare(a))
        .map(([dateKey, dayEntries]) => ({
          dateKey,
          groups: collapseToGroups(dayEntries),
          total: dayEntries.reduce((s, e) => s + (e.durationSeconds ?? 0), 0),
        }));
      const total = we.reduce((s, e) => s + (e.durationSeconds ?? 0), 0);
      return { weekKey: start.toISOString(), start, end, label: weekLabel(start, end, weekStartDay), days, total };
    });
}

function removeEntryFromWeeks(prev: WeekBucket[], id: string): WeekBucket[] {
  return prev
    .map((week) => {
      const days = week.days
        .map((day) => {
          const groups = day.groups
            .map((g) => ({ ...g, entries: g.entries.filter((e) => e.id !== id) }))
            .filter((g) => g.entries.length > 0);
          const total = groups.reduce(
            (s, g) => s + g.entries.reduce((x, e) => x + (e.durationSeconds ?? 0), 0),
            0,
          );
          return { ...day, groups, total };
        })
        .filter((d) => d.groups.length > 0);
      return { ...week, days, total: days.reduce((s, d) => s + d.total, 0) };
    })
    .filter((w) => w.days.length > 0);
}

function insertEntryIntoWeeks(prev: WeekBucket[], entry: TimeEntry, wsd: number): WeekBucket[] {
  const ws = getWeekStart(new Date(entry.startedAt), wsd);
  const weekKey = ws.toISOString();
  const dk = format(new Date(entry.startedAt), 'yyyy-MM-dd');

  const weekIdx = prev.findIndex((w) => w.weekKey === weekKey);
  if (weekIdx === -1) return prev; // week not loaded; entry will appear on next full refresh

  const week = prev[weekIdx];
  const dayIdx = week.days.findIndex((d) => d.dateKey === dk);

  let updatedDays: DayBucket[];
  if (dayIdx === -1) {
    const newDay: DayBucket = {
      dateKey: dk,
      groups: collapseToGroups([entry]),
      total: entry.durationSeconds ?? 0,
    };
    updatedDays = [...week.days, newDay].sort((a, b) => b.dateKey.localeCompare(a.dateKey));
  } else {
    const allDayEntries = [
      ...week.days[dayIdx].groups.flatMap((g) => g.entries),
      entry,
    ].sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
    updatedDays = week.days.map((d, i) =>
      i === dayIdx
        ? { ...d, groups: collapseToGroups(allDayEntries), total: allDayEntries.reduce((s, e) => s + (e.durationSeconds ?? 0), 0) }
        : d,
    );
  }

  const updatedWeek: WeekBucket = {
    ...week,
    days: updatedDays,
    total: updatedDays.reduce((s, d) => s + d.total, 0),
  };
  return prev.map((w, i) => (i === weekIdx ? updatedWeek : w));
}

function replaceEntryInWeeks(prev: WeekBucket[], oldEntry: TimeEntry, newEntry: TimeEntry, wsd: number): WeekBucket[] {
  return insertEntryIntoWeeks(removeEntryFromWeeks(prev, oldEntry.id), newEntry, wsd);
}

// ─── page ────────────────────────────────────────────────────────────────────

export default function TimerPage() {
  const { data: session } = useSession();
  const initForUser = useTimerStore((state) => state.initForUser);

  const [isRunning, setIsRunning] = useState(false);
  const [startedAt, setStartedAt] = useState<Date | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [entryId, setEntryId] = useState<string | null>(null);

  const storePaused = useTimerStore((state) => state.isPaused);
  const storeStartedAt = useTimerStore((state) => state.startedAt);
  const wasPausedRef = useRef(false);

  // Scope the persisted timer store to the current user. If a different user's
  // session is found in localStorage, wipe it before any timer state is read.
  useEffect(() => {
    const userId = (session?.user as { id?: string })?.id;
    if (userId) initForUser(userId);
  }, [(session?.user as { id?: string })?.id, initForUser]);

  const [projectId, setProjectId] = useState('');
  const [description, setDescription] = useState('');
  const [isBillable, setIsBillable] = useState(true);

  const [projects, setProjects] = useState<Project[]>([]);
  const [allTags, setAllTags] = useState<TagOption[]>([]);
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  const [recentDescs, setRecentDescs] = useState<RecentDesc[]>([]);
  const [showDescs, setShowDescs] = useState(false);
  const [openKebab, setOpenKebab] = useState<string | null>(null);
  const [noProjectError, setNoProjectError] = useState(false);
  const [openProjectCombobox, setOpenProjectCombobox] = useState(false);

  // Entry history
  const [weekStartDay, setWeekStartDay] = useState(1);
  const [weeks, setWeeks] = useState<WeekBucket[]>([]);
  const [oldestLoaded, setOldestLoaded] = useState<Date | null>(null);
  const [loadingInitial, setLoadingInitial] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  // Edit modal
  const [editingEntry, setEditingEntry] = useState<TimeEntry | null>(null);
  const [editDesc, setEditDesc] = useState('');
  const [editProjectId, setEditProjectId] = useState('');
  const [editDate, setEditDate] = useState('');
  const [editStartTime, setEditStartTime] = useState('');
  const [editEndTime, setEditEndTime] = useState('');
  const [editTagIds, setEditTagIds] = useState<string[]>([]);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState('');
  const editMouseDown = useRef(false);

  // Inline editing — one field open at a time across all rows
  type InlineField = 'description' | 'project' | 'tags' | 'startTime' | 'endTime';
  const [inlineEdit, setInlineEdit] = useState<{ entryId: string; field: InlineField } | null>(null);
  const [inlineDesc, setInlineDesc] = useState('');
  const [inlineProjectId, setInlineProjectId] = useState<string | null>(null);
  const [inlineTagIds, setInlineTagIds] = useState<string[]>([]);
  const [inlineStartTime, setInlineStartTime] = useState('');
  const [inlineEndTime, setInlineEndTime] = useState('');

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const descriptionRef = useRef<HTMLInputElement>(null);
  const descSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Populate edit form when a new entry is opened for editing
  useEffect(() => {
    if (!editingEntry) return;
    setEditDesc(editingEntry.description ?? '');
    setEditProjectId(editingEntry.project?.id ?? '');
    setEditDate(format(new Date(editingEntry.startedAt), 'yyyy-MM-dd'));
    setEditStartTime(format(new Date(editingEntry.startedAt), 'HH:mm'));
    setEditEndTime(editingEntry.stoppedAt ? format(new Date(editingEntry.stoppedAt), 'HH:mm') : '');
    setEditTagIds(editingEntry.tags.map((t) => t.id));
    setEditError('');
  }, [editingEntry?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── data fetching ─────────────────────────────────────────────────────────

  const fetchRange = useCallback(async (from: Date, to: Date): Promise<TimeEntry[]> => {
    const res = await fetch(`/api/time-entries?startDate=${from.toISOString()}&endDate=${to.toISOString()}`);
    if (!res.ok) return [];
    const data: TimeEntry[] = await res.json();
    return data.filter((e) => e.stoppedAt !== null);
  }, []);

  const loadInitialWeeks = useCallback(async (wsd: number) => {
    setLoadingInitial(true);
    try {
      const thisWeekStart = getWeekStart(new Date(), wsd);
      const from = new Date(thisWeekStart);
      from.setDate(from.getDate() - 7);
      const to = getWeekEnd(thisWeekStart);
      const entries = await fetchRange(from, to);
      setWeeks(buildWeekBuckets(entries, wsd));
      setOldestLoaded(from);
    } finally {
      setLoadingInitial(false);
    }
  }, [fetchRange]);

  const refreshCurrentWeeks = useCallback(async () => {
    const thisWeekStart = getWeekStart(new Date(), weekStartDay);
    const from = new Date(thisWeekStart);
    from.setDate(from.getDate() - 7);
    const to = getWeekEnd(thisWeekStart);
    const entries = await fetchRange(from, to);
    const refreshed = buildWeekBuckets(entries, weekStartDay);
    setWeeks((prev) => {
      const older = prev.filter((w) => w.start < from);
      return [...refreshed, ...older];
    });
  }, [fetchRange, weekStartDay]);

  const loadMoreWeeks = useCallback(async () => {
    if (loadingMore || !hasMore || !oldestLoaded) return;
    setLoadingMore(true);
    try {
      const to = new Date(oldestLoaded);
      to.setDate(to.getDate() - 1);
      to.setHours(23, 59, 59, 999);
      const from = new Date(oldestLoaded);
      from.setDate(from.getDate() - 14);
      const entries = await fetchRange(from, to);
      if (entries.length === 0) { setHasMore(false); return; }
      setWeeks((prev) => [...prev, ...buildWeekBuckets(entries, weekStartDay)]);
      setOldestLoaded(from);
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, hasMore, oldestLoaded, fetchRange, weekStartDay]);

  const fetchProjects = useCallback(async () => {
    const res = await fetch('/api/projects');
    if (res.ok) {
      const raw: Array<{ id: string; name: string; color: string; icon?: string | null; hourlyRate: number; isBillable: boolean; client: { id: string; name: string } | null }> = await res.json();
      setProjects(raw.map((p) => ({ ...p, clientName: p.client?.name ?? null })));
    }
  }, []);

  const fetchTags = useCallback(async () => {
    const res = await fetch('/api/tags');
    if (res.ok) setAllTags(await res.json());
  }, []);

  const checkActiveTimer = useCallback(async () => {
    const res = await fetch('/api/time-entries?active=true');
    if (!res.ok) return;
    const data = await res.json();
    const active: TimeEntry | null = Array.isArray(data) ? data[0] ?? null : data ?? null;
    if (active && !active.stoppedAt) {
      const start = new Date(active.startedAt);
      setEntryId(active.id);
      setStartedAt(start);
      setDescription(active.description ?? '');
      setProjectId(active.project?.id ?? '');
      if (!useTimerStore.getState().isPaused) {
        setIsRunning(true);
        setElapsed(Math.floor((Date.now() - start.getTime()) / 1000));
        useTimerStore.getState().startTimer(active.id, active.project?.id ?? null, active.description ?? '', start);
      }
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    async function init() {
      let wsd = 1;
      try {
        const r = await fetch('/api/user/preferences');
        const d = await r.json();
        if (typeof d.weekStartDay === 'number') wsd = d.weekStartDay;
      } catch { /* use default */ }
      if (!mounted) return;
      setWeekStartDay(wsd);
      await loadInitialWeeks(wsd);
      fetchProjects();
      fetchTags();
      checkActiveTimer();
    }
    init();
    return () => { mounted = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── timer tick ───────────────────────────────────────────────────────────

  useEffect(() => {
    if (isRunning && startedAt) {
      intervalRef.current = setInterval(() => {
        setElapsed(Math.floor((Date.now() - startedAt.getTime()) / 1000));
      }, 1000);
    } else {
      if (intervalRef.current) clearInterval(intervalRef.current);
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [isRunning, startedAt]);

  // ── store pause/resume sync ───────────────────────────────────────────────

  useEffect(() => {
    if (storePaused) {
      if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
      setElapsed(36000);
      setIsRunning(false);
      wasPausedRef.current = true;
    }
  }, [storePaused]);

  useEffect(() => {
    if (!storePaused && wasPausedRef.current && storeStartedAt) {
      wasPausedRef.current = false;
      setStartedAt(new Date(storeStartedAt));
      setIsRunning(true);
    }
  }, [storePaused, storeStartedAt]);

  // ── start / stop ──────────────────────────────────────────────────────────

  const handleStart = useCallback(async (opts?: {
    projectId?: string;
    description?: string;
    isBillable?: boolean;
  }) => {
    if (loading || isRunning) return;
    if (!opts && !projectId) {
      setNoProjectError(true);
      setOpenProjectCombobox(true);
      return;
    }
    setNoProjectError(false);
    setOpenProjectCombobox(false);
    setLoading(true);
    try {
      const pid = opts?.projectId !== undefined ? opts.projectId : projectId;
      const desc = opts?.description !== undefined ? opts.description : description;
      const billable = opts?.isBillable !== undefined ? opts.isBillable : isBillable;
      const now = new Date();
      const res = await fetch('/api/time-entries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          startedAt: now.toISOString(),
          description: desc || undefined,
          projectId: pid || undefined,
          isBillable: billable,
        }),
      });
      if (!res.ok) return;
      const entry: TimeEntry = await res.json();
      setEntryId(entry.id);
      setStartedAt(now);
      setIsRunning(true);
      setElapsed(0);
      useTimerStore.getState().startTimer(entry.id, pid ?? null, desc ?? '');
      if (opts?.projectId !== undefined) setProjectId(opts.projectId);
      if (opts?.description !== undefined) setDescription(opts.description);
      if (opts?.isBillable !== undefined) setIsBillable(opts.isBillable);
    } finally {
      setLoading(false);
    }
  }, [loading, isRunning, description, projectId, isBillable]);

  const handleStop = useCallback(async () => {
    if (!entryId || loading || !isRunning) return;
    setLoading(true);
    try {
      const now = new Date();
      await fetch(`/api/time-entries/${entryId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stoppedAt: now.toISOString(), tagIds: selectedTagIds }),
      });
      setIsRunning(false);
      setStartedAt(null);
      setEntryId(null);
      setElapsed(0);
      setDescription('');
      setProjectId('');
      setSelectedTagIds([]);
      useTimerStore.getState().stopTimer();
      await refreshCurrentWeeks();
    } finally {
      setLoading(false);
    }
  }, [entryId, loading, isRunning, selectedTagIds, refreshCurrentWeeks]);

  const handlePlay = useCallback((entry: TimeEntry) => {
    setSelectedTagIds(entry.tags.map((t) => t.id));
    handleStart({
      projectId: entry.project?.id ?? '',
      description: entry.description ?? '',
      isBillable: entry.isBillable,
    });
  }, [handleStart]);

  const handleDuplicate = async (entry: TimeEntry) => {
    const res = await fetch('/api/time-entries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        description: entry.description ?? undefined,
        projectId: entry.project?.id ?? undefined,
        isBillable: entry.isBillable,
        startedAt: entry.startedAt,       // original timestamp, not now()
        stoppedAt: entry.stoppedAt ?? undefined, // original timestamp, not now()
        tagIds: entry.tags.map((t) => t.id),
      }),
    });
    if (!res.ok) return;
    const created: TimeEntry = await res.json();
    setWeeks((prev) => insertEntryIntoWeeks(prev, created, weekStartDay));
  };

  const handleEditSave = async () => {
    if (!editingEntry || !editDate || !editStartTime || !editEndTime) return;

    // local-time construction: no Z suffix → parsed as local time → round-trip stable
    const startedAt = new Date(`${editDate}T${editStartTime}:00`);
    let stoppedAt = new Date(`${editDate}T${editEndTime}:00`);

    if (stoppedAt <= startedAt) {
      // End time is the next calendar day (entry crosses midnight)
      stoppedAt = new Date(stoppedAt.getTime() + 24 * 60 * 60 * 1000);
    }

    if (stoppedAt.getTime() - startedAt.getTime() > 24 * 60 * 60 * 1000) {
      setEditError('Entry duration cannot exceed 24 hours');
      return;
    }

    setEditError('');
    setEditSaving(true);
    try {
      const res = await fetch(`/api/time-entries/${editingEntry.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          description: editDesc || null,
          projectId: editProjectId || null,
          startedAt: startedAt.toISOString(),
          stoppedAt: stoppedAt.toISOString(),
          tagIds: editTagIds,
        }),
      });
      if (!res.ok) {
        const d = await res.json();
        setEditError(d.error ?? 'Save failed');
        return;
      }
      const updated: TimeEntry = await res.json();
      setWeeks((prev) => replaceEntryInWeeks(prev, editingEntry, updated, weekStartDay));
      setEditingEntry(null);
    } finally {
      setEditSaving(false);
    }
  };

  // Fires a PATCH for a single field and updates the local weeks state on success.
  // Callers are responsible for closing the inline edit (setInlineEdit(null)) before
  // or after calling this — they know whether to stay open on failure.
  const saveInlineField = async (
    entry: TimeEntry,
    patch: {
      description?: string | null;
      projectId?: string | null;
      tagIds?: string[];
      startedAt?: string;
      stoppedAt?: string;
    },
  ) => {
    try {
      const res = await fetch(`/api/time-entries/${entry.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (res.ok) {
        const updated: TimeEntry = await res.json();
        setWeeks((prev) => replaceEntryInWeeks(prev, entry, updated, weekStartDay));
      }
    } catch { /* silent revert — row shows original value */ }
  };

  // ── space bar toggle ──────────────────────────────────────────────────────

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isInput =
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' ||
        target.isContentEditable;
      if (e.code === 'Space' && !isInput) {
        e.preventDefault();
        if (isRunning) handleStop();
        else handleStart();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [isRunning, handleStart, handleStop]);

  // ── delete entry ─────────────────────────────────────────────────────────

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this time entry?')) return;
    await fetch(`/api/time-entries/${id}`, { method: 'DELETE' });
    setWeeks((prev) => removeEntryFromWeeks(prev, id));
  };

  // ── description real-time save ────────────────────────────────────────────

  const handleDescriptionChange = (val: string) => {
    setDescription(val);
    if (isRunning && entryId) {
      if (descSaveTimer.current) clearTimeout(descSaveTimer.current);
      descSaveTimer.current = setTimeout(() => {
        fetch(`/api/time-entries/${entryId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ description: val || null }),
        });
      }, 800);
    }
  };

  // ── recent descriptions dropdown ──────────────────────────────────────────

  const handleDescFocus = async () => {
    const res = await fetch('/api/time-entries');
    if (!res.ok) return;
    const entries: TimeEntry[] = await res.json();
    const seen = new Set<string>();
    const unique: RecentDesc[] = [];
    for (const e of entries) {
      if (e.description && e.stoppedAt && !seen.has(e.description) && unique.length < 10) {
        seen.add(e.description);
        unique.push({
          description: e.description,
          projectName: e.project?.name ?? '',
          projectId: e.project?.id ?? null,
          tagIds: e.tags.map((t) => t.id),
        });
      }
    }
    setRecentDescs(unique);
    if (unique.length > 0) setShowDescs(true);
  };

  const handleCreateTag = useCallback(async (name: string): Promise<TagOption> => {
    const res = await fetch('/api/tags', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    if (!res.ok) throw new Error('Failed to create tag');
    const tag: TagOption = await res.json();
    setAllTags((prev) => [...prev, tag].sort((a, b) => a.name.localeCompare(b.name)));
    return tag;
  }, []);

  const toggleGroup = (key: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // ── computed ──────────────────────────────────────────────────────────────

  const selectedProject = projects.find((p) => p.id === projectId);
  const hasAnyEntries = weeks.some((w) => w.days.length > 0);

  // ── render ────────────────────────────────────────────────────────────────

  return (
    <div className="p-6 md:p-8 space-y-6" onClick={() => setOpenKebab(null)}>

      {/* ── Top bar ──────────────────────────────────────────────────────── */}
      <div
        className="flex flex-wrap sm:flex-nowrap items-center gap-2 rounded-xl px-4 py-3"
        style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
      >
        {/* ── Description ─ 50% at sm+ ─────────────────────────────────── */}
        <div className="relative w-full sm:min-w-0 sm:[flex:2_1_0%]">
          <input
            ref={descriptionRef}
            type="text"
            placeholder="What are you working on?"
            value={description}
            onChange={(e) => handleDescriptionChange(e.target.value)}
            onFocus={handleDescFocus}
            onBlur={() => setTimeout(() => setShowDescs(false), 150)}
            className="w-full bg-transparent text-sm focus:outline-none"
            style={{ color: 'var(--text)' }}
          />
          {showDescs && recentDescs.length > 0 && (
            <div
              className="absolute z-20 top-full left-0 w-full mt-1 rounded-xl shadow-lg overflow-hidden"
              style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
            >
              <p className="text-xs px-3 pt-2 pb-1" style={{ color: 'var(--text-muted)' }}>Recent</p>
              {recentDescs.map((item, i) => (
                <button
                  key={i}
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    setDescription(item.description);
                    handleDescriptionChange(item.description);
                    if (item.projectId) setProjectId(item.projectId);
                    if (item.tagIds.length > 0) setSelectedTagIds(item.tagIds);
                    setShowDescs(false);
                  }}
                  className="w-full text-left px-3 py-2 hover:bg-white/5 transition-colors flex items-baseline gap-1.5 min-w-0"
                >
                  <span className="text-sm truncate" style={{ color: 'var(--text)' }}>{item.description}</span>
                  {item.projectName && (
                    <span className="text-xs flex-shrink-0" style={{ color: 'var(--text-muted)' }}>
                      — {item.projectName}
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* ── Project + Tags ─ 25% at sm+ ──────────────────────────────── */}
        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 flex-1 min-w-0 sm:[flex:1_1_0%]">
          <ProjectCombobox
            projects={projects}
            value={projectId || null}
            onChange={(id) => { setProjectId(id ?? ''); setNoProjectError(false); setOpenProjectCombobox(false); }}
            disabled={isRunning}
            placeholder="No project"
            forceOpen={openProjectCombobox}
          />
          <TagCombobox
            tags={allTags}
            selectedIds={selectedTagIds}
            onChange={setSelectedTagIds}
            onCreateTag={handleCreateTag}
            disabled={isRunning && !entryId}
          />
          {noProjectError && (
            <p className="w-full text-xs" style={{ color: 'var(--error)' }}>
              Choose a project to start tracking
            </p>
          )}
        </div>

        {/* ── Controls ─ 25% at sm+ ────────────────────────────────────── */}
        <div className="flex items-center gap-2 flex-shrink-0 sm:[flex:1_1_0%] sm:justify-end">
          <button
            type="button"
            onClick={() => { if (!isRunning) setIsBillable((b) => !b); }}
            disabled={isRunning}
            className="p-1.5 rounded transition-colors hover:bg-white/5 disabled:cursor-not-allowed"
            title={isBillable ? 'Billable' : 'Not billable'}
          >
            <DollarSign
              className="w-4 h-4"
              style={{ color: isBillable ? 'var(--accent)' : 'var(--text-muted)' }}
            />
          </button>

          <span
            className="text-xl tabular-nums tracking-tight select-none"
            style={{ color: storePaused ? '#f59e0b' : isRunning ? 'var(--accent)' : 'var(--text-muted)' }}
          >
            {formatElapsed(elapsed)}
          </span>

          <OriginButton
            onClick={isRunning ? handleStop : () => handleStart()}
            disabled={loading || storePaused}
            className="px-5 py-2 rounded-lg text-sm transition-colors disabled:opacity-50 flex-shrink-0"
            style={{
              background: storePaused ? 'rgba(245,158,11,0.15)' : isRunning ? 'var(--error)' : 'var(--accent)',
              color: storePaused ? '#f59e0b' : 'white',
            }}
          >
            {storePaused ? 'Paused' : isRunning ? <><Square className="w-3.5 h-3.5" />Stop</> : <><Play className="w-3.5 h-3.5" />Start</>}
          </OriginButton>
        </div>
      </div>

      {/* ── Entry list ───────────────────────────────────────────────────── */}
      {loadingInitial ? (
        <div className="py-12 text-center text-sm" style={{ color: 'var(--text-muted)' }}>Loading…</div>
      ) : !hasAnyEntries ? (
        <p className="text-center text-sm py-12" style={{ color: 'var(--text-muted)' }}>No entries yet.</p>
      ) : (
        <div className="space-y-4">
          {weeks.map((week) =>
            week.days.length === 0 ? null : (
              <div
                key={week.weekKey}
                className="rounded-xl"
                style={{ border: '1px solid var(--border)' }}
              >
                {/* Week header — rounded-t-xl clips its background at the top corners */}
                <div
                  className="flex items-center justify-between px-4 py-2 rounded-t-xl overflow-hidden"
                  style={{ background: 'var(--surface-raised)', borderBottom: '1px solid var(--border)' }}
                >
                  <span className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>{week.label}</span>
                  <span className="text-xs tabular-nums" style={{ color: 'var(--text-secondary)' }}>{formatHM(week.total)}</span>
                </div>

                {/* Days */}
                {week.days.map((day, di) => (
                  <div key={day.dateKey}>
                    {/* Day header */}
                    <div
                      className="flex items-center justify-between px-4 py-1.5"
                      style={{
                        background: 'var(--surface)',
                        borderBottom: '1px solid var(--border)',
                        ...(di > 0 ? { borderTop: '1px solid var(--border)' } : {}),
                      }}
                    >
                      <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                        {format(new Date(day.dateKey + 'T12:00:00'), 'EEE, MMM d')}
                      </span>
                      <span className="text-xs tabular-nums" style={{ color: 'var(--text-muted)' }}>{formatHM(day.total)}</span>
                    </div>

                    {/* Entry groups */}
                    {day.groups.map((group, gi) => {
                      const isExpanded = expandedGroups.has(group.key);
                      const isMulti = group.entries.length > 1;
                      const visibleEntries = isMulti && !isExpanded ? [group.entries[0]] : group.entries;
                      const groupTotal = group.entries.reduce((s, e) => s + (e.durationSeconds ?? 0), 0);
                      const notLastGroup = gi < day.groups.length - 1;

                      return (
                        <div key={group.key}>
                          {visibleEntries.map((entry, ei) => {
                            const seconds = entry.durationSeconds ?? 0;
                            const isLastVisible = ei === visibleEntries.length - 1;
                            return (
                              <div
                                key={entry.id}
                                className="group flex items-center gap-3 px-4 py-3 transition-colors hover:bg-white/[0.03]"
                                style={isLastVisible && notLastGroup ? { borderBottom: '1px solid var(--border)' } : undefined}
                              >
                                {/* Description — click to edit inline */}
                                {inlineEdit?.entryId === entry.id && inlineEdit.field === 'description' ? (
                                  <input
                                    type="text"
                                    autoFocus
                                    className="flex-1 text-sm min-w-0 rounded px-2 py-0.5 focus:outline-none focus:ring-1"
                                    style={{
                                      background: 'var(--surface-raised)',
                                      border: '1px solid var(--accent)',
                                      color: 'var(--text)',
                                      '--tw-ring-color': 'var(--accent)',
                                    } as React.CSSProperties}
                                    value={inlineDesc}
                                    onChange={(e) => setInlineDesc(e.target.value)}
                                    onBlur={() => { setInlineEdit(null); saveInlineField(entry, { description: inlineDesc || null }); }}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') { setInlineEdit(null); saveInlineField(entry, { description: inlineDesc || null }); }
                                      if (e.key === 'Escape') { e.stopPropagation(); setInlineEdit(null); }
                                      if (e.key === ' ') e.stopPropagation();
                                    }}
                                  />
                                ) : (
                                  <span
                                    className="flex-1 text-sm truncate min-w-0 cursor-text rounded-sm px-1 -mx-1 hover:bg-white/5 transition-colors"
                                    style={{ color: entry.description ? 'var(--text)' : 'var(--text-muted)' }}
                                    onClick={() => { setOpenKebab(null); setInlineEdit({ entryId: entry.id, field: 'description' }); setInlineDesc(entry.description ?? ''); }}
                                  >
                                    {entry.description ?? <span style={{ fontStyle: 'italic' }}>Add description…</span>}
                                  </span>
                                )}

                                {/* Count badge (first row of multi-group only) */}
                                {isMulti && ei === 0 && (
                                  <button
                                    onClick={(e) => { e.stopPropagation(); toggleGroup(group.key); }}
                                    className="flex-shrink-0 flex items-center gap-0.5 px-1.5 py-0.5 rounded text-xs transition-colors hover:bg-white/10"
                                    style={{ color: 'var(--text-muted)', border: '1px solid var(--border)' }}
                                    aria-label={isExpanded ? 'Collapse' : `Expand ${group.entries.length} entries`}
                                  >
                                    {!isExpanded && <span>×{group.entries.length}</span>}
                                    <ChevronDown className={`w-3 h-3 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                                  </button>
                                )}

                                {/* Project — click to edit inline */}
                                {inlineEdit?.entryId === entry.id && inlineEdit.field === 'project' ? (
                                  <div className="flex-shrink-0" onClick={(e) => e.stopPropagation()}>
                                    <ProjectCombobox
                                      projects={projects}
                                      value={inlineProjectId}
                                      onChange={(id) => { setInlineProjectId(id); saveInlineField(entry, { projectId: id }); }}
                                      onClose={() => setInlineEdit(null)}
                                      placeholder="No project"
                                    />
                                  </div>
                                ) : (
                                  <button
                                    type="button"
                                    className="group/proj flex items-center gap-1.5 flex-shrink-0 rounded-sm px-1 -mx-1 hover:bg-white/5 transition-colors"
                                    onClick={() => { setOpenKebab(null); setInlineEdit({ entryId: entry.id, field: 'project' }); setInlineProjectId(entry.project?.id ?? null); }}
                                    title="Click to change project"
                                  >
                                    {entry.project ? (
                                      <>
                                        <ProjectIconOrDot icon={entry.project.icon} color={entry.project.color} size={20} dotClassName="w-2 h-2" />
                                        <span className="text-sm flex-shrink-0 max-w-[120px] truncate" style={{ color: entry.project.color }}>
                                          {entry.project.name}
                                        </span>
                                      </>
                                    ) : (
                                      <span className="opacity-0 group-hover/proj:opacity-100 text-xs transition-opacity" style={{ color: 'var(--text-muted)' }}>
                                        + project
                                      </span>
                                    )}
                                  </button>
                                )}

                                {/* Client — read-only, hidden while project combobox is open */}
                                {!(inlineEdit?.entryId === entry.id && inlineEdit.field === 'project') && entry.project?.client && (
                                  <span className="text-sm flex-shrink-0 hidden md:block" style={{ color: 'var(--text-muted)' }}>
                                    — {entry.project.client.name}
                                  </span>
                                )}

                                {/* Tags — click to edit inline */}
                                {inlineEdit?.entryId === entry.id && inlineEdit.field === 'tags' ? (
                                  <div className="flex items-center gap-1 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
                                    <TagCombobox
                                      tags={allTags}
                                      selectedIds={inlineTagIds}
                                      onChange={setInlineTagIds}
                                      onCreateTag={handleCreateTag}
                                    />
                                    <button
                                      onClick={() => { const ids = inlineTagIds; setInlineEdit(null); saveInlineField(entry, { tagIds: ids }); }}
                                      className="flex-shrink-0 p-1 rounded transition-colors hover:bg-white/10"
                                      style={{ color: 'var(--accent)' }}
                                      title="Save tags"
                                    >
                                      <Check className="w-3.5 h-3.5" />
                                    </button>
                                    <button
                                      onClick={() => setInlineEdit(null)}
                                      className="flex-shrink-0 p-1 rounded transition-colors hover:bg-white/10"
                                      style={{ color: 'var(--text-muted)' }}
                                      title="Cancel"
                                    >
                                      <X className="w-3.5 h-3.5" />
                                    </button>
                                  </div>
                                ) : (
                                  <button
                                    type="button"
                                    className="group/tags flex items-center gap-1 flex-shrink-0 hidden sm:flex rounded-sm px-1 -mx-1 hover:bg-white/5 transition-colors"
                                    onClick={() => { setOpenKebab(null); setInlineEdit({ entryId: entry.id, field: 'tags' }); setInlineTagIds(entry.tags.map((t) => t.id)); }}
                                    title="Click to edit tags"
                                  >
                                    {entry.tags.length > 0 ? (
                                      entry.tags.map((tag) => (
                                        <span
                                          key={tag.id}
                                          className="text-xs px-1.5 py-0.5 rounded flex-shrink-0"
                                          style={{ background: 'var(--surface-raised)', border: '1px solid var(--border)', color: 'var(--text-muted)' }}
                                        >
                                          <Tag className="w-2.5 h-2.5 inline mr-0.5 -mt-px" />
                                          {tag.name}
                                        </span>
                                      ))
                                    ) : (
                                      <span className="opacity-0 group-hover/tags:opacity-100 text-xs transition-opacity" style={{ color: 'var(--text-muted)' }}>
                                        + tag
                                      </span>
                                    )}
                                  </button>
                                )}

                                {/* Billable */}
                                {entry.isBillable && (
                                  <DollarSign className="w-3.5 h-3.5 flex-shrink-0" style={{ color: 'var(--accent)' }} />
                                )}

                                {/* Time range — start and end time independently editable */}
                                <span className="text-xs flex-shrink-0 hidden sm:flex items-center gap-0.5" style={{ color: 'var(--text-secondary)' }}>
                                  {inlineEdit?.entryId === entry.id && inlineEdit.field === 'startTime' ? (
                                    <input
                                      type="time"
                                      autoFocus
                                      className="w-24 text-xs rounded px-1 py-0.5 focus:outline-none"
                                      style={{ background: 'var(--surface-raised)', border: '1px solid var(--accent)', color: 'var(--text)' }}
                                      value={inlineStartTime}
                                      onChange={(e) => setInlineStartTime(e.target.value)}
                                      onBlur={() => {
                                        const date = format(new Date(entry.startedAt), 'yyyy-MM-dd');
                                        const startedAt = new Date(`${date}T${inlineStartTime}:00`).toISOString();
                                        setInlineEdit(null);
                                        saveInlineField(entry, { startedAt });
                                      }}
                                      onKeyDown={(e) => {
                                        if (e.key === 'Enter') {
                                          const date = format(new Date(entry.startedAt), 'yyyy-MM-dd');
                                          const startedAt = new Date(`${date}T${inlineStartTime}:00`).toISOString();
                                          setInlineEdit(null);
                                          saveInlineField(entry, { startedAt });
                                        }
                                        if (e.key === 'Escape') { e.stopPropagation(); setInlineEdit(null); }
                                      }}
                                    />
                                  ) : (
                                    <span
                                      className="cursor-pointer rounded-sm px-0.5 hover:bg-white/5 transition-colors"
                                      onClick={() => { setOpenKebab(null); setInlineEdit({ entryId: entry.id, field: 'startTime' }); setInlineStartTime(format(new Date(entry.startedAt), 'HH:mm')); }}
                                    >
                                      {formatTime(entry.startedAt)}
                                    </span>
                                  )}
                                  {entry.stoppedAt && (
                                    <>
                                      <span className="mx-0.5">–</span>
                                      {inlineEdit?.entryId === entry.id && inlineEdit.field === 'endTime' ? (
                                        <input
                                          type="time"
                                          autoFocus
                                          className="w-24 text-xs rounded px-1 py-0.5 focus:outline-none"
                                          style={{ background: 'var(--surface-raised)', border: '1px solid var(--accent)', color: 'var(--text)' }}
                                          value={inlineEndTime}
                                          onChange={(e) => setInlineEndTime(e.target.value)}
                                          onBlur={() => {
                                            const origin = new Date(entry.startedAt);
                                            const date = format(origin, 'yyyy-MM-dd');
                                            let stoppedAt = new Date(`${date}T${inlineEndTime}:00`);
                                            if (stoppedAt <= origin) stoppedAt = new Date(stoppedAt.getTime() + 86400000);
                                            setInlineEdit(null);
                                            saveInlineField(entry, { stoppedAt: stoppedAt.toISOString() });
                                          }}
                                          onKeyDown={(e) => {
                                            if (e.key === 'Enter') {
                                              const origin = new Date(entry.startedAt);
                                              const date = format(origin, 'yyyy-MM-dd');
                                              let stoppedAt = new Date(`${date}T${inlineEndTime}:00`);
                                              if (stoppedAt <= origin) stoppedAt = new Date(stoppedAt.getTime() + 86400000);
                                              setInlineEdit(null);
                                              saveInlineField(entry, { stoppedAt: stoppedAt.toISOString() });
                                            }
                                            if (e.key === 'Escape') { e.stopPropagation(); setInlineEdit(null); }
                                          }}
                                        />
                                      ) : (
                                        <span
                                          className="cursor-pointer rounded-sm px-0.5 hover:bg-white/5 transition-colors"
                                          onClick={() => { setOpenKebab(null); setInlineEdit({ entryId: entry.id, field: 'endTime' }); setInlineEndTime(format(new Date(entry.stoppedAt!), 'HH:mm')); }}
                                        >
                                          {formatTime(entry.stoppedAt)}
                                        </span>
                                      )}
                                    </>
                                  )}
                                </span>

                                {/* Duration */}
                                <span className="text-sm tabular-nums flex-shrink-0" style={{ color: 'var(--text)' }}>
                                  {formatHM(isMulti && !isExpanded ? groupTotal : seconds)}
                                </span>

                                {/* Play */}
                                <button
                                  onClick={() => handlePlay(entry)}
                                  disabled={isRunning || loading}
                                  className="opacity-0 group-hover:opacity-100 flex-shrink-0 transition-opacity disabled:cursor-not-allowed"
                                  style={{ color: 'var(--text-muted)' }}
                                  onMouseEnter={(e) => { if (!isRunning && !loading) e.currentTarget.style.color = 'var(--accent)'; }}
                                  onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)'; }}
                                  aria-label="Restart this entry"
                                >
                                  <Play className="w-4 h-4" />
                                </button>

                                {/* Kebab */}
                                <div className="relative flex-shrink-0" onClick={(e) => e.stopPropagation()}>
                                  <button
                                    onClick={() => setOpenKebab(openKebab === entry.id ? null : entry.id)}
                                    className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded"
                                    style={{ color: 'var(--text-muted)' }}
                                    aria-label="Entry options"
                                  >
                                    <MoreHorizontal className="w-4 h-4" />
                                  </button>
                                  {openKebab === entry.id && (
                                    <div
                                      className="absolute right-0 bottom-full mb-1 w-36 rounded-lg shadow-lg py-1 z-30"
                                      style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
                                    >
                                      <button
                                        onClick={() => { setEditingEntry(entry); setOpenKebab(null); }}
                                        className="w-full text-left px-3 py-2 text-sm hover:bg-white/5 transition-colors"
                                        style={{ color: 'var(--text)' }}
                                      >
                                        Edit
                                      </button>
                                      <button
                                        onClick={() => { handleDuplicate(entry); setOpenKebab(null); }}
                                        className="w-full text-left px-3 py-2 text-sm hover:bg-white/5 transition-colors"
                                        style={{ color: 'var(--text)' }}
                                      >
                                        Duplicate
                                      </button>
                                      <div style={{ borderTop: '1px solid var(--border)', margin: '2px 0' }} />
                                      <button
                                        onClick={() => { handleDelete(entry.id); setOpenKebab(null); }}
                                        className="w-full text-left px-3 py-2 text-sm hover:bg-white/5 transition-colors"
                                        style={{ color: 'var(--error)' }}
                                      >
                                        Delete
                                      </button>
                                    </div>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            ),
          )}

          {/* Load more */}
          {hasMore && (
            <button
              onClick={loadMoreWeeks}
              disabled={loadingMore}
              className="w-full py-3 text-sm rounded-xl transition-colors disabled:opacity-50"
              style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text-muted)' }}
            >
              {loadingMore ? 'Loading…' : 'Load older entries'}
            </button>
          )}
        </div>
      )}

      {/* ── Edit modal ───────────────────────────────────────────────────── */}
      {editingEntry && (
        <div
          className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4"
          onMouseDown={(e) => { editMouseDown.current = e.target === e.currentTarget; }}
          onClick={(e) => { if (e.target === e.currentTarget && editMouseDown.current) setEditingEntry(null); }}
        >
          <div
            className="rounded-2xl p-6 w-full max-w-md shadow-2xl"
            style={{ background: 'var(--card)', border: '1px solid var(--border)' }}
          >
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-normal" style={{ color: 'var(--text)' }}>Edit entry</h2>
              <button onClick={() => setEditingEntry(null)} className="p-1 rounded" style={{ color: 'var(--text-muted)' }}>
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm mb-1.5" style={{ color: 'var(--text-secondary)' }}>Description</label>
                <input
                  type="text"
                  value={editDesc}
                  onChange={(e) => setEditDesc(e.target.value)}
                  className="w-full rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2"
                  style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border)', color: 'var(--text)', '--tw-ring-color': 'var(--accent)' } as React.CSSProperties}
                  placeholder="What were you working on?"
                />
              </div>

              <div>
                <label className="block text-sm mb-1.5" style={{ color: 'var(--text-secondary)' }}>Project</label>
                <ProjectCombobox
                  projects={projects}
                  value={editProjectId || null}
                  onChange={(id) => setEditProjectId(id ?? '')}
                />
              </div>

              <div>
                <label className="block text-sm mb-1.5" style={{ color: 'var(--text-secondary)' }}>Tags</label>
                <TagCombobox
                  tags={allTags}
                  selectedIds={editTagIds}
                  onChange={setEditTagIds}
                  onCreateTag={handleCreateTag}
                />
              </div>

              <div>
                <label className="block text-sm mb-1.5" style={{ color: 'var(--text-secondary)' }}>Date</label>
                <input
                  type="date"
                  value={editDate}
                  onChange={(e) => setEditDate(e.target.value)}
                  className="w-full rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2"
                  style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border)', color: 'var(--text)', '--tw-ring-color': 'var(--accent)' } as React.CSSProperties}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm mb-1.5" style={{ color: 'var(--text-secondary)' }}>Start</label>
                  <input
                    type="time"
                    value={editStartTime}
                    onChange={(e) => setEditStartTime(e.target.value)}
                    className="w-full rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2"
                    style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border)', color: 'var(--text)', '--tw-ring-color': 'var(--accent)' } as React.CSSProperties}
                  />
                </div>
                <div>
                  <label className="block text-sm mb-1.5" style={{ color: 'var(--text-secondary)' }}>
                    End
                    {editEndTime && editStartTime && new Date(`${editDate}T${editEndTime}:00`) <= new Date(`${editDate}T${editStartTime}:00`) && (
                      <span className="ml-1.5 text-xs" style={{ color: 'var(--text-muted)' }}>(+1 day)</span>
                    )}
                  </label>
                  <input
                    type="time"
                    value={editEndTime}
                    onChange={(e) => setEditEndTime(e.target.value)}
                    className="w-full rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2"
                    style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border)', color: 'var(--text)', '--tw-ring-color': 'var(--accent)' } as React.CSSProperties}
                  />
                </div>
              </div>

              {editError && <p className="text-sm" style={{ color: 'var(--error)' }}>{editError}</p>}
            </div>

            <div className="flex gap-3 mt-6">
              <button
                onClick={() => setEditingEntry(null)}
                className="flex-1 py-2.5 rounded-lg text-sm transition-colors"
                style={{ border: '1px solid var(--border)', color: 'var(--text-secondary)' }}
              >
                Cancel
              </button>
              <button
                onClick={handleEditSave}
                disabled={editSaving || !editDate || !editStartTime || !editEndTime}
                className="flex-1 text-white py-2.5 rounded-lg text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                style={{ background: 'var(--accent)' }}
              >
                {editSaving ? 'Saving…' : 'Save changes'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
