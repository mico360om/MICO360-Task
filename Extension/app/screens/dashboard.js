import { el, mount, Loader, ErrorState, Empty } from '../dom.js';
import { summarizeTasks } from '../../src/summary.js';
import { taskRow, isDone } from '../components.js';

/** Dashboard — My Work widgets + overdue / due-today / upcoming lists (mirrors the web dashboard). */
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
    const s = summarizeTasks(tasks);
    const now = Date.now();
    const startOfDay = new Date(now); startOfDay.setHours(0, 0, 0, 0);
    const overdue = tasks.filter((t) => !isDone(t) && t.dueDate && new Date(t.dueDate) < startOfDay);
    const open = ctx.openTask;

    mount(root,
      stale ? el('div', { class: 'errbar', style: { background: 'var(--warning-soft)', color: 'var(--warning)', borderColor: 'transparent' } }, 'Showing saved data — you appear to be offline.') : null,
      el('div', { class: 'stats' },
        stat('today', s.dueToday, 'Due today'),
        stat('overdue', s.overdue, 'Overdue'),
        stat('', s.inProgress, 'In progress'),
        stat('done', s.completedToday, 'Completed today'),
      ),
      overdue.length ? section('Overdue', overdue.slice(0, 6).map((t) => taskRow(t, () => open(t.id)))) : null,
      section('Upcoming', s.upcoming.length ? s.upcoming.map((t) => taskRow(t, () => open(t.id))) : [el('div', { class: 'muted' }, 'Nothing coming up. 🎉')]),
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
