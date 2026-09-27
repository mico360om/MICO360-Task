import { el, mount, Loader, ErrorState, Empty } from '../dom.js';
import { summarizeTasks, groupTasksByDue } from '../../src/summary.js';
import { taskRow } from '../components.js';

/**
 * Dashboard — My Work widgets + overdue / upcoming lists (mirrors the web dashboard). "Today" and
 * "overdue" are calendar days in the company time zone (XP-03).
 */
export function DashboardScreen(ctx) {
  const root = el('div');
  load();
  return root;

  async function load() {
    mount(root, Loader());
    try {
      const { data: tasks, stale } = await ctx.api.tasks.mine();
      render(tasks ?? [], stale);
    } catch {
      mount(root, ErrorState('Could not load your tasks.', load));
    }
  }

  function render(tasks, stale) {
    const now = Date.now();
    const s = summarizeTasks(tasks, now, ctx.timeZone);
    const { overdue } = groupTasksByDue(tasks, { timeZone: ctx.timeZone, now });
    const row = (t) => taskRow(t, () => ctx.openTask(t.id), { timeZone: ctx.timeZone });

    mount(root,
      stale ? el('div', { class: 'errbar', style: { background: 'var(--warning-soft)', color: 'var(--warning)', borderColor: 'transparent' } }, 'Showing saved data — you appear to be offline.') : null,
      el('div', { class: 'stats' },
        stat('today', s.dueToday, 'Due today'),
        stat('overdue', s.overdue, 'Overdue'),
        stat('', s.inProgress, 'In progress'),
        stat('done', s.completedToday, 'Completed today'),
      ),
      overdue.length ? section('Overdue', overdue.slice(0, 6).map(row)) : null,
      section('Upcoming', s.upcoming.length ? s.upcoming.map(row) : [el('div', { class: 'muted' }, 'Nothing coming up. 🎉')]),
      tasks.length === 0 ? Empty('No tasks yet', 'Tasks assigned to you show up here.') : null,
    );
  }

  function stat(cls, n, label) {
    return el('div', { class: `stat ${cls}` }, el('div', { class: 'n' }, String(n)), el('div', { class: 'l' }, label));
  }
  function section(title, children) {
    return el('div', { style: { marginTop: '20px' } }, el('div', { class: 'section-title' }, title), el('div', { class: 'list' }, children));
  }
}
