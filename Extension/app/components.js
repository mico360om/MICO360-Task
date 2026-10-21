import { el } from './dom.js';
import { isDone } from '../src/summary.js';
import { isRecurring } from '../src/recurrence.js';
import { dueDayKey, formatDayKey, isOverdue } from '../src/due-date.js';
import { DEFAULT_TIME_ZONE } from '../src/config.js';
import { messageFor } from '../src/errors.js';

export { isDone };

export const CAT_LABEL = { BACKLOG: 'Backlog', TODO: 'To do', IN_PROGRESS: 'In progress', BLOCKED: 'Blocked', REVIEW: 'Review', DONE: 'Done' };
export const PRIORITY_LABEL = { LOW: 'Low', NORMAL: 'Normal', HIGH: 'High', URGENT: 'Urgent' };

export function priorityVar(p) {
  return { LOW: '--ink3', NORMAL: '--cat-review', HIGH: '--cat-progress', URGENT: '--danger' }[p] || '--ink3';
}
export function catVar(category) {
  return { BACKLOG: '--cat-backlog', TODO: '--cat-todo', IN_PROGRESS: '--cat-progress', BLOCKED: '--cat-blocked', REVIEW: '--cat-review', DONE: '--cat-done' }[category] || '--cat-todo';
}

/**
 * User-facing text for a failed call (H2): the server's own message for a 4xx answer ("This task was
 * changed by someone else…", a date rule, no permission), a storage failure explains itself, anything
 * else (offline, 5xx) the screen's `fallback`.
 */
export function writeErrorMessage(e, fallback) {
  return messageFor(e, fallback);
}

/** Shown when a change is kept on this device until the connection is back (H3). */
export const SAVED_ON_DEVICE = 'Saved on this device — it will sync when the connection is back.';

/** How to update an extension installed from a zip (Chrome never updates those itself). */
export const UPDATE_STEPS = 'To update, get the new extension file from your administrator, unzip it over this extension’s folder, then open chrome://extensions and press Reload on MICO360 Tasks. You stay signed in.';

/**
 * The shell's notice that the server runs a newer version than this zip-installed extension (see
 * src/version.js), or null when there is none. "How to update" opens Settings → About.
 */
export function updateNotice({ status, aboutHref, onDismiss }) {
  if (!status || !status.updateAvailable) return null;
  return el('div', { class: 'updatebar', role: 'status' },
    el('span', { class: 'msg' }, `A newer version of MICO360 Tasks, ${status.server}, is available (this extension is ${status.extension}).`),
    el('a', { href: '#/settings' }, 'How to update'),
    el('a', { href: aboutHref, target: '_blank', rel: 'noopener' }, 'What’s new ↗'),
    el('button', { class: 'btn sm ghost', type: 'button', 'aria-label': 'Dismiss the update notice', onClick: onDismiss }, 'Dismiss'),
  );
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
