/**
 * The task drawer's own fields: title, the badges under it (the meeting it came from, its repeat, a
 * milestone), which copies an edit applies to (a repeating task), priority, start and due dates,
 * milestone, repeat and description. Each change is shown at once and saved (or kept on this device)
 * through `d.updateTask`, which sends one edit at a time against the task's version (H1). Every
 * field is its own part, so an edit draws again only what it changed — never the box typed in next.
 */
import { el } from '../dom.js';
import { PRIORITY_LABEL } from '../components.js';
import { dueDayKey, todayKey, zonedDayKey, formatDayKey } from '../../src/due-date.js';
import { DEFAULT_TIME_ZONE } from '../../src/config.js';
import { recurrenceSummary } from '../../src/recurrence.js';
import { repeatEditor } from './repeat.js';
import { part, section } from './kit.js';

const PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'URGENT'];

/** Which parts an edit of each field draws again. */
const AFFECTS = {
  title: ['title'],
  priority: ['priority'],
  startDate: ['dates'],
  dueDate: ['dates', 'repeat'],
  isMilestone: ['dates', 'badges'],
  recurrenceRule: ['repeat', 'badges', 'scope'],
  description: ['description'],
};

/** What an "Entire series" edit changes on the other copies (the server's SERIES_FIELDS). */
const SERIES_FIELDS = new Set(['title', 'description', 'priority']);

/** A task in a repeating series: its newest copy carries the rule, earlier ones point to their series. */
export const inSeries = (task) => Boolean(task && (task.recurrenceRule || task.recurrenceParentId));

