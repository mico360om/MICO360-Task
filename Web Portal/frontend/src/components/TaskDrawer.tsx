import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import type { ApiTask, Priority, RecurrenceRule } from '../api/tasks';
import { PriorityBadge } from './ui/PriorityBadge';
import { Avatar } from './ui/Avatar';
import { fieldClass } from './ui/Field';
import { recurrenceSummary } from '../lib/recurrence-summary';
import { statusMeta } from '../lib/taskStatus';
import { RecurrenceEditor } from './RecurrenceEditor';

/** "3m", "2h", "5d" for recent, else a short date. Full timestamp lives in the title attribute. */
function commentTime(iso: string): string {
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

export interface DrawerChecklistItem {
  id: string;
  text: string;
  done: boolean;
}
export interface DrawerComment {
  id: string;
  body: string;
  authorName?: string;
  authorAvatar?: string | null;
  createdAt?: string;
}
export interface DrawerAttachment {
  id: string;
  filename: string;
  url: string;
  sizeBytes: number;
}
export interface DrawerTaskRef {
  id: string;
  key: string;
  title: string;
}
export interface DrawerDependencies {
  blockedBy: DrawerTaskRef[];
  blocks: DrawerTaskRef[];
}
export interface DrawerAssignee {
  id: string;
  name: string;
}
export interface DrawerStatusColumn {
  id: string;
  name: string;
  category: string;
}
export interface DrawerActivity {
  id: string;
  action: string;
  actorName: string;
  createdAt?: string;
}

export interface TaskDrawerProps {
  task: ApiTask;
  checklist: DrawerChecklistItem[];
  comments: DrawerComment[];
  onToggleChecklistItem?: (id: string, done: boolean) => void;
  onAddChecklistItem?: (text: string) => void;
  /** Ask AI to break the task into checklist steps (the container adds them + refreshes). */
  onSuggestChecklist?: () => Promise<void>;
  /** Ask AI for a recommended priority + reason for this task. */
  onSuggestPriority?: () => Promise<{ priority: Priority; reason: string }>;
  onAddComment?: (body: string) => void;
  assignees?: DrawerAssignee[];
  assignableUsers?: DrawerAssignee[];
  onAssignUser?: (userId: string) => void;
  onUnassignUser?: (userId: string) => void;
  attachments?: DrawerAttachment[];
  onUploadFile?: (file: File) => void;
  onDeleteAttachment?: (id: string) => void;
  dependencies?: DrawerDependencies;
  availableTasks?: DrawerTaskRef[];
  onAddDependency?: (dependsOnTaskId: string) => void;
  onRemoveDependency?: (dependsOnTaskId: string) => void;
  onSetRecurrence?: (rule: RecurrenceRule | null) => void;
  /** The project's columns (Kanban stages) so status can be changed by moving the task. */
  statusColumns?: DrawerStatusColumn[];
  onChangeStatus?: (columnId: string) => void;
  /** Task activity history (newest first). */
  activity?: DrawerActivity[];
  /** Save edits to the task's core fields — with `'series'` on a recurring task, apply to every occurrence. */
  onSaveEdit?: (
    patch: { title?: string; description?: string; priority?: Priority; dueDate?: string | null },
    scope?: 'series',
  ) => void;
  /** Whether an edit save is in flight — disables the Save button and shows a spinner to block double-submit. */
  savePending?: boolean;
  /** Delete the task — with `'series'` on a recurring task, delete the whole series. */
  onDelete?: (scope?: 'series') => void;
  /** Whether the current user is watching (following) this task. */
  watching?: boolean;
  /** How many people watch this task. */
  watcherCount?: number;
  /** Toggle the current user's watch on this task. */
  onToggleWatch?: () => void;
  onClose: () => void;
}

const PRIORITIES: Priority[] = ['LOW', 'NORMAL', 'HIGH', 'URGENT'];
const titleCase = (s: string) => s.charAt(0) + s.slice(1).toLowerCase();

/** API origin (without the /api/v1 prefix) — attachment files are served from the root. */
const API_ORIGIN = (import.meta.env.VITE_API_URL ?? 'http://localhost:4000/api/v1').replace(/\/api\/v1\/?$/, '');

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const ACTION_LABEL: Record<string, string> = {
  'task.created': 'created this task',
  'task.updated': 'updated this task',
  'task.moved': 'moved this task',
  'task.completed': 'completed this task',
  'task.reopened': 'reopened this task',
  'assignee.added': 'assigned a teammate',
  'assignee.removed': 'removed an assignee',
  'comment.added': 'left a comment',
  'attachment.added': 'added an attachment',
  'checklist.added': 'added a checklist item',
};
const actionLabel = (a: string) => ACTION_LABEL[a] ?? (a || '').toLowerCase().replace(/[._]/g, ' ');

/** Consistent section heading used across the drawer. */
function SectionHead({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-2 flex items-center gap-3">
      <h3 className="eyebrow">{children}</h3>
      {right ? <div className="ml-auto">{right}</div> : null}
    </div>
  );
}

/** Small "AI" sparkle mark used on the AI-assist buttons. */
function Sparkle() {
  return (
    <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor" aria-hidden="true">
      <path d="M12 2l1.6 4.9L18.5 8.5 13.6 10 12 15l-1.6-5L5.5 8.5 10.4 6.9 12 2zM18.5 14l.8 2.4 2.4.8-2.4.8-.8 2.4-.8-2.4-2.4-.8 2.4-.8.8-2.4z" />
    </svg>
  );
}

/** A subtle "✨ …" AI-assist button with a busy state. */
function AiButton({ label, busy, onClick, disabled }: { label: string; busy: boolean; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy || disabled}
      className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1 text-xs font-medium text-brand transition-colors hover:border-brand disabled:opacity-50"
    >
      {busy ? <span className="h-3 w-3 animate-spin rounded-full border-2 border-brand/30 border-t-brand" aria-hidden /> : <Sparkle />}
      {busy ? 'Thinking…' : label}
    </button>
  );
}

