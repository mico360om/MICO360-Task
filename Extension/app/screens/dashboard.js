import { el, mount, Loader, ErrorState, Empty } from '../dom.js';
import { summarizeTasks, groupTasksByDue } from '../../src/summary.js';
import { taskRow } from '../components.js';
import { UpNext } from '../meeting/up-next.js';
import { nextUpMeeting, myInvitation } from '../../src/meetings.js';

/**
 * Dashboard — My Work widgets + overdue / upcoming lists (mirrors the web dashboard). "Today" and
 * "overdue" are calendar days in the company time zone (XP-03). On top, "Up next": the meeting under
 * way or the next one, with Join, your answer and Open (Stage 6) — left out when there is none, or
 * meetings can't be read.
 */
export function DashboardScreen(ctx) {
  const root = el('div');
  load();
  return root;

  async function load() {
    mount(root, Loader());
    const meeting = upNext(); // read beside the tasks
    try {
      const { data: tasks, stale } = await ctx.api.tasks.mine();
      render(tasks ?? [], stale, await meeting);
    } catch {
      mount(root, ErrorState('Could not load your tasks.', load));
    }
  }

  /** The Up next card, or null (no meeting coming, or meetings can't be read). */
  async function upNext() {
    if (!ctx.api.meetings) return null;
    try {
      const now = new Date();
      const list = await ctx.api.meetings.list();
      const up = nextUpMeeting(Array.isArray(list && list.data) ? list.data : [], now);
      if (!up) return null;
      const [people, projects] = await Promise.all([
        ctx.api.meetings.attendees(up.id).catch(() => null),
        ctx.api.projects && ctx.api.projects.list ? ctx.api.projects.list().catch(() => null) : null,
      ]);
      const project = up.projectId && projects && Array.isArray(projects.data) ? projects.data.find((p) => p.id === up.projectId) || null : null;
      return UpNext(ctx, up, { attendee: people ? myInvitation(people.data, ctx.me && ctx.me.id) : null, project, now });
    } catch {
      return null;
    }
  }

  function render(tasks, stale, meeting) {
    const now = Date.now();
    const s = summarizeTasks(tasks, now, ctx.timeZone);
    const { overdue } = groupTasksByDue(tasks, { timeZone: ctx.timeZone, now });
    const row = (t) => taskRow(t, () => ctx.openTask(t.id), { timeZone: ctx.timeZone });

    mount(root,
      stale ? el('div', { class: 'errbar', style: { background: 'var(--warning-soft)', color: 'var(--warning)', borderColor: 'transparent' } }, 'Showing saved data — you appear to be offline.') : null,
      meeting,
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
