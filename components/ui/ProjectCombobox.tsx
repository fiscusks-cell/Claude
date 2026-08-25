'use client';
import { useState, useRef, useEffect, useCallback } from 'react';
import { ChevronDown, ChevronRight, X } from 'lucide-react';
import { ProjectIconOrDot } from '@/components/ui/ProjectIconOrDot';

export interface ProjectOption {
  id: string;
  name: string;
  color: string;
  icon?: string | null;
  clientName?: string | null;
}

interface Props {
  projects: ProjectOption[];
  value: string | null;
  onChange: (id: string | null) => void;
  disabled?: boolean;
  placeholder?: string;
  onClose?: () => void;
  forceOpen?: boolean;
}

function ProjectRow({
  p,
  selected,
  onSelect,
  indent = false,
}: {
  p: ProjectOption;
  selected: boolean;
  onSelect: (id: string) => void;
  indent?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(p.id)}
      className={`w-full text-left py-2 flex items-center gap-2.5 hover:bg-white/5 transition-colors ${selected ? 'bg-white/5' : ''} ${indent ? 'px-4' : 'px-3'}`}
    >
      <ProjectIconOrDot icon={p.icon} color={p.color} size={24} />
      <span className="text-sm font-semibold truncate" style={{ color: 'var(--text)' }}>
        {p.name}
      </span>
    </button>
  );
}

export function ProjectCombobox({
  projects,
  value,
  onChange,
  disabled = false,
  placeholder = 'Project',
  onClose,
  forceOpen = false,
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [collapsedClients, setCollapsedClients] = useState<Set<string>>(new Set());

  const toggleClient = useCallback((label: string) => {
    setCollapsedClients((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  }, []);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const selected = projects.find((p) => p.id === value) ?? null;

  const filtered = query.trim()
    ? projects.filter((p) => p.name.toLowerCase().includes(query.toLowerCase()))
    : projects;

  const openDropdown = useCallback(() => {
    if (!disabled) {
      setQuery('');
      setOpen(true);
    }
  }, [disabled]);

  const select = useCallback(
    (id: string | null) => {
      onChange(id);
      setOpen(false);
      setQuery('');
      onClose?.();
    },
    [onChange, onClose],
  );

  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery('');
        onClose?.();
      }
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (forceOpen) openDropdown();
  }, [forceOpen, openDropdown]);

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') {
      setOpen(false);
      setQuery('');
    }
    if (e.key === 'Enter' && filtered.length > 0) {
      select(filtered[0].id);
    }
    if (e.key === ' ' && !query) {
      e.preventDefault();
    }
  }

  return (
    <div ref={containerRef} className="relative">
      {/* Trigger */}
      <button
        type="button"
        disabled={disabled}
        onClick={openDropdown}
        onKeyDown={(e) => {
          if (e.key === ' ' || e.key === 'Enter') {
            e.preventDefault();
            openDropdown();
          }
        }}
        className={`flex items-center gap-2 h-9 rounded-lg px-3 text-sm transition-colors min-w-[160px] max-w-[220px] disabled:opacity-60 disabled:cursor-not-allowed ${open ? 'ring-2 ring-indigo-500' : ''}`}
        style={{
          background: 'var(--surface-raised)',
          border: `1px solid ${open ? '#6366f1' : 'var(--border)'}`,
        }}
      >
        {selected ? (
          <>
            <ProjectIconOrDot icon={selected.icon} color={selected.color} size={24} />
            <span className="truncate flex-1 text-left font-medium" style={{ color: 'var(--text)' }}>
              {selected.name}
            </span>
            {!disabled && (
              <X
                className="w-3.5 h-3.5 flex-shrink-0"
                style={{ color: 'var(--text-muted)' }}
                onClick={(e) => {
                  e.stopPropagation();
                  select(null);
                }}
              />
            )}
          </>
        ) : (
          <>
            <span className="flex-1 text-left" style={{ color: 'var(--text-muted)' }}>
              {placeholder}
            </span>
            <ChevronDown className="w-3.5 h-3.5 flex-shrink-0" style={{ color: 'var(--text-muted)' }} />
          </>
        )}
      </button>

      {/* Dropdown */}
      {open && (
        <div
          className="absolute z-50 top-full mt-1 left-0 w-80 max-w-[calc(100vw-2rem)] rounded-xl shadow-lg overflow-hidden"
          style={{
            background: 'var(--surface)',
            border: '1px solid var(--border)',
          }}
        >
          {/* Search */}
          <div className="p-2" style={{ borderBottom: '1px solid var(--border)' }}>
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Search projects…"
              className="w-full text-sm px-3 py-1.5 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
              style={{
                background: 'var(--surface-raised)',
                color: 'var(--text)',
                border: '1px solid var(--border)',
              }}
            />
          </div>

          {/* Options */}
          <ul className="max-h-56 overflow-y-auto py-1">
            <li>
              <button
                type="button"
                onClick={() => select(null)}
                className={`w-full text-left px-3 py-2 flex items-center gap-2.5 hover:bg-white/5 transition-colors ${!value ? 'bg-white/5' : ''}`}
              >
                <span
                  className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                  style={{ border: '1px solid var(--border)' }}
                />
                <span className="text-sm italic" style={{ color: 'var(--text-muted)' }}>
                  No project
                </span>
              </button>
            </li>

            {filtered.length === 0 ? (
              <li className="px-3 py-4 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
                No matches
              </li>
            ) : query.trim() ? (
              // Flat list while searching — headers add noise mid-search
              filtered.map((p) => (
                <li key={p.id}>
                  <ProjectRow p={p} selected={value === p.id} onSelect={select} />
                </li>
              ))
            ) : (
              // Grouped by client when not searching
              (() => {
                const groups = new Map<string, ProjectOption[]>();
                const noClient: ProjectOption[] = [];
                for (const p of projects) {
                  if (p.clientName) {
                    const existing = groups.get(p.clientName) ?? [];
                    existing.push(p);
                    groups.set(p.clientName, existing);
                  } else {
                    noClient.push(p);
                  }
                }
                const sortedClients = [...groups.keys()].sort((a, b) => a.localeCompare(b));
                const sections: Array<{ label: string; items: ProjectOption[] }> = [
                  ...sortedClients.map((client) => ({ label: client, items: groups.get(client)! })),
                  ...(noClient.length > 0 ? [{ label: 'No client', items: noClient }] : []),
                ];
                return sections.map(({ label, items }) => {
                  const collapsed = collapsedClients.has(label);
                  return (
                    <li key={label}>
                      <button
                        type="button"
                        onClick={() => toggleClient(label)}
                        className="w-full flex items-center gap-1 px-3 pt-3 pb-1 hover:opacity-80 transition-opacity"
                      >
                        {collapsed
                          ? <ChevronRight className="w-3 h-3 flex-shrink-0" style={{ color: 'var(--text-muted)' }} />
                          : <ChevronDown className="w-3 h-3 flex-shrink-0" style={{ color: 'var(--text-muted)' }} />
                        }
                        <span
                          className="text-[10px] uppercase tracking-widest select-none"
                          style={{ color: 'var(--text-muted)' }}
                        >
                          {label}
                        </span>
                      </button>
                      {!collapsed && (
                        <ul>
                          {items.map((p) => (
                            <li key={p.id}>
                              <ProjectRow p={p} selected={value === p.id} onSelect={select} indent />
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  );
                });
              })()
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