function StatusPill({ category }: { category?: string | null }) {
  const m = statusMeta(category);
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md bg-ground px-2 py-0.5 text-xs font-semibold text-ink-2">
      <span className="h-2 w-2 rounded-full" style={{ background: m.color }} aria-hidden />
      {m.label}
    </span>
  );
}

export function TaskDrawer({
  task,
  checklist,
  comments,
  onToggleChecklistItem,
  onAddChecklistItem,
  onSuggestChecklist,
  onSuggestPriority,
  onAddComment,
  assignees,
  assignableUsers = [],
  onAssignUser,
  onUnassignUser,
  attachments = [],
  onUploadFile,
  onDeleteAttachment,
  dependencies,
  availableTasks = [],
  onAddDependency,
  onRemoveDependency,
  onSetRecurrence,
  statusColumns = [],
  onChangeStatus,
  activity = [],
  onSaveEdit,
  savePending = false,
  onDelete,
  watching,
  watcherCount,
  onToggleWatch,
  onClose,
}: TaskDrawerProps) {
  const done = checklist.filter((c) => c.done).length;
  const pct = checklist.length ? Math.round((done / checklist.length) * 100) : 0;
  // The drawer is the app's one large modal overlay — Escape must close it like every other dialog.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [blockerToAdd, setBlockerToAdd] = useState('');
  const [newItem, setNewItem] = useState('');
  const [newComment, setNewComment] = useState('');
  const [userToAssign, setUserToAssign] = useState('');
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(task.title);
  const [editPriority, setEditPriority] = useState<Priority>(task.priority);
  const [editDesc, setEditDesc] = useState(task.description ?? '');
  const [editDue, setEditDue] = useState(task.dueDate ? task.dueDate.slice(0, 10) : '');
  const [editScope, setEditScope] = useState<'one' | 'series'>('one');
  // AI helpers — a shared busy flag keyed by which action is running, plus a scoped error + priority reason.
  const [aiBusy, setAiBusy] = useState<null | 'checklist' | 'priority'>(null);
  const [aiError, setAiError] = useState<{ scope: 'checklist' | 'priority'; message: string } | null>(null);
  const [priorityHint, setPriorityHint] = useState<string | null>(null);

  async function runSuggestChecklist() {
    if (!onSuggestChecklist || aiBusy) return;
    setAiBusy('checklist');
    setAiError(null);
    try {
      await onSuggestChecklist();
    } catch (err) {
      setAiError({ scope: 'checklist', message: err instanceof Error ? err.message : 'AI suggestion failed.' });
    } finally {
      setAiBusy(null);
    }
  }

  async function runSuggestPriority() {
    if (!onSuggestPriority || aiBusy) return;
    setAiBusy('priority');
    setAiError(null);
    setPriorityHint(null);
    try {
      const s = await onSuggestPriority();
      setEditPriority(s.priority);
      setPriorityHint(s.reason);
    } catch (err) {
      setAiError({ scope: 'priority', message: err instanceof Error ? err.message : 'AI suggestion failed.' });
    } finally {
      setAiBusy(null);
    }
  }

  function startEdit() {
    setEditTitle(task.title);
    setEditPriority(task.priority);
    setEditDesc(task.description ?? '');
    setEditDue(task.dueDate ? task.dueDate.slice(0, 10) : '');
    setEditScope('one');
    setEditing(true);
  }
  function handleSaveEdit(e: FormEvent) {
    e.preventDefault();
    const title = editTitle.trim();
    if (!title || savePending) return;
    onSaveEdit?.(
      { title, priority: editPriority, description: editDesc, dueDate: editDue || null },
      task.recurrenceRule && editScope === 'series' ? 'series' : undefined,
    );
    // Keep the form open (with the Save button busy) until the save resolves; the effect below
    // closes it once savePending falls back to false, so the spinner is actually seen.
  }
  // Close the edit form when an in-flight save finishes (success or failure).
  const wasSaving = useRef(false);
  useEffect(() => {
    if (wasSaving.current && !savePending) setEditing(false);
    wasSaving.current = savePending;
  }, [savePending]);

  const alreadyBlocking = new Set((dependencies?.blockedBy ?? []).map((d) => d.id));
  const addable = availableTasks.filter((t) => t.id !== task.id && !alreadyBlocking.has(t.id));
  const assignedIds = new Set((assignees ?? []).map((a) => a.id));
  const assignable = assignableUsers.filter((u) => !assignedIds.has(u.id));

  const dueOverdue =
    !!task.dueDate && new Date(task.dueDate).getTime() < Date.now() && (task.columnCategory ?? 'TODO') !== 'DONE' && !task.completedAt;
  const dueText = task.dueDate ? new Date(task.dueDate).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) : 'No due date';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Task ${task.key}`}
      className="flex h-full w-full max-w-md flex-col border-l border-line bg-surface shadow-lg sm:max-w-lg lg:max-w-3xl xl:max-w-4xl"
    >
      {/* Header — key, status, title and the always-visible primary actions */}
      <header className="flex-none border-b border-line px-5 py-4 sm:px-6">
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs text-ink-2">{task.key}</span>
          <StatusPill category={task.columnCategory} />
          <PriorityBadge priority={task.priority} />
          <div className="ml-auto flex items-center gap-1">
            {onToggleWatch ? (
              <button
                onClick={onToggleWatch}
                aria-pressed={!!watching}
                title={watching ? 'Stop watching this task' : 'Watch this task for updates'}
                className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors ${watching ? 'border-brand/40 bg-brand/10 text-brand' : 'border-line text-ink-2 hover:border-brand hover:text-brand'}`}
              >
                <svg viewBox="0 0 24 24" width="13" height="13" fill={watching ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>
                {watching ? 'Watching' : 'Watch'}
                {watcherCount ? <span className="tabular-nums">{watcherCount}</span> : null}
              </button>
            ) : null}
            {onSaveEdit && !editing ? (
              <button
                onClick={startEdit}
                className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1 text-xs font-medium text-ink-2 transition-colors hover:border-brand hover:text-brand"
              >
                <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" /></svg>
                Edit
              </button>
            ) : null}
            <button onClick={onClose} aria-label="Close" className="grid h-8 w-8 place-items-center rounded-lg text-ink-2 transition-colors hover:bg-ground hover:text-ink">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg>
            </button>
          </div>
        </div>
        <h2 className="mt-2 font-display text-xl font-bold leading-snug text-ink">{task.title}</h2>
        {task.recurrenceRule || (task.carryForwardLog && task.carryForwardLog.length > 0) ? (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {task.recurrenceRule ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-brand/10 px-2 py-0.5 text-xs font-medium text-brand">🔁 {recurrenceSummary(task.recurrenceRule)}</span>
            ) : null}
            {task.carryForwardLog && task.carryForwardLog.length > 0 ? (
              <span
                className="inline-flex items-center gap-1 rounded-full bg-ground px-2 py-0.5 text-xs font-medium text-ink-2"
                title={task.carryForwardLog.map((e) => `${e.from} → ${e.to}`).join('\n')}
              >
                ↪ Carried forward {task.carryForwardLog.length}× · since {task.carryForwardLog[0]!.from}
              </span>
            ) : null}
          </div>
        ) : null}
      </header>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto px-5 py-5 sm:px-6">
        {editing ? (
          <form onSubmit={handleSaveEdit} className="mb-6 flex flex-col gap-3 rounded-2xl border border-line bg-ground/40 p-4">
            <label className="flex flex-col gap-1">
              <span className="eyebrow">Title</span>
              <input aria-label="Title" value={editTitle} onChange={(e) => setEditTitle(e.target.value)} className={fieldClass(false)} />
            </label>
            <div className="flex gap-3">
              <div className="flex flex-1 flex-col gap-1">
                <div className="flex items-center gap-2">
                  <span className="eyebrow">Priority</span>
                  {onSuggestPriority ? <div className="ml-auto"><AiButton label="Suggest priority" busy={aiBusy === 'priority'} onClick={runSuggestPriority} disabled={aiBusy !== null} /></div> : null}
                </div>
                <select aria-label="Priority" value={editPriority} onChange={(e) => setEditPriority(e.target.value as Priority)} className={fieldClass(false)}>
                  {PRIORITIES.map((p) => <option key={p} value={p}>{titleCase(p)}</option>)}
                </select>
              </div>
              <label className="flex flex-1 flex-col gap-1">
                <span className="eyebrow">Due date</span>
                <input type="date" aria-label="Due date" value={editDue} onChange={(e) => setEditDue(e.target.value)} className={fieldClass(false)} />
              </label>
            </div>
            {priorityHint ? <p className="-mt-1 flex items-start gap-1.5 text-xs text-ink-2"><span className="mt-px text-brand"><Sparkle /></span><span>{priorityHint}</span></p> : null}
            {aiError?.scope === 'priority' ? <p className="-mt-1 rounded-lg bg-danger/10 px-2.5 py-1.5 text-xs text-danger">{aiError.message}</p> : null}
            <label className="flex flex-col gap-1">
              <span className="eyebrow">Description</span>
              <textarea aria-label="Description" value={editDesc} onChange={(e) => setEditDesc(e.target.value)} rows={3} className={fieldClass(false)} />
            </label>
            {task.recurrenceRule ? (
              <fieldset className="flex flex-col gap-1">
                <legend className="eyebrow">Apply changes to</legend>
                <label className="flex items-center gap-2 text-sm text-ink">
                  <input type="radio" name="edit-scope" checked={editScope === 'one'} onChange={() => setEditScope('one')} className="accent-brand" /> This task
                </label>
                <label className="flex items-center gap-2 text-sm text-ink">
                  <input type="radio" name="edit-scope" checked={editScope === 'series'} onChange={() => setEditScope('series')} className="accent-brand" /> Entire series
                </label>
              </fieldset>
            ) : null}
            <div className="flex gap-2">
              <button type="submit" disabled={editTitle.trim() === '' || savePending} className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3.5 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-brand-2 disabled:opacity-50">
                {savePending ? <span className="h-3 w-3 animate-spin rounded-full border-2 border-white/40 border-t-white" aria-hidden /> : null}
                {savePending ? 'Saving…' : 'Save'}
              </button>
              <button type="button" onClick={() => setEditing(false)} disabled={savePending} className="rounded-lg px-3 py-1.5 text-sm font-medium text-ink-2 transition-colors hover:bg-ground disabled:opacity-50">Cancel</button>
            </div>
          </form>
        ) : (
          <section className="mb-6">
            <SectionHead>Description</SectionHead>
            {task.description ? <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink-2">{task.description}</p> : <p className="text-sm italic text-ink-3">No description.</p>}
          </section>
        )}

        <div className="grid gap-x-6 gap-y-6 lg:grid-cols-[minmax(0,1fr)_300px]">
          {/* Main: people + content + discussion */}
          <div className="flex min-w-0 flex-col gap-6 lg:order-1">
            {assignees ? (
              <section>
                <SectionHead>Assignees</SectionHead>
                <div className="flex flex-wrap gap-1.5">
                  {assignees.length === 0 ? (
                    <span className="text-sm text-ink-2">Unassigned.</span>
                  ) : (
                    assignees.map((a) => (
                      <span key={a.id} className="inline-flex items-center gap-1.5 rounded-full bg-ground py-0.5 pl-0.5 pr-2 text-xs text-ink">
                        <Avatar name={a.name} size="sm" />
                        {a.name}
                        {onUnassignUser ? (
                          <button onClick={() => onUnassignUser(a.id)} aria-label={`Remove ${a.name}`} className="text-ink-2 transition-colors hover:text-danger">×</button>
                        ) : null}
                      </span>
                    ))
                  )}
                </div>
                {onAssignUser && assignable.length > 0 ? (
                  <div className="mt-2 flex items-center gap-2">
                    <select aria-label="Assign a teammate" value={userToAssign} onChange={(e) => setUserToAssign(e.target.value)} className={fieldClass(false, 'min-w-0 flex-1')}>
                      <option value="">Select a teammate…</option>
                      {assignable.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                    </select>
                    <button onClick={() => { if (userToAssign) { onAssignUser(userToAssign); setUserToAssign(''); } }} disabled={!userToAssign} className="rounded-lg border border-line px-2.5 py-1.5 text-xs font-medium text-brand transition-colors hover:border-brand disabled:opacity-50">Assign</button>
                  </div>
                ) : null}
              </section>
            ) : null}

            <section>
              <SectionHead right={<div className="flex items-center gap-2">{onSuggestChecklist ? <AiButton label="Suggest steps" busy={aiBusy === 'checklist'} onClick={runSuggestChecklist} disabled={aiBusy !== null} /> : null}<div className="h-1.5 w-24 overflow-hidden rounded-full bg-ground"><div className="h-full rounded-full bg-brand transition-all duration-500" style={{ width: `${pct}%` }} /></div><span className="text-xs font-semibold tabular-nums text-ink-2">{pct}%</span></div>}>Checklist</SectionHead>
              {aiError?.scope === 'checklist' ? <p className="mb-2 rounded-lg bg-danger/10 px-2.5 py-1.5 text-xs text-danger">{aiError.message}</p> : null}
              <ul className="flex flex-col gap-1">
                {checklist.length === 0 ? (
                  <li className="text-sm text-ink-2">No checklist items.</li>
                ) : (
                  checklist.map((c) =>
                    onToggleChecklistItem ? (
                      <li key={c.id} className="text-sm">
                        <label className="flex items-center gap-2">
                          <input type="checkbox" checked={c.done} aria-label={c.text} onChange={() => onToggleChecklistItem(c.id, !c.done)} className="h-4 w-4 accent-brand" />
                          <span className={c.done ? 'text-ink-2 line-through' : 'text-ink'}>{c.text}</span>
                        </label>
                      </li>
                    ) : (
                      <li key={c.id} className="flex items-center gap-2 text-sm text-ink">
                        <span aria-hidden="true">{c.done ? '☑' : '☐'}</span>
                        <span className={c.done ? 'line-through text-ink-2' : ''}>{c.text}</span>
                      </li>
                    ),
                  )
                )}
              </ul>
              {onAddChecklistItem ? (
                <form className="mt-2 flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); const text = newItem.trim(); if (text) { onAddChecklistItem(text); setNewItem(''); } }}>
                  <input value={newItem} onChange={(e) => setNewItem(e.target.value)} placeholder="Add an item…" className={fieldClass(false, 'min-w-0 flex-1')} />
                  <button type="submit" disabled={newItem.trim() === ''} className="rounded-lg border border-line px-2.5 py-1.5 text-xs font-medium text-brand transition-colors hover:border-brand disabled:opacity-50">Add item</button>
                </form>
              ) : null}
            </section>

            <section>
              <SectionHead>Comments</SectionHead>
              <div className="flex flex-col gap-2">
                {comments.length === 0 ? (
                  <p className="text-sm text-ink-2">No comments yet.</p>
                ) : (
                  comments.map((c) => (
                    <div key={c.id} className="rounded-xl border border-line bg-ground/40 p-2.5 text-sm text-ink">
                      <div className="mb-1 flex items-center gap-2">
                        <Avatar name={c.authorName ?? 'Unknown'} size="sm" src={c.authorAvatar} />
                        <span className="font-semibold text-ink">{c.authorName ?? 'Unknown'}</span>
                        {c.createdAt ? <span className="text-xs text-ink-2" title={new Date(c.createdAt).toLocaleString()}>{commentTime(c.createdAt)}</span> : null}
                      </div>
                      <div className="whitespace-pre-wrap break-words pl-8 text-ink">{c.body}</div>
                    </div>
                  ))
                )}
              </div>
              {onAddComment ? (
                <form className="mt-2 flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); const body = newComment.trim(); if (body) { onAddComment(body); setNewComment(''); } }}>
                  <textarea value={newComment} onChange={(e) => setNewComment(e.target.value)} placeholder="Write a comment… use @name to mention" rows={2} className={fieldClass(false)} />
                  <button type="submit" disabled={newComment.trim() === ''} className="self-end rounded-lg bg-brand px-3.5 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-brand-2 disabled:opacity-50">Comment</button>
                </form>
              ) : null}
            </section>

            {activity.length > 0 ? (
              <section>
                <SectionHead>Activity</SectionHead>
                <ul className="flex flex-col gap-3">
                  {activity.map((a) => (
                    <li key={a.id} className="flex gap-2.5 text-sm">
                      <Avatar name={a.actorName} size="sm" />
                      <div className="min-w-0">
                        <p className="text-ink"><span className="font-semibold">{a.actorName}</span> <span className="text-ink-2">{actionLabel(a.action)}</span></p>
                        {a.createdAt ? <p className="text-[11px] text-ink-3" title={new Date(a.createdAt).toLocaleString()}>{commentTime(a.createdAt)}</p> : null}
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </div>

          {/* Aside: properties, attachments, dependencies */}
          <aside className="flex flex-col gap-4 lg:order-2">
            <div className="flex flex-col gap-4 rounded-2xl border border-line bg-ground/50 p-4">
              <p className="text-[11px] font-bold uppercase tracking-wider text-ink-2">Properties</p>

              <div>
                <SectionHead>Status</SectionHead>
                {statusColumns.length > 0 && onChangeStatus ? (
                  <select aria-label="Status" value={task.columnId} onChange={(e) => onChangeStatus(e.target.value)} className={fieldClass(false, 'w-full')}>
                    {statusColumns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                ) : (
                  <StatusPill category={task.columnCategory} />
                )}
              </div>

              <div>
                <SectionHead>Priority</SectionHead>
                <PriorityBadge priority={task.priority} />
              </div>

              <div>
                <SectionHead>Due date</SectionHead>
                <span className={`inline-flex items-center gap-1.5 text-sm ${dueOverdue ? 'font-semibold text-danger' : 'text-ink'}`}>
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="text-ink-3"><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></svg>
                  {dueOverdue ? `Overdue · ${dueText}` : dueText}
                </span>
              </div>

              {onSetRecurrence ? (
                <div>
                  <SectionHead>Repeat</SectionHead>
                  <RecurrenceEditor value={task.recurrenceRule ?? null} onChange={onSetRecurrence} />
                </div>
              ) : null}
            </div>

            <div className="rounded-2xl border border-line bg-ground/50 p-4">
              <SectionHead>Attachments</SectionHead>
              <ul className="flex flex-col gap-1">
                {attachments.length === 0 ? (
                  <li className="text-sm text-ink-2">No attachments.</li>
                ) : (
                  attachments.map((a) => (
                    <li key={a.id} className="flex items-center gap-2 text-sm">
                      <a href={`${API_ORIGIN}${a.url}`} target="_blank" rel="noreferrer" className="truncate text-brand hover:underline">{a.filename}</a>
                      <span className="text-xs text-ink-2">{formatSize(a.sizeBytes)}</span>
                      {onDeleteAttachment ? (
                        <button onClick={() => onDeleteAttachment(a.id)} aria-label={`Remove ${a.filename}`} className="ml-auto rounded px-1 text-ink-2 transition-colors hover:bg-ground hover:text-danger">×</button>
                      ) : null}
                    </li>
                  ))
                )}
              </ul>
              {onUploadFile ? (
                <label className="mt-2 inline-flex cursor-pointer items-center gap-2 text-xs font-medium text-brand hover:underline">
                  <span>+ Attach a file</span>
                  <input type="file" className="sr-only" aria-label="Attach a file" onChange={(e) => { const file = e.target.files?.[0]; if (file) onUploadFile(file); e.target.value = ''; }} />
                </label>
              ) : null}
            </div>

            {dependencies ? (
              <div className="rounded-2xl border border-line bg-ground/50 p-4">
                <SectionHead>Dependencies</SectionHead>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-3">Blocked by</p>
                <ul className="mt-1 flex flex-col gap-1">
                  {dependencies.blockedBy.length === 0 ? (
                    <li className="text-sm text-ink-2">Nothing blocking this task.</li>
                  ) : (
                    dependencies.blockedBy.map((d) => (
                      <li key={d.id} className="flex items-center gap-2 text-sm">
                        <span className="font-mono text-xs text-ink-2">{d.key}</span>
                        <span className="truncate text-ink">{d.title}</span>
                        {onRemoveDependency ? (
                          <button onClick={() => onRemoveDependency(d.id)} aria-label={`Remove blocker ${d.key}`} className="ml-auto rounded px-1 text-ink-2 transition-colors hover:bg-ground hover:text-danger">×</button>
                        ) : null}
                      </li>
                    ))
                  )}
                </ul>
                {onAddDependency && addable.length > 0 ? (
                  <div className="mt-2 flex items-center gap-2">
                    <select aria-label="Add a blocking task" value={blockerToAdd} onChange={(e) => setBlockerToAdd(e.target.value)} className={fieldClass(false, 'min-w-0 flex-1')}>
                      <option value="">Select a task…</option>
                      {addable.map((t) => <option key={t.id} value={t.id}>{t.key} — {t.title}</option>)}
                    </select>
                    <button onClick={() => { if (blockerToAdd) { onAddDependency(blockerToAdd); setBlockerToAdd(''); } }} disabled={!blockerToAdd} className="rounded-lg border border-line px-2.5 py-1.5 text-xs font-medium text-brand transition-colors hover:border-brand disabled:opacity-50">Add blocker</button>
                  </div>
                ) : null}
                {dependencies.blocks.length > 0 ? (
                  <div className="mt-3">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-3">Blocks</p>
                    <ul className="mt-1 flex flex-col gap-1">
                      {dependencies.blocks.map((d) => (
                        <li key={d.id} className="flex items-center gap-2 text-sm">
                          <span className="font-mono text-xs text-ink-2">{d.key}</span>
                          <span className="truncate text-ink">{d.title}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            ) : null}
          </aside>
        </div>
      </div>

      {/* Footer — destructive action, intentionally low-key */}
      {onDelete ? (
        <footer className="flex-none border-t border-line px-5 py-3 sm:px-6">
          {confirmingDelete ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm text-ink-2">{task.recurrenceRule ? 'This is a recurring task — delete which?' : 'Delete this task? This can’t be undone.'}</span>
              <button onClick={() => onDelete()} className="rounded-lg bg-danger px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:brightness-95">{task.recurrenceRule ? 'This occurrence' : 'Delete'}</button>
              {task.recurrenceRule ? <button onClick={() => onDelete('series')} className="rounded-lg bg-danger px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:brightness-95">Entire series</button> : null}
              <button onClick={() => setConfirmingDelete(false)} className="rounded-lg px-3 py-1.5 text-xs font-medium text-ink-2 transition-colors hover:bg-ground">Cancel</button>
            </div>
          ) : (
            <button onClick={() => setConfirmingDelete(true)} className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium text-ink-3 transition-colors hover:bg-danger-soft hover:text-danger">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M6 6v14a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V6M10 11v6M14 11v6" /></svg>
              Delete task
            </button>
          )}
        </footer>
      ) : null}
    </div>
  );
}
