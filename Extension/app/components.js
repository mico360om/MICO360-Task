import { el } from './dom.js';
import { isDone } from '../src/summary.js';
import { isRecurring } from '../src/recurrence.js';
import { dueDayKey, formatDayKey, isOverdue } from '../src/due-date.js';
import { DEFAULT_TIME_ZONE } from '../src/config.js';

export { isDone };

export const CAT_LABEL = { BACKLOG: 'Backlog', TODO: 'To do', IN_PROGRESS: 'In progress', BLOCKED: 'Blocked', REVIEW: 'Review', DONE: 'Done' };
export const PRIORITY_LABEL = { LOW: 'Low', NORMAL: 'Normal', HIGH: 'High', URGENT: 'Urgent' };

export function priorityVar(p) {
  return { LOW: '--ink3', NORMAL: '--cat-review', HIGH: '--cat-progress', URGENT: '--danger' }[p] || '--ink3';
}
export function catVar(category) {
  return { BACKLOG: '--cat-backlog', TODO: '--cat-todo', IN_PROGRESS: '--cat-progress', BLOCKED: '--cat-blocked', REVIEW: '--cat-review', DONE: '--cat-done' }[category] || '--cat-todo';
}

/** User-facing text for a failed write (ApiError → `fallback`; storage failures explain themselves). */
export function writeErrorMessage(e, fallback) {
  return (e && e.userMessage) || fallback;
}

/**
 * The reusable task row (Dashboard, My Tasks, Calendar). Voices priority for screen readers. The due
 * date is shown as its calendar day (never shifted by the viewer's zone) and "Overdue" follows the
 * company-time-zone rule; a finished task is never overdue (XP-03).
 */
export function taskRow(task, onClick, { timeZone = DEFAULT_TIME_ZONE } = {}) {
  const done = isDone(task);
  const dueKey = dueDayKey(task.dueDate, timeZone);
  const due = dueKey ? formatDayKey(dueKey, { weekday: false }) : '';
  const overdue = !done && isOverdue(task.dueDate, timeZone);
  const label = [task.key, `${PRIORITY_LABEL[task.priority] || ''} priority`, task.title, due ? `due ${due}` : null, overdue ? 'overdue' : null, isRecurring(task) ? 'repeats' : null, done ? 'done' : task.progress > 0 ? `${task.progress}% complete` : null].filter(Boolean).join(', ');
  return el('button', { class: `task-row${done ? ' done' : ''}`, type: 'button', 'aria-label': label, onClick },
    el('span', { class: 'prio', style: { background: `var(${priorityVar(task.priority)})` } }),
    el('span', { class: 'body' },
      el('span', { class: 'tt' }, task.title),
      el('span', { class: 'meta' },
        el('span', { class: 'k' }, task.key || ''),
        due ? el('span', { class: overdue ? 'overdue' : null }, `· Due ${due}`) : null,
        !done && task.progress > 0 ? el('span', {}, `· ${task.progress}%`) : null,
        done ? el('span', {}, '· Done') : null,
        isRecurring(task) ? el('span', { title: 'Repeats' }, '· 🔁 Repeats') : null,
      ),
    ),
  );
}
