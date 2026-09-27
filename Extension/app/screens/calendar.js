import { el, mount, Loader, ErrorState, Empty } from '../dom.js';
import { taskRow } from '../components.js';
import { dueDayKey, todayKey, formatDayKey } from '../../src/due-date.js';

/**
 * Calendar — an agenda of your due tasks grouped by due day (ascending). Due days are calendar days
 * and "Today" is today in the company time zone (XP-03). Tasks with no due date are omitted.
 */
export function CalendarScreen(ctx) {
  const root = el('div');
  load();
  return root;

  async function load() {
    mount(root, Loader());
    try {
      const { data, stale } = await ctx.api.tasks.mine();
      render(data ?? [], stale);
    } catch {
      mount(root, ErrorState('Could not load your calendar.', load));
    }
  }

  function render(tasks, stale) {
    const today = todayKey(ctx.timeZone);
    const byDay = new Map();
    for (const t of tasks) {
      const key = dueDayKey(t.dueDate, ctx.timeZone);
      if (!key) continue;
      if (!byDay.has(key)) byDay.set(key, []);
      byDay.get(key).push(t);
    }
    const days = [...byDay.keys()].sort(); // YYYY-MM-DD sorts lexically == chronologically

    mount(root,
      stale ? el('div', { class: 'toolbar' }, el('span', { class: 'stale-tag' }, 'offline · saved')) : null,
      days.length === 0
        ? Empty('Nothing scheduled', 'Tasks with a due date show up here.')
        : el('div', {}, days.map((key) => daySection(key, byDay.get(key), key === today))),
    );
  }

  function daySection(key, tasks, isToday) {
    return el('div', { style: { marginTop: '20px' } },
      el('div', { class: 'section-title', style: isToday ? { color: 'var(--brand)' } : null },
        formatDayKey(key), isToday ? ' · Today' : null),
      el('div', { class: 'list' }, tasks.map((t) => taskRow(t, () => ctx.openTask(t.id), { timeZone: ctx.timeZone }))),
    );
  }
}
