import { useEffectiveAdmin } from '../lib/manager-view';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../api/client';
import { searchApi, searchEverythingApi } from '../api/search';
import { TasksUnavailable } from './search/TasksUnavailable';
import { projectsApi } from '../api/projects';
import { usersApi } from '../api/users';
import type { SearchResults } from '../api/search';
import { ProjectAvatar } from './ProjectAvatar';
import { columnsApi } from '../api/columns';
import { tasksApi } from '../api/tasks';
import { assigneesApi } from '../api/assignees';
import { commandTaskKeys, matchNavCommands, parseCommand } from '../lib/commands';
import { pickByTaskNumber } from '../lib/task-number';
import { useManagementAccess } from '../lib/useManagementAccess';
import { invalidateTaskQueries } from '../lib/task-cache';
import { approvalNotice } from '../lib/approvals';
import { useAuthStore } from '../stores/auth-store';
import { useShortcut, useShortcutSettings } from './shortcuts/ShortcutProvider';
import { ariaKeyshortcuts, shortcutLabel } from '../lib/shortcuts';
import { useMediaQuery } from '../lib/useMediaQuery';
import type { TaskSearchHit } from '../lib/search-highlight';
import { Highlighted } from './ui/Highlighted';
import { FoundTaskKey } from './TaskKey';
import { KindIcon } from './search/KindIcon';
import { KIND_META, everythingAddress, savedAddress, targetLink, type SearchHit } from '../lib/search-everything';
import { countLabel, useSavedCounts, useSavedSearches } from '../lib/useSavedSearches';
import { ArchivedBadge } from './task-archive/ArchivedBadge';

/** "open …" typed (the open command, or a page: "open calendar"). */
const OPEN_VERB = /^open\s/i;

interface PaletteItem {
  id: string;
  group: string;
  primary: React.ReactNode;
  hint?: string;
  /** A found task's number (the TaskKey chip, 1.22.3) and the numbers it had before a move. */
  taskKey?: { value: string; former?: string[] };
  /** Optional picture before the text (a project's). */
  icon?: React.ReactNode;
  /** Optional muted second line (a meeting's snippet, where a task matched). */
  secondary?: React.ReactNode;
  /** 1.23.6: how many it finds, at the end of the row ("→ 7"). */
  count?: string;
  /** Task archive: a found task that is archived says so. */
  archived?: boolean;
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
  // Manager View (owner, 10 Nov): no way to the Admin menu's pages while it is on (Reports stays).
  const settingsAdmin = useEffectiveAdmin();
  const settingsOk = (to: string) => settingsAdmin || !to.startsWith('/admin/');
  // The Management page is offered to administrators and the people who run a project.
  const { allowed: canLead } = useManagementAccess();
  const myId = useAuthStore((s) => s.user?.id);
  // Where a person in the results leads: yourself → your profile; an admin → the user list; anyone
  // else → a conversation with that person (the user list is admin-only, so it was a dead end).
  const personPath = (userId: string) => (userId === myId ? '/profile' : settingsAdmin ? '/admin/users' : `/chat?dm=${encodeURIComponent(userId)}`);

