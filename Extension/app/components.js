import { el } from './dom.js';
import { isDone } from '../src/summary.js';
import { isRecurring } from '../src/recurrence.js';
import { dueDayKey, formatDayKey, isOverdue } from '../src/due-date.js';
import { DEFAULT_TIME_ZONE } from '../src/config.js';
import { messageFor } from '../src/errors.js';
import { projectLook, PROJECT_ICON_PATHS, projectStatusLabel } from '../src/project-identity.js';
import { attachmentUrl } from '../src/file-kind.js';

export { isDone };

const SVG = 'http://www.w3.org/2000/svg';

/** An outline icon from 24×24 paths (decorative). */
export function svgIcon(paths, size = 18, strokeWidth = 1.9) {
  const svg = document.createElementNS(SVG, 'svg');
  for (const [k, v] of Object.entries({ viewBox: '0 0 24 24', width: size, height: size, fill: 'none', stroke: 'currentColor', 'stroke-width': strokeWidth, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', focusable: 'false' })) {
    svg.setAttribute(k, String(v));
  }
  for (const d of paths) {
    const p = document.createElementNS(SVG, 'path');
    p.setAttribute('d', d);
    svg.append(p);
  }
  return svg;
}

const AVATAR_ICON = { xs: 12, sm: 14, md: 18, lg: 22 };

/**
 * A project's picture, as on the web (components/ProjectAvatar.tsx): its uploaded image, else its
 * icon on its colour, else its initials. An image that won't load falls back to the icon or
 * initials. Decorative (the name is written beside it) unless `label` is set.
 */
export function ProjectAvatar(project, { size = 'md', apiBase = '', label = false } = {}) {
  const look = projectLook(project);
  const a11y = label ? { role: 'img', 'aria-label': project.name, title: project.name } : { 'aria-hidden': 'true' };
  const src = look.kind === 'image' ? attachmentUrl(apiBase, look.src) || (/^(https?:|data:|blob:)/.test(look.src) ? look.src : null) : null;
  if (src) {
    const img = el('img', { src, alt: '', draggable: 'false' });
    const node = el('span', { class: `pavatar ${size}`, ...a11y, dataset: { projectAvatar: 'image' } }, img);
    img.addEventListener('error', () => node.replaceWith(ProjectAvatar({ ...project, imageUrl: null }, { size, apiBase, label })));
    return node;
  }
  const fallback = look.kind === 'image' ? projectLook({ ...project, imageUrl: null }) : look;
  return el('span', {
    class: `pavatar ${size}`, ...a11y, dataset: { projectAvatar: fallback.kind },
    style: { background: fallback.color, color: fallback.fg },
  }, fallback.kind === 'icon' ? svgIcon(PROJECT_ICON_PATHS[fallback.icon], AVATAR_ICON[size] || 18) : fallback.text);
}

/** A project's status in words, coloured as on the web (Planning, Active, On hold, Completed, Archived). */
export function projectStatusPill(status) {
  return status ? el('span', { class: `pill pstatus s-${status}` }, projectStatusLabel(status)) : null;
}

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
  // data-task-id: closing the task drawer puts focus back on this row (app/dialog.js returnFocus).
  return el('button', { class: `task-row${done ? ' done' : ''}`, type: 'button', 'aria-label': label, dataset: { taskId: task.id }, onClick },
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
