import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../api/client';
import { searchApi } from '../api/search';
import { columnsApi } from '../api/columns';
import { tasksApi } from '../api/tasks';
import { assigneesApi } from '../api/assignees';
import { matchNavCommands, parseCommand } from '../lib/commands';
import { useAuthStore } from '../stores/auth-store';

interface PaletteItem {
  id: string;
  group: string;
  primary: React.ReactNode;
  hint?: string;
  /** Optional muted second line (e.g. a meeting search snippet). */
  secondary?: string;
  run: () => void | Promise<void>;
}

/**
 * Command palette + global search. Finds tasks/projects/people, jumps to any page ("go to
 * reports"), and runs quick task commands ("open MICO-7", "complete MICO-7", "assign MICO-7 to
 * Sara"). Open with ⌘K / Ctrl-K. (Upgrades the former find-only search — T6.2.)
 */
export function GlobalSearch({ debounceMs = 250 }: { debounceMs?: number }) {
  const navigate = useNavigate();
  const [, setSearchParams] = useSearchParams();
  const qc = useQueryClient();
  const isAdmin = useAuthStore((s) => s.isAdmin());

  const [term, setTerm] = useState('');
  const [debounced, setDebounced] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(term), debounceMs);
    return () => clearTimeout(t);
  }, [term, debounceMs]);

  // ⌘K / Ctrl-K focuses the palette from anywhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const raw = term.trim();
  const searchEnabled = debounced.trim().length >= 2;
  const q = useQuery({
    queryKey: ['search', debounced],
    queryFn: () => searchApi(apiClient).search(debounced),
    enabled: searchEnabled,
  });

  // ── Action executors ──
  const resolveTask = async (key: string) => {
    const r = await searchApi(apiClient).search(key);
    return r.tasks.find((t) => t.key.toLowerCase() === key.toLowerCase()) ?? r.tasks[0] ?? null;
  };
  const openTask = (id: string) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('task', id);
      return next;
    });
    reset();
  };
  const withStatus = async (label: string, fn: () => Promise<string>) => {
    setBusy(true);
    setStatus(`${label}…`);
    try {
      setStatus(await fn());
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };
  const completeCmd = (key: string) =>
    withStatus(`Completing ${key}`, async () => {
      const task = await resolveTask(key);
      if (!task) throw new Error(`No task matching ${key}.`);
      const cols = await columnsApi(apiClient).list(task.projectId);
      const done = cols.find((c) => c.category === 'DONE' && c.enabled) ?? cols.find((c) => c.category === 'DONE');
      if (!done) throw new Error(`${task.key}: this project has no “Done” column.`);
      await tasksApi(apiClient).move(task.id, done.id);
      // Targeted refresh — a single task action must not refetch the entire cache (reports, audit, chat…).
      for (const key of ['board', 'my-tasks', 'project-tasks', 'tasks', 'task', 'search']) void qc.invalidateQueries({ queryKey: [key] });
      return `Completed ${task.key} ✓`;
    });
  const assignCmd = (key: string, name: string) =>
    withStatus(`Assigning ${key}`, async () => {
      const task = await resolveTask(key);
      if (!task) throw new Error(`No task matching ${key}.`);
      const users = (await searchApi(apiClient).search(name)).users;
      if (users.length === 0) throw new Error(`No teammate matching “${name}”.`);
      const user = users[0]!;
      await assigneesApi(apiClient).assign(task.id, user.id);
      // Targeted refresh — a single task action must not refetch the entire cache (reports, audit, chat…).
      for (const key of ['board', 'my-tasks', 'project-tasks', 'tasks', 'task', 'search']) void qc.invalidateQueries({ queryKey: [key] });
      return `Assigned ${task.key} to ${[user.firstName, user.lastName].filter(Boolean).join(' ') || user.username} ✓`;
    });
  const moveCmd = (key: string, statusText: string) =>
    withStatus(`Moving ${key}`, async () => {
      const task = await resolveTask(key);
      if (!task) throw new Error(`No task matching ${key}.`);
      const cols = await columnsApi(apiClient).list(task.projectId);
      const s = statusText.toLowerCase();
      const col = cols.find((c) => c.name.toLowerCase() === s) ?? cols.find((c) => c.name.toLowerCase().includes(s)) ?? cols.find((c) => c.category.toLowerCase().includes(s.replace(/\s+/g, '_')));
      if (!col) throw new Error(`${task.key}: no column matching “${statusText}”.`);
      await tasksApi(apiClient).move(task.id, col.id);
      // Targeted refresh — a single task action must not refetch the entire cache (reports, audit, chat…).
      for (const key of ['board', 'my-tasks', 'project-tasks', 'tasks', 'task', 'search']) void qc.invalidateQueries({ queryKey: [key] });
      return `Moved ${task.key} → ${col.name} ✓`;
    });

  const reset = () => {
    setTerm('');
    setDebounced('');
    setOpen(false);
    setStatus(null);
    inputRef.current?.blur();
  };

  // ── Assemble the flat item list (command → navigation → search results) ──
  const items = useMemo<PaletteItem[]>(() => {
    const out: PaletteItem[] = [];
    const parsed = raw ? parseCommand(raw, isAdmin) : null;
    if (parsed) {
      if (parsed.type === 'navigate') out.push({ id: 'cmd-nav', group: 'Command', primary: `Go to ${parsed.label}`, run: () => { navigate(parsed.to); reset(); } });
      else if (parsed.type === 'open') out.push({ id: 'cmd-open', group: 'Command', primary: `Open ${parsed.taskKey}`, run: async () => { const t = await resolveTask(parsed.taskKey); if (t) openTask(t.id); else setStatus(`No task matching ${parsed.taskKey}.`); } });
      else if (parsed.type === 'complete') out.push({ id: 'cmd-complete', group: 'Command', primary: `Complete ${parsed.taskKey}`, run: () => completeCmd(parsed.taskKey) });
      else if (parsed.type === 'assign') out.push({ id: 'cmd-assign', group: 'Command', primary: `Assign ${parsed.taskKey} to ${parsed.assignee}`, run: () => assignCmd(parsed.taskKey, parsed.assignee) });
      else if (parsed.type === 'move') out.push({ id: 'cmd-move', group: 'Command', primary: `Move ${parsed.taskKey} to ${parsed.status}`, run: () => moveCmd(parsed.taskKey, parsed.status) });
    }

    for (const nav of matchNavCommands(raw, isAdmin).slice(0, raw ? 6 : 5)) {
      out.push({ id: `nav-${nav.id}`, group: 'Go to', primary: nav.label, run: () => { navigate(nav.to); reset(); } });
    }

    const r = q.data;
    if (searchEnabled && r) {
      for (const t of r.tasks.slice(0, 6)) out.push({ id: `task-${t.id}`, group: 'Tasks', primary: t.title, hint: t.key, run: () => openTask(t.id) });
      for (const p of r.projects.slice(0, 5)) out.push({ id: `proj-${p.id}`, group: 'Projects', primary: p.name, hint: p.code, run: () => { navigate(`/projects/${p.id}`); reset(); } });
      for (const u of r.users.slice(0, 5)) out.push({ id: `user-${u.id}`, group: 'People', primary: [u.firstName, u.lastName].filter(Boolean).join(' ') || u.username, run: () => { navigate('/admin/users'); reset(); } });
      for (const m of (r.meetings ?? []).slice(0, 6)) out.push({ id: `meeting-${m.id}`, group: 'Meetings', primary: m.title, secondary: m.snippet, run: () => { navigate(`/meetings/${m.id}`); reset(); } });
    }
    return out;
  }, [raw, isAdmin, q.data, searchEnabled]);

  useEffect(() => { setActive(0); }, [items.length]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(items.length - 1, i + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(0, i - 1)); }
    else if (e.key === 'Enter') { const it = items[active]; if (it) { e.preventDefault(); void it.run(); } }
    else if (e.key === 'Escape') { reset(); }
  };

  const showPanel = open && (items.length > 0 || (searchEnabled && q.isLoading) || (searchEnabled && !q.isLoading && items.length === 0) || status !== null);
  let idx = -1; // running index across groups for keyboard highlight

  return (
    <div className="relative w-full min-w-0 max-w-full sm:w-72">
      <div className="relative">
        <svg viewBox="0 0 24 24" width="15" height="15" className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
        <input
          ref={inputRef}
          type="search"
          role="searchbox"
          aria-label="Search"
          placeholder="Search or type a command…"
          value={term}
          onChange={(e) => { setTerm(e.target.value); setStatus(null); }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 160)}
          onKeyDown={onKeyDown}
          className="w-full rounded-lg border border-line bg-ground py-1.5 pl-8 pr-9 text-sm text-ink outline-none transition-colors focus:border-brand focus:ring-2 focus:ring-brand/20"
        />
        <kbd className="pointer-events-none absolute right-2 top-1/2 hidden -translate-y-1/2 rounded border border-line bg-surface px-1.5 py-0.5 text-[10px] font-medium text-ink-3 sm:block">⌘K</kbd>
      </div>

      {showPanel ? (
        <div className="absolute left-0 z-40 mt-1 w-96 max-w-[92vw] overflow-hidden rounded-xl border border-line bg-surface shadow-lg">
          {status ? (
            <p className={`border-b border-line px-3 py-2 text-sm ${busy ? 'text-ink-2' : status.includes('✓') ? 'text-success' : 'text-danger'}`}>
              {busy ? <span className="mr-1.5 inline-block h-3 w-3 animate-spin rounded-full border-2 border-brand/30 border-t-brand align-middle" /> : null}
              {status}
            </p>
          ) : null}

          {items.length === 0 && searchEnabled && q.isLoading ? (
            <p className="px-3 py-3 text-sm text-ink-2">Searching…</p>
          ) : items.length === 0 && searchEnabled ? (
            <p className="px-3 py-3 text-sm text-ink-2">No matches for “{debounced}”.</p>
          ) : (
            <div className="max-h-96 overflow-y-auto py-1">
              {groupItems(items).map(([group, groupItemList]) => (
                <div key={group} className="py-1">
                  <p className="px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-ink-3">{group}</p>
                  {groupItemList.map((it) => {
                    idx += 1;
                    const i = idx;
                    return (
                      <button
                        key={it.id}
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onMouseEnter={() => setActive(i)}
                        onClick={() => void it.run()}
                        className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors ${i === active ? 'bg-brand/10 text-brand' : 'text-ink hover:bg-ground'}`}
                      >
                        {it.hint ? <span className="font-mono text-xs text-ink-2">{it.hint}</span> : null}
                        <span className="min-w-0 flex-1">
                          <span className="block truncate">{it.primary}</span>
                          {it.secondary ? <span className="block truncate text-xs text-ink-3">{it.secondary}</span> : null}
                        </span>
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

/** Group items in stable order for rendering. */
function groupItems(items: PaletteItem[]): [string, PaletteItem[]][] {
  const order: string[] = [];
  const map = new Map<string, PaletteItem[]>();
  for (const it of items) {
    if (!map.has(it.group)) { map.set(it.group, []); order.push(it.group); }
    map.get(it.group)!.push(it);
  }
  return order.map((g) => [g, map.get(g)!]);
}
