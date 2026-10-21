import { el, mount, Loader, ErrorState } from '../dom.js';
import { href } from '../../src/router.js';
import { isDayKey, todayKey } from '../../src/due-date.js';
import { hasProjectColor } from '../../src/project-identity.js';
import {
  VIEWS, visibleRange, shiftMonth, monthOf, monthWeeks, weekDays, weekdayLabels, dayLabel, periodLabel, dateSettings, timeNote,
  buildItems, applyFilters, groupByDay, filtersFromQuery, filtersToQuery, DEFAULT_FILTERS, meetingItems, filterCalendarMeetings,
  groupMeetingsByDay, meetingRange, itemName, meetingName, STATUS_LABEL,
} from '../../src/calendar.js';
import { shiftDayKey } from '../../src/due-date.js';

/** In a month's day, this many items show; the rest are "+N more" (the day's list has them all). */
const IN_A_DAY = 3;
const ICON = { overdue: '!', blocked: '⊘', 'in-progress': '◐', todo: '○', done: '✓', projected: '↻' };
const WEEKDAY_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const rows = (v) => (Array.isArray(v) ? v : []);

/**
 * Calendar, as on the web (Stage 6): `GET /calendar` for the days shown — the tasks due in the
 * projects you can see (everyone's, with who they are for), and the copies repeating tasks will
 * make, marked "not created yet" — with the meetings in those days. Month, Week or Agenda; Only
 * mine, Done, Repeats and Meetings. Days and times are in your own time zone and the week starts on
 * your day (your settings on the website), else the company's zone and Sunday. A task opens its
 * panel (a copy to come opens the current one), a meeting its page. The place — view, day and
 * filters — is kept in the address with the web's names. Reads work offline (the saved copy).
 */
