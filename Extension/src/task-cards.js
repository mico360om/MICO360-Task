/**
 * What a board card and a My Tasks row show, as on the web: a card's due day in company time and
 * "Overdue" once it has passed (never for finished work), its subtask/comment/file counts, its
 * people, milestone, blocked column and repeat (Web Portal/frontend/src/components/TaskCard.tsx,
 * lib/board.ts composeBoard); the project's Done column that "Mark done" moves a task to (lib/board.ts
 * targetColumnFor — a column of the DONE status completes the task on the server); and the web's
 * My Tasks sorts and project filter. src/task-cards.test.js runs the web's copies over the same tasks.
 * Pure (no DOM).
 */
import { DEFAULT_TIME_ZONE } from './config.js';
import { dueDayKey, isOverdue } from './due-date.js';
import { isDone } from './summary.js';
import { isRecurring } from './recurrence.js';

const PRIORITY_WORD = { LOW: 'Low', NORMAL: 'Normal', HIGH: 'High', URGENT: 'Urgent' };
const P_RANK = { URGENT: 0, HIGH: 1, NORMAL: 2, LOW: 3 };

/** A due date as its calendar day, e.g. "Oct 20, 2026" (the web's formatDueDay). */
export function formatDueDay(due, timeZone = DEFAULT_TIME_ZONE) {
  const key = dueDayKey(due, timeZone);
  if (!key) return '';
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${key}T12:00:00.000Z`));
}

/** Two letters for a person's avatar: the first letters of their first two names (the web's Avatar). */
export function personInitials(name) {
  return String(name ?? '').trim().split(/\s+/).map((part) => part[0] ?? '').slice(0, 2).join('').toUpperCase();
}

/**
 * The facts a card shows. `task.columnCategory` is its column's status (the board sets it).
 * Returns { done, overdue, due, dueText, counts, people: { shown, extra, single }, milestone,
 * blocked, recurring, progress }.
 */
export function cardFacts(task, { timeZone = DEFAULT_TIME_ZONE, now = new Date() } = {}) {
  const done = isDone(task);
  const due = formatDueDay(task.dueDate, timeZone);
  const overdue = !done && !!due && isOverdue(task.dueDate, timeZone, now);
  const c = task.counts || {};
  const counts = [];
  if (c.checklistTotal > 0) counts.push({ kind: 'checklist', label: 'Subtasks done', value: `${c.checklistDone || 0}/${c.checklistTotal}` });
  if (c.comments > 0) counts.push({ kind: 'comments', label: 'Comments', value: String(c.comments) });
  if (c.attachments > 0) counts.push({ kind: 'attachments', label: 'Attachments', value: String(c.attachments) });
  const assignees = (Array.isArray(task.assignees) ? task.assignees : []).filter((a) => a && a.id);
  const shown = assignees.slice(0, 3).map((a) => ({ id: a.id, name: a.name || '', initials: personInitials(a.name) }));
  return {
    done,
    overdue,
    due,
    dueText: due ? (overdue ? `Overdue · ${due}` : due) : '',
    counts,
    tally: { checklistDone: c.checklistDone || 0, checklistTotal: c.checklistTotal || 0, comments: c.comments || 0, attachments: c.attachments || 0 },
    people: { shown, extra: assignees.length - shown.length, single: assignees.length === 1 ? assignees[0].name || null : null, all: assignees.map((a) => a.name).filter(Boolean) },
    milestone: !!task.isMilestone,
    blocked: task.columnCategory === 'BLOCKED',
    recurring: isRecurring(task),
    progress: Math.max(0, Math.min(100, Number(task.progress) || 0)),
  };
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const andList = (names) => (names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`);

/** What a screen reader says for a card: everything the card shows, in words. */
export function cardLabel(task, facts) {
  const f = facts;
  const c = f.tally;
  return [
    task.title,
    task.key,
    PRIORITY_WORD[task.priority] ? `${PRIORITY_WORD[task.priority]} priority` : null,
    f.milestone ? 'milestone' : null,
    f.blocked ? 'blocked' : null,
    f.overdue ? 'overdue' : null,
    f.due ? `due ${f.due}` : null,
    f.recurring ? 'repeats' : null,
    c.checklistTotal > 0 ? `${c.checklistDone} of ${c.checklistTotal} subtasks done` : null,
    c.comments > 0 ? plural(c.comments, 'comment', 'comments') : null,
    c.attachments > 0 ? plural(c.attachments, 'attachment', 'attachments') : null,
    f.people.all.length ? `assigned to ${andList(f.people.all)}` : null,
  ].filter(Boolean).join(', ');
}

/**
 * The column "Mark done" moves a task to: the project's first shown column of the Done status (as
 * the web's board picks one), else a Done column that is switched off; null when it has none.
 */
export function doneColumnOf(columns) {
  const done = (Array.isArray(columns) ? columns : []).filter((c) => c && c.category === 'DONE')
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  const pick = done.find((c) => c.enabled !== false) || done[0];
  return pick ? pick.id : null;
}

/** My Tasks' sorts (the web's words). */
export const SORT_OPTIONS = [
  { value: 'due', label: 'Due date' },
  { value: 'priority', label: 'Priority' },
  { value: 'progress', label: 'Progress' },
  { value: 'title', label: 'Title (A–Z)' },
];

/** A sorted copy: by due day (no date last), priority (most urgent first), progress (most first) or title. */
export function sortTasks(tasks, sort, timeZone = DEFAULT_TIME_ZONE) {
  const rows = (Array.isArray(tasks) ? tasks : []).map((task) => ({ task, dueKey: dueDayKey(task.dueDate, timeZone) }));
  rows.sort((a, b) => {
    if (sort === 'priority') return (P_RANK[a.task.priority] ?? 9) - (P_RANK[b.task.priority] ?? 9);
    if (sort === 'progress') return (Number(b.task.progress) || 0) - (Number(a.task.progress) || 0);
    if (sort === 'title') return String(a.task.title || '').localeCompare(String(b.task.title || ''));
    if (a.dueKey && b.dueKey) return a.dueKey < b.dueKey ? -1 : a.dueKey > b.dueKey ? 1 : 0;
    if (a.dueKey) return -1;
    if (b.dueKey) return 1;
    return 0;
  });
  return rows.map((r) => r.task);
}

/** "All projects", then the projects my tasks are in, by name (one no longer listed is "Project"). */
export function projectFilterOptions(tasks, projects) {
  const byId = new Map((Array.isArray(projects) ? projects : []).map((p) => [p.id, p]));
  const ids = [...new Set((Array.isArray(tasks) ? tasks : []).map((t) => t.projectId).filter(Boolean))];
  const known = ids.filter((id) => byId.has(id)).map((id) => ({ value: id, label: byId.get(id).name || byId.get(id).code || 'Project' }))
    .sort((a, b) => a.label.localeCompare(b.label));
  const unknown = ids.filter((id) => !byId.has(id)).map((id) => ({ value: id, label: 'Project' }));
  return [{ value: '', label: 'All projects' }, ...known, ...unknown];
}
