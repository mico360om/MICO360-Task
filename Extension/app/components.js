import { el, fmtDate } from './dom.js';

export const CAT_LABEL = { BACKLOG: 'Backlog', TODO: 'To do', IN_PROGRESS: 'In progress', BLOCKED: 'Blocked', REVIEW: 'Review', DONE: 'Done' };
export const PRIORITY_LABEL = { LOW: 'Low', NORMAL: 'Normal', HIGH: 'High', URGENT: 'Urgent' };

export function priorityVar(p) {
  return { LOW: '--ink3', NORMAL: '--cat-review', HIGH: '--cat-progress', URGENT: '--danger' }[p] || '--ink3';
}
export function catVar(category) {
  return { BACKLOG: '--cat-backlog', TODO: '--cat-todo', IN_PROGRESS: '--cat-progress', BLOCKED: '--cat-blocked', REVIEW: '--cat-review', DONE: '--cat-done' }[category] || '--cat-todo';
}
export const isDone = (t) => t.columnCategory === 'DONE' || t.completedAt != null;

/** The reusable task row (Dashboard, My Tasks, Calendar). Voices priority for screen readers. */
export function taskRow(task, onClick) {
  const done = isDone(task);
  const due = fmtDate(task.dueDate);
  const label = [task.key, `${PRIORITY_LABEL[task.priority] || ''} priority`, task.title, due ? `due ${due}` : null, done ? 'done' : task.progress > 0 ? `${task.progress}% complete` : null].filter(Boolean).join(', ');
  return el('button', { class: `task-row${done ? ' done' : ''}`, type: 'button', 'aria-label': label, onClick },
    el('span', { class: 'prio', style: { background: `var(${priorityVar(task.priority)})` } }),
    el('span', { class: 'body' },
      el('span', { class: 'tt' }, task.title),
      el('span', { class: 'meta' },
        el('span', { class: 'k' }, task.key || ''),
        due ? el('span', {}, `· Due ${due}`) : null,
        !done && task.progress > 0 ? el('span', {}, `· ${task.progress}%`) : null,
        done ? el('span', {}, '· Done') : null,
      ),
    ),
  );
}