export function FieldsSection(d) {
  const zone = () => d.ctx.timeZone || DEFAULT_TIME_ZONE;
  const task = () => d.s.task;
  let scope = 'one'; // a repeating task: edits apply to this copy, or to every open copy

  const parts = {
    title: part(drawTitle),
    badges: part(drawBadges, { props: { class: 'td-badges' } }),
    scope: part(drawScope),
    priority: part(drawPriority),
    dates: part(drawDates),
    repeat: part(drawRepeat),
    description: part(drawDescription),
  };
  const node = el('div', { class: 'td-fields' }, Object.values(parts).map((p) => p.node));

  function render() {
    for (const p of Object.values(parts)) p.render();
  }

  /** Draw again what an edit (`patch`) changed. */
  function renderFor(patch) {
    const names = new Set(Object.keys(patch || {}).flatMap((k) => AFFECTS[k] || []));
    for (const name of names) parts[name].render();
  }

  /** Save an edit of one field — for the whole series when that is chosen and the field is shared. */
  function save(patch) {
    const series = scope === 'series' && inSeries(task()) && Object.keys(patch).every((k) => SERIES_FIELDS.has(k));
    return d.updateTask(patch, series ? { scope: 'series' } : undefined);
  }

  function drawTitle() {
    const t = task();
    const input = el('input', { class: 'field td-title', value: t.title || '', 'aria-label': 'Task title' });
    input.addEventListener('blur', () => {
      const v = input.value.trim();
      if (v && v !== task().title) save({ title: v });
    });
    return [el('label', { class: 'lbl' }, t.key || 'Task'), input];
  }

  /** The meeting it came from, its repeat and a milestone, under the title (as on the web). */
  function drawBadges() {
    const t = task();
    const out = [];
    if (t.meeting) out.push(meetingBadge(t.meeting));
    if (t.recurrenceRule) out.push(el('span', { class: 'td-badge brand' }, `🔁 ${recurrenceSummary(t.recurrenceRule)}`));
    else if (t.recurrenceParentId) out.push(el('span', { class: 'td-badge' }, '🔁 Part of a repeating series'));
    if (t.isMilestone) out.push(el('span', { class: 'td-badge brand' }, el('span', { 'aria-hidden': 'true' }, '◆ '), 'Milestone'));
    return out;
  }

  /** "From meeting: …" opens it on the website; someone not part of it only learns there is one. */
  function meetingBadge(m) {
    const base = String(d.ctx.appBase || '').replace(/\/+$/, '');
    if (!m.canView || !m.title || !m.id || !base) {
      return el('span', { class: 'td-badge' }, el('span', { 'aria-hidden': 'true' }, '📅 '), 'From a meeting you’re not part of');
    }
    const start = m.startAt ? new Date(m.startAt) : null;
    const day = start && !Number.isNaN(start.getTime()) ? formatDayKey(zonedDayKey(start, zone())) : '';
    return el('a', {
      class: 'td-badge brand link', href: `${base}/meetings/${encodeURIComponent(m.id)}`, target: '_blank', rel: 'noopener noreferrer',
      title: 'Open the meeting this task was created from (on the website)',
    }, el('span', { 'aria-hidden': 'true' }, '📅 '), `From meeting: ${m.title}${day ? ` · ${day}` : ''} ↗`);
  }

  /** A repeating task: "Edits apply to: This task / Entire series" (title, description, priority). */
  function drawScope() {
    if (!inSeries(task())) return null;
    const choice = (value, label) => {
      const input = el('input', { type: 'radio', name: `td-scope-${d.taskId}`, value, 'aria-label': label });
      input.checked = scope === value;
      input.addEventListener('change', () => {
        if (!input.checked) return;
        scope = value;
        d.announce(value === 'series' ? 'Edits now apply to every open copy of the series.' : 'Edits now apply to this task only.');
      });
      return el('label', { class: 'td-radio' }, input, el('span', { 'aria-hidden': 'true' }, label));
    };
    return el('fieldset', { class: 'td-scope' },
      el('legend', {}, 'Edits apply to'),
      el('div', { class: 'td-row' }, choice('one', 'This task'), choice('series', 'Entire series')),
      el('p', { class: 'muted td-small' }, 'The entire series changes the title, description and priority of every open copy. Dates and the repeat stay each copy’s own.'),
    );
  }

  function drawPriority() {
    const t = task();
    return section('priority', 'Priority',
      el('div', { class: 'toolbar td-chips' },
        PRIORITIES.map((p) => el('button', {
          class: `chip${t.priority === p ? ' on' : ''}`, type: 'button', 'aria-pressed': String(t.priority === p),
          onClick: () => { if (task().priority !== p) save({ priority: p }); },
        }, PRIORITY_LABEL[p])),
      ),
    );
  }

  function drawDates() {
    const t = task();
    const dueKey = dueDayKey(t.dueDate, zone()) || '';
    const startKey = dueDayKey(t.startDate, zone()) || '';
    const start = el('input', { class: 'field td-date', type: 'date', id: 'td-start', value: startKey, 'aria-label': 'Start date' });
    start.addEventListener('change', () => { if (start.value !== startKey) save({ startDate: start.value || null }); });
    const due = el('input', { class: 'field td-date', type: 'date', id: 'td-due', value: dueKey, 'aria-label': 'Due date' });
    due.addEventListener('change', () => { if (due.value !== dueKey) save({ dueDate: due.value || null }); });
    const milestone = el('input', { type: 'checkbox', id: 'td-milestone', 'aria-label': 'Milestone', 'aria-describedby': 'td-milestone-hint' });
    milestone.checked = !!t.isMilestone;
    milestone.addEventListener('change', () => save({ isMilestone: milestone.checked }));
    return section('dates', 'Dates',
      el('div', { class: 'row-fields td-dates' },
        el('div', {}, el('label', { class: 'lbl', for: 'td-start' }, 'Start date'), start),
        el('div', {}, el('label', { class: 'lbl', for: 'td-due' }, 'Due date'), due),
      ),
      el('label', { class: 'td-check td-milestone', for: 'td-milestone' },
        milestone,
        el('span', {}, el('span', { class: 'td-strong' }, '◆ Milestone'),
          el('span', { class: 'muted td-small', id: 'td-milestone-hint' }, ' — a key date or deliverable of the project, listed on its dashboard.')),
      ),
    );
  }

  function drawRepeat() {
    const dueKey = dueDayKey(task().dueDate, zone()) || '';
    // The repeat lives on the series' newest copy: it is never sent "for the whole series".
    return section('repeat', 'Repeat', repeatEditor(task(), dueKey || todayKey(zone()), (rule) => d.updateTask({ recurrenceRule: rule })));
  }

  function drawDescription() {
    const ta = el('textarea', { class: 'field', rows: '3', placeholder: 'Add a description…', 'aria-label': 'Description' });
    ta.value = task().description || '';
    ta.addEventListener('blur', () => {
      const v = ta.value.trim();
      if (v !== (task().description || '')) save({ description: v });
    });
    return section('description', 'Description', ta);
  }

  return { node, render, renderFor };
}