export function CalendarScreen(ctx) {
  const q = ctx.query || {};
  let view = VIEWS.includes(q.view) ? q.view : 'month';
  let date = isDayKey(q.date) ? q.date : null; // null = today
  let filters = filtersFromQuery(q);
  let settings = dateSettings(null, ctx.timeZone);
  let data = null;
  let meetings = [];
  let meetingsFailed = false;
  let projects = [];
  let stale = false;
  let failed = false;
  let asked = '';

  const root = el('div', { class: 'cal' });
  root.refresh = () => { void load(); return true; };
  void start();
  return root;

  async function start() {
    mount(root, Loader('Loading the calendar…'));
    try {
      const p = await ctx.api.preferences();
      settings = dateSettings(p && p.data, ctx.timeZone);
    } catch { /* the company's zone and Sunday */ }
    await load();
  }

  function today() {
    return todayKey(settings.timeZone);
  }

  function cursor() {
    return date || today();
  }

  async function load() {
    const { from, to } = visibleRange(view, cursor(), settings.weekStart);
    const key = `${from}:${to}`;
    asked = key;
    root.setAttribute('aria-busy', 'true');
    const span = meetingRange(from, to, settings.timeZone);
    try {
      const [cal, mts, prj] = await Promise.all([
        ctx.api.calendar(from, to),
        ctx.api.meetings.list({ from: span.from, to: span.to }).then((r) => ({ r }), () => null),
        projects.length ? null : ctx.api.projects.list().catch(() => null),
      ]);
      if (asked !== key) return; // moved on meanwhile
      data = cal && cal.data ? cal.data : { tasks: [], occurrences: [], series: [] };
      meetings = mts ? rows(mts.r && mts.r.data) : [];
      meetingsFailed = !mts;
      stale = !!((cal && cal.stale) || (mts && mts.r && mts.r.stale));
      if (prj) projects = rows(prj.data);
      failed = false;
    } catch {
      if (asked !== key) return;
      failed = true;
    }
    root.removeAttribute('aria-busy');
    render();
  }

  // ---- the place (view, day, filters), kept in the address -----------------------------------

  function address() {
    return href('/calendar', { ...filtersToQuery(filters), ...(view !== 'month' ? { view } : {}), ...(date ? { date } : {}) });
  }

  /** Go somewhere: the address follows (without drawing the screen again); a new range is read. */
  function go(patch) {
    const before = visibleRange(view, cursor(), settings.weekStart);
    if ('view' in patch) view = patch.view;
    if ('date' in patch) date = patch.date;
    if ('filters' in patch) filters = patch.filters;
    if (ctx.replaceHash) ctx.replaceHash(address());
    const after = visibleRange(view, cursor(), settings.weekStart);
    if (before.from !== after.from || before.to !== after.to) void load();
    else render();
  }

  function step(dir) {
    go({ date: view === 'week' ? shiftDayKey(cursor(), 7 * dir) : shiftMonth(cursor(), dir) });
  }

  // ---- drawing -------------------------------------------------------------------------------

  function render() {
    const a = document.activeElement;
    const keep = a && root.contains(a) ? a.dataset.focusKey : null;
    if (failed && !data) {
      mount(root, toolbar(), ErrorState('Couldn’t load the calendar.', () => load()));
    } else {
      mount(root, toolbar(), body());
    }
    if (keep) {
      const again = root.querySelector(`[data-focus-key="${keep}"]`);
      if (again) again.focus();
    }
  }

  function projectOf(id) {
    return projects.find((p) => p.id === id) || null;
  }

  function computed() {
    const projectStatus = (id) => (projectOf(id) || {}).status;
    const items = buildItems(data || { tasks: [], occurrences: [], series: [] }, { today: today(), timeZone: settings.timeZone, projectStatus });
    const shown = applyFilters(items, filters, { myId: ctx.me.id });
    const mItems = filterCalendarMeetings(meetingItems(meetings, settings.timeZone), filters, { myId: ctx.me.id });
    return { shown, byDay: groupByDay(shown), mByDay: groupMeetingsByDay(mItems), mCount: mItems.length };
  }

  function filtered() {
    return filters.mine || !filters.showCompleted || !filters.showProjected || !filters.showMeetings;
  }

  function toolbar() {
    const unit = view === 'week' ? 'week' : 'month';
    const btn = (text, focusKey, onClick, extra = {}) => el('button', { class: 'btn sm', type: 'button', dataset: { focusKey }, onClick, ...extra }, text);
    const pressed = (label, on, focusKey, onClick) => el('button', { class: `chip${on ? ' on' : ''}`, type: 'button', 'aria-pressed': on ? 'true' : 'false', dataset: { focusKey }, onClick }, label);
    const flip = (name) => go({ filters: { ...filters, [name]: !filters[name] } });
    return el('div', { class: 'cal-bar' },
      el('div', { class: 'cal-nav' },
        btn('‹', 'prev', () => step(-1), { 'aria-label': `Previous ${unit}` }),
        btn('Today', 'today', () => go({ date: null })),
        btn('›', 'next', () => step(1), { 'aria-label': `Next ${unit}` }),
        el('h2', { class: 'cal-period', 'aria-live': 'polite' }, periodLabel(view, cursor(), settings.weekStart))),
      el('div', { class: 'cal-views', role: 'group', 'aria-label': 'View' },
        VIEWS.map((v) => pressed(v[0].toUpperCase() + v.slice(1), view === v, `view-${v}`, () => go({ view: v })))),
      el('div', { class: 'cal-filters', role: 'group', 'aria-label': 'Show' },
        pressed('Only mine', filters.mine, 'f-mine', () => flip('mine')),
        pressed('Done', filters.showCompleted, 'f-done', () => flip('showCompleted')),
        pressed('Repeats', filters.showProjected, 'f-repeats', () => flip('showProjected')),
        pressed('Meetings', filters.showMeetings, 'f-meetings', () => flip('showMeetings'))),
      el('p', { class: 'muted cal-note' },
        stale ? el('span', { class: 'stale-tag' }, 'offline · saved') : null,
        el('span', {}, timeNote(settings)),
        meetingsFailed ? el('span', {}, ' · Meetings couldn’t be loaded.') : null),
      el('ul', { class: 'cal-legend', 'aria-label': 'Legend' },
        ['overdue', 'todo', 'in-progress', 'blocked', 'done', 'projected'].map((s) => el('li', { class: `s-${s}` }, el('span', { class: 'cal-ic', 'aria-hidden': 'true' }, ICON[s]), STATUS_LABEL[s])),
        el('li', { class: 'meeting' }, el('span', { class: 'cal-ic', 'aria-hidden': 'true' }, '👥'), 'Meeting')));
  }

  function body() {
    const c = computed();
    const label = periodLabel(view, cursor(), settings.weekStart);
    const nothing = !c.shown.length && !c.mCount
      ? el('div', { class: 'cal-nothing' },
        el('p', {}, filtered() ? `No tasks match these filters in ${label}.` : `Nothing is due in ${label}.`),
        filtered() ? el('button', { class: 'btn sm', type: 'button', dataset: { focusKey: 'clear' }, onClick: () => go({ filters: { ...DEFAULT_FILTERS } }) }, 'Clear filters') : null)
      : null;
    if (view === 'week') return [nothing, el('div', { class: 'cal-list' }, weekDays(cursor(), settings.weekStart).map((d) => daySection(d, c, 'cal-day-section')))];
    if (view === 'agenda') {
      const { from, to } = visibleRange('agenda', cursor(), settings.weekStart);
      const days = [...new Set([...c.byDay.keys(), ...c.mByDay.keys()])].filter((d) => d >= from && d <= to).sort();
      return [nothing, days.length ? el('div', { class: 'cal-list' }, days.map((d) => daySection(d, c, 'cal-day-section'))) : null];
    }
    return [nothing, month(c), daySection(cursor(), c, 'cal-daylist')];
  }

  function month(c) {
    const { year, month0 } = monthOf(cursor());
    const t = today();
    const chosen = cursor();
    const labels = weekdayLabels(settings.weekStart);
    return el('table', { class: 'cal-month' },
      el('caption', { class: 'sr-only' }, periodLabel('month', cursor(), settings.weekStart)),
      el('thead', {}, el('tr', {}, labels.map((l, i) => el('th', { scope: 'col', abbr: WEEKDAY_LONG[(settings.weekStart + i) % 7] }, l)))),
      el('tbody', {}, monthWeeks(year, month0, settings.weekStart).map((week) => el('tr', {}, week.map((cell) => {
        const meetingsOn = c.mByDay.get(cell.key) || [];
        const tasksOn = c.byDay.get(cell.key) || [];
        const all = [...meetingsOn.map((m) => meetingChip(m, false)), ...tasksOn.map((i) => taskChip(i, false))];
        const count = meetingsOn.length + tasksOn.length;
        const more = count - IN_A_DAY;
        const pick = () => go({ date: cell.key });
        return el('td', { class: `cal-cell${cell.inMonth ? '' : ' out'}${cell.key === t ? ' today' : ''}${cell.key === chosen ? ' chosen' : ''}`, dataset: { day: cell.key } },
          el('button', {
            class: 'cal-daynum', type: 'button', dataset: { focusKey: `day-${cell.key}` }, 'aria-pressed': cell.key === chosen ? 'true' : 'false',
            'aria-label': `${dayLabel(cell.key)}${cell.key === t ? ', today' : ''}${count ? `, ${count} ${count === 1 ? 'item' : 'items'}` : ''}`, onClick: pick,
          }, String(cell.day)),
          count ? el('span', { class: 'cal-dots', 'aria-hidden': 'true' }, '•'.repeat(Math.min(count, 4))) : null,
          el('div', { class: 'cal-chips' }, all.slice(0, IN_A_DAY)),
          more > 0 ? el('button', { class: 'linkbtn cal-more', type: 'button', dataset: { focusKey: `more-${cell.key}` }, 'aria-label': `${more} more on ${dayLabel(cell.key)}`, onClick: pick }, `+${more} more`) : null);
      })))));
  }

  function daySection(day, c, cls) {
    const meetingsOn = c.mByDay.get(day) || [];
    const tasksOn = c.byDay.get(day) || [];
    return el('section', { class: `card ${cls}`, 'aria-label': dayLabel(day) },
      el('h3', {}, dayLabel(day, { weekday: 'long', day: 'numeric', month: 'long' })),
      meetingsOn.length || tasksOn.length
        ? el('div', { class: 'cal-chips' }, meetingsOn.map((m) => meetingChip(m, true)), tasksOn.map((i) => taskChip(i, true)))
        : el('p', { class: 'muted' }, 'Nothing due.'));
  }

  function taskChip(item, withMeta) {
    const t = item.task;
    const project = projectOf(t.projectId);
    const people = rows(t.assignees).map((a) => a && a.name).filter(Boolean).join(', ');
    const meta = withMeta ? [item.kind === 'task' ? t.key : 'Not created yet', project && project.name, people].filter(Boolean).join(' · ') : '';
    return el('button', {
      class: `cal-chip s-${item.status}`, type: 'button', dataset: { item: item.key, taskId: t.id }, 'aria-label': itemName(item),
      title: item.kind === 'projected' ? `Not created yet · ${t.title}` : `${t.key} · ${t.title}`,
      style: hasProjectColor(project) ? { borderInlineStartColor: project.color } : null,
      // A copy to come isn't a task yet: its series' current copy opens.
      onClick: () => ctx.openTask(t.id),
    },
    el('span', { class: 'cal-ic', 'aria-hidden': 'true' }, ICON[item.status]),
    el('span', { class: 'cal-chip-text' },
      el('span', { class: 'cal-chip-title' }, el('bdi', {}, t.title)),
      meta ? el('span', { class: 'cal-chip-meta', dir: 'auto' }, meta) : null),
    item.kind === 'task' && item.recurring ? el('span', { class: 'cal-rep', 'aria-hidden': 'true', title: 'Repeats' }, '↻') : null);
  }

  function meetingChip(m, withMeta) {
    const project = m.projectId ? projectOf(m.projectId) : null;
    const meta = withMeta ? [m.time, m.location].filter(Boolean).join(' · ') : '';
    return el('button', {
      class: `cal-chip meeting${m.cancelled ? ' cancelled' : ''}`, type: 'button', dataset: { item: m.key }, 'aria-label': meetingName(m), title: `${m.time} · ${m.title}`,
      style: hasProjectColor(project) ? { borderInlineStartColor: project.color } : null,
      onClick: () => ctx.navigate(`#/meeting/${encodeURIComponent(m.id)}`),
    },
    el('span', { class: 'cal-ic', 'aria-hidden': 'true' }, '👥'),
    el('span', { class: 'cal-chip-text' },
      // The time first, then the title isolated: an Arabic title can't pull the time to its side.
      el('span', { class: 'cal-chip-title' }, el('span', { class: 'cal-time' }, m.time.split(' – ')[0]), ' ', el('bdi', {}, m.title)),
      meta ? el('span', { class: 'cal-chip-meta', dir: 'auto' }, meta) : null),
    m.recurring ? el('span', { class: 'cal-rep', 'aria-hidden': 'true', title: 'Repeats' }, '↻') : null);
  }
}