  const [term, setTerm] = useState('');
  const [debounced, setDebounced] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  // The whole hint fits only the full-width box (a wide screen); a narrower box was cutting it to
  // "Sea" / "Search or ty" on a phone and "Search or type a comm" on a tablet.
  const roomy = useMediaQuery('(min-width: 80em)', true);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(term), debounceMs);
    return () => clearTimeout(t);
  }, [term, debounceMs]);

  // ⌘K / Ctrl+K (and / on a page without its own search box) focuses the palette from anywhere.
  const { platform } = useShortcutSettings();
  useShortcut(
    'search',
    () => {
      inputRef.current?.focus();
      setOpen(true);
    },
    { priority: 0 },
  );

  const raw = term.trim();
  const searchEnabled = debounced.trim().length >= 2;
  const q = useQuery({
    queryKey: ['search', debounced],
    queryFn: () => searchApi(apiClient).search(debounced),
    enabled: searchEnabled,
  });
  // 1.22.3 review: "open" and a loosely typed number ("open mico 142", "open phase 2") is offered once a
  // search for that number finds the task (the search for the whole text wouldn't); until then — or
  // with no such task — it is a plain search. (A number typed alone is looked up by the search itself.)
  const settled = searchEnabled ? parseCommand(debounced, isAdmin, canLead) : null;
  const lookupKey = settled?.type === 'open' && settled.onlyIfFound && OPEN_VERB.test(debounced.trim()) ? settled.taskKey : null;
  const lookupQ = useQuery({
    queryKey: ['search', lookupKey],
    queryFn: () => searchApi(apiClient).search(lookupKey!),
    enabled: lookupKey !== null,
  });
  // Found projects show their picture; the project list is normally cached already.
  const projectsQ = useQuery({ queryKey: ['projects'], queryFn: () => projectsApi(apiClient).list(), enabled: searchEnabled });
  // companies: found people are colleagues only (spec §3 "directory search"): a teammate from another
  // company, known only from a shared project or an old chat, is left out (the directory says so).
  const directoryQ = useQuery({ queryKey: ['directory'], queryFn: () => usersApi(apiClient).directory(), enabled: searchEnabled });
  // 1.23: with AI set up, "See all results" also asks the AI panel on the Search results page.
  const aiQ = useQuery({ queryKey: ['search-ai-status'], queryFn: () => searchEverythingApi(apiClient).aiStatus(), enabled: searchEnabled, staleTime: 60_000, retry: false });
  const aiReady = aiQ.data?.ready === true;
  // 1.23.6: the person's saved searches (pinned first) when the box is empty, with the pinned ones' counts.
  const savedQ = useSavedSearches(open);
  const savedCounts = useSavedCounts(open && !raw ? savedQ.pinned.map((s) => s.id) : []);

  // ── Action executors ──
  // Commands act only on the task whose key matches exactly — search is a substring match, so
  // "complete WEB-5" must never fall back to WEB-50 when WEB-5 is gone or not visible to you. A key a
  // task had before it moved project counts too: "open RIG-4" opens what is OPS-17 now. (1.22.3 review:
  // these commands name the number with its hyphen; a run-together "HR214" — HR-214 or HR2-14? — is
  // only ever offered as the task the search found, "Open HR2-14".)
  const resolveTask = async (key: string) => {
    const r = await searchApi(apiClient).search(key);
    return pickByTaskNumber(r.tasks, commandTaskKeys(key));
  };
  const openTask = (id: string, fileId?: string) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('task', id);
      if (fileId) next.set('file', fileId);
      else next.delete('file');
      return next;
    });
    reset();
  };
  /** 1.23: a note, minutes, a file or an inspection found: its page (a file: its task, the file marked). */
  const openHit = (h: SearchHit) => {
    const to = targetLink(h);
    if (to) {
      navigate(to);
      reset();
    } else if (h.target.type === 'file') openTask(h.target.taskId, h.target.fileId);
    else if (h.target.type === 'task') openTask(h.target.taskId);
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
      if (!task) throw new Error(`No task ${key}.`);
      const cols = await columnsApi(apiClient).list(task.projectId);
      const done = cols.find((c) => c.category === 'DONE' && c.enabled) ?? cols.find((c) => c.category === 'DONE');
      if (!done) throw new Error(`${task.key}: this project has no “Done” column.`);
      const moved = await tasksApi(apiClient).move(task.id, done.id);
      // Targeted refresh — every task view, but not the entire cache (audit, chat…).
      void invalidateTaskQueries(qc);
      // A task that needs approval waits for a project manager instead of completing.
      return approvalNotice(done.id, moved) ?? `Completed ${task.key} ✓`;
    });
  const assignCmd = (key: string, name: string) =>
    withStatus(`Assigning ${key}`, async () => {
      const task = await resolveTask(key);
      if (!task) throw new Error(`No task ${key}.`);
      const users = (await searchApi(apiClient).search(name)).users;
      if (users.length === 0) throw new Error(`No teammate matching “${name}”.`);
      const user = users[0]!;
      await assigneesApi(apiClient).assign(task.id, user.id);
      // Targeted refresh — every task view, but not the entire cache (audit, chat…).
      void invalidateTaskQueries(qc);
      return `Assigned ${task.key} to ${[user.firstName, user.lastName].filter(Boolean).join(' ') || user.username} ✓`;
    });
  const moveCmd = (key: string, statusText: string) =>
    withStatus(`Moving ${key}`, async () => {
      const task = await resolveTask(key);
      if (!task) throw new Error(`No task ${key}.`);
      const cols = await columnsApi(apiClient).list(task.projectId);
      const s = statusText.toLowerCase();
      const col = cols.find((c) => c.name.toLowerCase() === s) ?? cols.find((c) => c.name.toLowerCase().includes(s)) ?? cols.find((c) => c.category.toLowerCase().includes(s.replace(/\s+/g, '_')));
      if (!col) throw new Error(`${task.key}: no column matching “${statusText}”.`);
      await tasksApi(apiClient).move(task.id, col.id);
      // Targeted refresh — every task view, but not the entire cache (audit, chat…).
      void invalidateTaskQueries(qc);
      return `Moved ${task.key} → ${col.name} ✓`;
    });

  /** Where else a found task matched (its first place): "Comment by Bilal · 28 Oct 2026: …the scaffold permit…". */
  const whereMatched = (t: TaskSearchHit) => {
    const m = t.matches?.[0];
    return m ? <><span className="font-medium text-ink-2">{m.label}: </span><Highlighted text={m.snippet} ranges={m.ranges} /></> : undefined;
  };

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
    // 1.23.6: an empty box offers the saved searches — the pinned ones first (with their counts), then the rest.
    if (!raw) {
      const rest = savedQ.all.filter((s) => !savedQ.pinned.includes(s));
      for (const s of [...savedQ.pinned, ...rest].slice(0, 8)) {
        const c = countLabel(savedCounts.data?.[s.id]);
        out.push({
          id: `saved-${s.id}`, group: 'Saved searches', primary: s.name,
          ...(s.mine ? {} : { secondary: `Shared by ${s.owner.name}${s.shared ? ` · ${s.shared.code}` : ''}` }),
          ...(c ? { count: c } : {}),
          run: () => { navigate(`/search?${savedAddress(s)}`); reset(); },
        });
      }
    }
    const parsed = raw ? parseCommand(raw, isAdmin, canLead) : null;
    // 1.22.3: a number typed loosely ("mico 142", "MICO142", "open mico 142") is offered once the search
    // finds that task, now or by an old number (null: not found — "phase 2" stays a plain search). Of a
    // run-together one it is the task found ("Open HR2-14" for "open hr214"), never a guess.
    const lookedUp = OPEN_VERB.test(raw) ? lookupQ.data : searchEnabled ? q.data : undefined;
    const loose = parsed?.type === 'open' && parsed.onlyIfFound ? (lookedUp ? pickByTaskNumber(lookedUp.tasks ?? [], commandTaskKeys(parsed.taskKey)) : null) : undefined;
    if (parsed) {
      if (parsed.type === 'navigate' && !settingsOk(parsed.to)) {
        // (An admin page while Manager View is on: no command; the search goes on as a plain search.)
      } else if (parsed.type === 'navigate') out.push({ id: 'cmd-nav', group: 'Command', primary: `Go to ${parsed.label}`, run: () => { navigate(parsed.to); reset(); } });
      else if (parsed.type === 'open' && loose) out.push({ id: 'cmd-open', group: 'Command', primary: `Open ${loose.key}`, run: () => openTask(loose.id) });
      else if (parsed.type === 'open' && loose === undefined) out.push({ id: 'cmd-open', group: 'Command', primary: `Open ${parsed.taskKey}`, run: async () => { const t = await resolveTask(parsed.taskKey); if (t) openTask(t.id); else setStatus(`No task ${parsed.taskKey}.`); } });
      else if (parsed.type === 'complete') out.push({ id: 'cmd-complete', group: 'Command', primary: `Complete ${parsed.taskKey}`, run: () => completeCmd(parsed.taskKey) });
      else if (parsed.type === 'assign') out.push({ id: 'cmd-assign', group: 'Command', primary: `Assign ${parsed.taskKey} to ${parsed.assignee}`, run: () => assignCmd(parsed.taskKey, parsed.assignee) });
      else if (parsed.type === 'move') out.push({ id: 'cmd-move', group: 'Command', primary: `Move ${parsed.taskKey} to ${parsed.status}`, run: () => moveCmd(parsed.taskKey, parsed.status) });
    }

    // 1.23.6: what the words were read as, and how many items that finds — first, so Enter opens it.
    const read = searchEnabled ? q.data?.understood : undefined;
    if (read && read.chips.length && !out.some((it) => it.group === 'Command')) {
      out.push({
        id: 'understood', group: 'Search with filters',
        primary: <span dir="auto">{[...read.chips.map((c) => c.label), ...(read.words ? [`“${read.words}”`] : [])].join(' · ')}</span>,
        count: read.capped ? '1000+' : String(read.total),
        run: () => { navigate(`/search?${everythingAddress({ q: debounced })}`); reset(); },
      });
    }

    for (const nav of matchNavCommands(raw, isAdmin, canLead).filter((c) => settingsOk(c.to)).slice(0, raw ? 6 : 5)) {
      out.push({ id: `nav-${nav.id}`, group: 'Go to', primary: nav.label, run: () => { navigate(nav.to); reset(); } });
    }

    const r = colleaguesOnly(q.data, Array.isArray(directoryQ.data) ? directoryQ.data : []);
    if (searchEnabled && r) {
      for (const t of r.tasks.slice(0, 5)) out.push({ id: `task-${t.id}`, group: 'Tasks', primary: <Highlighted text={t.title} ranges={t.titleRanges} />, taskKey: { value: t.key, ...(t.formerKeys ? { former: t.formerKeys } : {}) }, secondary: whereMatched(t), ...(t.archived ? { archived: true } : {}), run: () => openTask(t.id) });
      const looks = Array.isArray(projectsQ.data) ? projectsQ.data : [];
      for (const p of r.projects.slice(0, 5)) {
        const look = looks.find((x) => x.id === p.id);
        out.push({
          id: `proj-${p.id}`, group: 'Projects', primary: p.name, hint: p.code,
          icon: <ProjectAvatar project={{ name: p.name, color: look?.color, icon: look?.icon, imageUrl: look?.imageUrl }} size="sm" />,
          run: () => { navigate(`/projects/${p.id}`); reset(); },
        });
      }
      for (const u of r.users.slice(0, 5)) out.push({ id: `user-${u.id}`, group: 'People', primary: [u.firstName, u.lastName].filter(Boolean).join(' ') || u.username, run: () => { navigate(personPath(u.id)); reset(); } });
      for (const m of (r.meetings ?? []).slice(0, 6)) out.push({ id: `meeting-${m.id}`, group: 'Meetings', primary: m.title, secondary: m.snippet, run: () => { navigate(`/meetings/${m.id}`); reset(); } });
      // 1.23: the best few notes, minutes, files and inspections (search everything).
      for (const h of (r.more ?? []).slice(0, 5)) {
        const m = h.matches[0];
        out.push({
          id: `more-${h.kind}-${h.id}`, group: 'Notes, minutes and files', icon: <KindIcon kind={h.kind} size="sm" />,
          primary: <><span className="sr-only">{KIND_META[h.kind].label}: </span><Highlighted text={h.title} ranges={h.titleRanges} /></>,
          secondary: m ? <><span className="font-medium text-ink-2">{KIND_META[h.kind].label} · {m.label}: </span><Highlighted text={m.snippet} ranges={m.ranges} /></> : KIND_META[h.kind].label,
          run: () => openHit(h),
        });
      }
    }
    // Every match of every kind, with filters, on the Search results page (and the AI's answer, when AI is on).
    if (searchEnabled) {
      out.push({ id: 'see-all', group: 'Search everything', primary: aiReady ? 'See all results and ask AI' : 'See all results', run: () => { navigate(`/search?${everythingAddress({ q: debounced, ...(aiReady ? { ai: true } : {}) })}`); reset(); } });
    }
    // Last, so Enter still opens the first result: ask MICO AI what was typed (a new chat with it).
    if (raw.length >= 2 && (!parsed || loose === null)) {
      out.push({ id: 'ask-mico-ai', group: 'MICO AI', primary: <>Ask MICO AI: “<span dir="auto">{raw}</span>”</>, run: () => { navigate('/mico-ai', { state: { ask: raw } }); reset(); } });
    }
    return out;
  }, [raw, isAdmin, settingsAdmin, canLead, myId, q.data, lookupQ.data, searchEnabled, projectsQ.data, aiReady, debounced, savedQ.all, savedQ.pinned, savedCounts.data]);

  useEffect(() => { setActive(0); }, [items.length]);

  // Arrowing through a long list: scroll it so the highlighted row stays in view (it used to run
  // off the bottom, and Enter then opened a row nobody could see).
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const list = listRef.current;
    const row = list?.querySelector('[data-active="true"]');
    if (!list || !row) return;
    const view = list.getBoundingClientRect();
    const at = row.getBoundingClientRect();
    if (at.bottom > view.bottom) list.scrollTop += at.bottom - view.bottom;
    else if (at.top < view.top) list.scrollTop -= view.top - at.top;
  }, [active]);

  // The list closes a moment after the box loses focus (so a click on a result still lands).
  // Focusing the box again cancels that — otherwise a quick Escape + Ctrl K left it closed.
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelClose = () => { if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null; } };
  useEffect(() => cancelClose, []);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(items.length - 1, i + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(0, i - 1)); }
    else if (e.key === 'Enter') { const it = items[active]; if (it) { e.preventDefault(); void it.run(); } }
    else if (e.key === 'Escape') { reset(); }
  };

  const showPanel = open && (items.length > 0 || (searchEnabled && q.isLoading) || (searchEnabled && !q.isLoading && items.length === 0) || status !== null);
  // The search found nothing (the menu may still offer pages and "Ask MICO AI"): say so first, so
  // those offers are not read as results. With little in the system this is a common answer.
  const found = q.data;
  // (Not for a typed command — "go to calendar" is an instruction, not a search.)
  const nothingFound =
    searchEnabled && q.isSuccess && !!found && !items.some((it) => it.group === 'Command') &&
    found.tasks.length === 0 && found.projects.length === 0 && found.users.length === 0 && (found.meetings ?? []).length === 0 && (found.more ?? []).length === 0 &&
    // 1.23.6: the words read as filters find something (the first row says how many).
    !(found.understood?.chips.length && found.understood.total > 0);
  // 1.23.1: the server couldn't search the tasks this time; the rest is what it found (one quiet line says so).
  const tasksDown = searchEnabled && q.isSuccess && !!found?.tasksUnavailable;
  let idx = -1; // running index across groups for keyboard highlight

  return (
    <div className="relative w-full min-w-[5.5rem] max-w-full sm:w-72">
      <div className="relative">
        <svg viewBox="0 0 24 24" width="15" height="15" className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
        <input
          ref={inputRef}
          type="search"
          role="searchbox"
          aria-label="Search"
          aria-keyshortcuts={ariaKeyshortcuts('search', platform)}
          dir="auto"
          placeholder={roomy ? 'Search or type a command…' : 'Search…'}
          value={term}
          onChange={(e) => { setTerm(e.target.value); setStatus(null); }}
          onFocus={() => { cancelClose(); setOpen(true); }}
          onBlur={() => { cancelClose(); closeTimer.current = setTimeout(() => setOpen(false), 160); }}
          onKeyDown={onKeyDown}
          className="w-full rounded-lg border border-line bg-ground py-1.5 pl-8 pr-3 text-sm text-ink outline-none transition-colors focus:border-brand focus:ring-2 focus:ring-brand/20 sm:pr-14 [@media(pointer:coarse)]:!min-h-11"
        />
        <kbd className="pointer-events-none absolute right-2 top-1/2 hidden -translate-y-1/2 rounded border border-line bg-surface px-1.5 py-0.5 text-[10px] font-medium text-ink-3 sm:block">{shortcutLabel('search', platform)}</kbd>
      </div>

      {showPanel ? (
        <div className="fixed inset-x-2 top-14 z-40 overflow-hidden rounded-xl border border-line bg-surface shadow-lg sm:absolute sm:inset-x-auto sm:left-0 sm:top-auto sm:mt-1 sm:w-96">
          {status ? (
            <p className={`border-b border-line px-3 py-2 text-sm ${busy ? 'text-ink-2' : status.includes('✓') ? 'text-success' : 'text-danger'}`}>
              {busy ? <span className="mr-1.5 inline-block h-3 w-3 animate-spin rounded-full border-2 border-brand/30 border-t-brand align-middle" /> : null}
              {status}
            </p>
          ) : null}

          {tasksDown ? <TasksUnavailable onRetry={() => void q.refetch()} className={`px-3 py-2 ${items.length ? 'border-b border-line' : ''}`} /> : null}
          {items.length === 0 && searchEnabled && q.isLoading ? (
            <p className="px-3 py-3 text-sm text-ink-2">Searching…</p>
          ) : items.length === 0 && searchEnabled ? (
            tasksDown ? null : <p className="px-3 py-3 text-sm text-ink-2">No matches for “{debounced}”.</p>
          ) : (
            <>
            {nothingFound ? (
              <p className="border-b border-line px-3 py-2 text-sm text-ink-2">
                Nothing matches “<span dir="auto">{debounced}</span>” in {tasksDown ? 'projects' : 'tasks, projects'}, people, meetings or files.
              </p>
            ) : null}
            <div ref={listRef} className="max-h-96 overflow-y-auto py-1">
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
                        data-active={i === active}
                        onMouseDown={(e) => e.preventDefault()}
                        // A *moving* mouse chooses a row. `mouseenter` also fires when the list simply
                        // appears under a pointer at rest — Enter then opened that row, not the first.
                        onMouseMove={() => { if (i !== active) setActive(i); }}
                        onClick={() => void it.run()}
                        className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors [@media(pointer:coarse)]:!min-h-11 ${i === active ? 'bg-brand/10 text-brand' : 'text-ink hover:bg-ground'}`}
                      >
                        {it.icon}
                        {/* A task's number is the chip, with the one it had before a move ("OPS-17 (was RIG-4)"). */}
                        {it.taskKey ? <FoundTaskKey value={it.taskKey.value} former={it.taskKey.former} /> : null}
                        {it.hint ? <span className="font-mono text-xs text-ink-2">{it.hint}</span> : null}
                        <span className="min-w-0 flex-1">
                          <span className="flex min-w-0 items-center gap-1.5">
                            <span dir="auto" className="block min-w-0 truncate text-start">{it.primary}</span>
                            {it.archived ? <ArchivedBadge /> : null}
                          </span>
                          {it.secondary ? <span dir="auto" className="block text-start text-xs text-ink-3 line-clamp-2 [overflow-wrap:anywhere]">{it.secondary}</span> : null}
                        </span>
                        {it.count !== undefined ? (
                          <span className="flex-none rounded-full bg-ground px-2 py-0.5 text-xs font-semibold text-ink-2" data-count>
                            <span aria-hidden="true">→ </span>
                            {it.count}
                            <span className="sr-only"> {it.count === '1' ? 'result' : 'results'}</span>
                          </span>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
            </>
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

/** The results without the people the directory marks as no colleague of mine (an older server marks nobody). */
function colleaguesOnly(found: SearchResults | undefined, directory: readonly { id: string; colleague?: boolean }[]): SearchResults | undefined {
  if (!found) return found;
  const strangers = new Set(directory.filter((d) => d.colleague === false).map((d) => d.id));
  return strangers.size ? { ...found, users: found.users.filter((u) => !strangers.has(u.id)) } : found;
}
