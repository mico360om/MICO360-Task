import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { transformSync } from 'esbuild';
import {
  TASK_FILTERS,
  canScheduleIn,
  dayText,
  daysLeftLabel,
  filterCounts,
  isTaskFinished,
  meetingsLine,
  milestoneNote,
  ownerName,
  priorityLine,
  projectDeadlines,
  projectMilestones,
  projectTimeline,
  relativeDays,
  shownGroups,
  statTiles,
  summaryRequest,
  taskGroups,
  taskPhase,
  taskStats,
  tasksTabRowLabel,
  timelineText,
  withColumnStage,
  workDoneText,
  workload,
} from './project-dashboard';
import type { ApiTask } from './types';

const task = (id: string, patch: Partial<ApiTask> = {}): ApiTask => ({
  id,
  key: `P-${id}`,
  title: id,
  description: null,
  projectId: 'p1',
  columnId: 'c1',
  position: 0,
  priority: 'NORMAL',
  startDate: null,
  dueDate: null,
  estimatedHours: null,
  progress: 0,
  completedAt: null,
  ...patch,
});

const TODAY = '2026-10-16';

describe('isTaskFinished', () => {
  it('is finished when completed or in a Done column', () => {
    expect(isTaskFinished(task('a', { completedAt: '2026-10-01T08:00:00Z' }))).toBe(true);
    expect(isTaskFinished(task('b', { columnCategory: 'DONE' }))).toBe(true);
    expect(isTaskFinished(task('c', { columnCategory: 'IN_PROGRESS' }))).toBe(false);
  });
});

describe('projectMilestones', () => {
  it('lists only milestones, by date with undated last, and says where each stands', () => {
    const list = projectMilestones(
      [
        task('plain', { dueDate: '2026-10-17T00:00:00.000Z' }),
        task('undated', { isMilestone: true }),
        task('late', { isMilestone: true, dueDate: '2026-10-10T00:00:00.000Z' }),
        task('done', { isMilestone: true, dueDate: '2026-10-01T00:00:00.000Z', columnCategory: 'DONE' }),
        task('soon', { isMilestone: true, dueDate: '2026-10-20T00:00:00.000Z' }),
      ],
      TODAY,
    );
    expect(list.map((m) => [m.task.id, m.state, m.daysLeft])).toEqual([
      ['done', 'done', null],
      ['late', 'overdue', -6],
      ['soon', 'upcoming', 4],
      ['undated', 'undated', null],
    ]);
  });

  it('keeps a due date on its own calendar day', () => {
    const [m] = projectMilestones([task('a', { isMilestone: true, dueDate: '2026-10-16T00:00:00.000Z' })], TODAY);
    expect(m!.due).toBe('2026-10-16');
    expect(m!.state).toBe('upcoming');
    expect(m!.daysLeft).toBe(0);
  });
});

describe('projectDeadlines', () => {
  it('lists open tasks due within two weeks and every overdue one, soonest first', () => {
    const list = projectDeadlines(
      [
        task('far', { dueDate: '2026-11-30T00:00:00.000Z' }),
        task('done', { dueDate: '2026-10-17T00:00:00.000Z', completedAt: '2026-10-15T09:00:00Z' }),
        task('week', { dueDate: '2026-10-23T00:00:00.000Z' }),
        task('overdue', { dueDate: '2026-09-01T00:00:00.000Z' }),
        task('today', { dueDate: '2026-10-16T00:00:00.000Z' }),
        task('none'),
      ],
      TODAY,
    );
    expect(list.map((d) => [d.task.id, d.daysLeft])).toEqual([
      ['overdue', -45],
      ['today', 0],
      ['week', 7],
    ]);
  });

  it('can look further ahead', () => {
    const list = projectDeadlines([task('far', { dueDate: '2026-11-30T00:00:00.000Z' })], TODAY, 60);
    expect(list.map((d) => d.task.id)).toEqual(['far']);
  });
});

describe('daysLeftLabel', () => {
  it('says how far away a day is in words', () => {
    expect(daysLeftLabel(0)).toBe('Today');
    expect(daysLeftLabel(1)).toBe('Tomorrow');
    expect(daysLeftLabel(5)).toBe('In 5 days');
    expect(daysLeftLabel(-1)).toBe('1 day late');
    expect(daysLeftLabel(-3)).toBe('3 days late');
  });
});

// ── 5b: the website's dashboard numbers ─────────────────────────────────────
describe('where each task stands', () => {
  it('is completed, overdue, ongoing (being worked on) or pending (not started)', () => {
    expect(taskPhase(task('a', { columnCategory: 'DONE' }), TODAY, 'UTC')).toBe('completed');
    expect(taskPhase(task('b', { completedAt: '2026-10-01T08:00:00Z', columnCategory: 'TODO' }), TODAY, 'UTC')).toBe('completed');
    expect(taskPhase(task('c', { columnCategory: 'IN_PROGRESS', dueDate: '2026-10-15T00:00:00.000Z' }), TODAY, 'UTC')).toBe('overdue');
    expect(taskPhase(task('d', { columnCategory: 'REVIEW' }), TODAY, 'UTC')).toBe('ongoing');
    expect(taskPhase(task('e', { columnCategory: 'BLOCKED', dueDate: '2026-10-16T00:00:00.000Z' }), TODAY, 'UTC')).toBe('ongoing');
    expect(taskPhase(task('f', { columnCategory: 'BACKLOG' }), TODAY, 'UTC')).toBe('pending');
    expect(taskPhase(task('g'), TODAY, 'UTC')).toBe('pending');
  });

  it('adds up the stat tiles, the average progress and the open tasks by priority', () => {
    const s = taskStats(
      [
        task('a', { columnCategory: 'DONE', priority: 'HIGH' }),
        task('b', { columnCategory: 'IN_PROGRESS', progress: 50, priority: 'URGENT' }),
        task('c', { columnCategory: 'TODO', dueDate: '2026-10-01T00:00:00.000Z', progress: 150 }),
        task('d', { columnCategory: 'TODO', priority: 'LOW' }),
      ],
      TODAY,
      'UTC',
    );
    expect(s).toEqual({
      total: 4,
      completed: 1,
      overdue: 1,
      ongoing: 1,
      pending: 1,
      pct: 25,
      avgProgress: 63,
      byPriority: { URGENT: 1, HIGH: 0, NORMAL: 1, LOW: 1 },
    });
    expect(taskStats([], TODAY, 'UTC')).toMatchObject({ total: 0, pct: 0, avgProgress: 0 });
  });
});

describe('who has what', () => {
  it('counts each assignee’s open, late and completed tasks, busiest first', () => {
    const people = workload(
      [
        task('a', { columnCategory: 'TODO', assignees: [{ id: 'u1', name: 'Omar' }, { id: 'u2', name: 'Aisha' }] as never }),
        task('b', { columnCategory: 'TODO', dueDate: '2026-10-01T00:00:00.000Z', assignees: [{ id: 'u2', name: 'Aisha' }] as never }),
        task('c', { columnCategory: 'DONE', assignees: [{ id: 'u1', name: 'Omar' }] as never }),
        task('d', { columnCategory: 'TODO', assignees: [{ id: 'u3', username: 'sara', firstName: 'Sara', lastName: 'Ali', email: 'x' }] }),
      ],
      TODAY,
      'UTC',
    );
    expect(people).toEqual([
      { id: 'u2', name: 'Aisha', open: 2, overdue: 1, completed: 0 },
      { id: 'u1', name: 'Omar', open: 1, overdue: 0, completed: 1 },
      { id: 'u3', name: 'Sara Ali', open: 1, overdue: 0, completed: 0 },
    ]);
  });
});

describe('the project’s timeline', () => {
  it('says how far through its start and target dates the project is', () => {
    expect(projectTimeline('2026-10-01T00:00:00.000Z', '2026-10-31T00:00:00.000Z', TODAY, 'UTC')).toEqual({ start: '2026-10-01', end: '2026-10-31', elapsedPct: 50, daysLeft: 15, state: 'running' });
    expect(projectTimeline('2026-11-01', '2026-11-30', TODAY, 'UTC')).toMatchObject({ state: 'not-started', elapsedPct: 0 });
    expect(projectTimeline('2026-09-01', '2026-10-10', TODAY, 'UTC')).toMatchObject({ state: 'late', elapsedPct: 100, daysLeft: -6 });
    expect(projectTimeline(null, '2026-10-10', TODAY, 'UTC')).toBeNull();
  });

  it('says it in words', () => {
    expect(timelineText(null)).toBe('Set a start and target date');
    expect(timelineText(projectTimeline('2026-11-03', '2026-11-30', TODAY, 'UTC'))).toBe('Starts 3 Nov 2026');
    expect(timelineText(projectTimeline('2026-09-01', '2026-10-10', TODAY, 'UTC'))).toBe('6 days past the target date');
    expect(timelineText(projectTimeline('2026-10-01', '2026-10-17', TODAY, 'UTC'))).toBe('1 day left · ends 17 Oct 2026');
    expect(timelineText(projectTimeline('2026-10-01', '2026-10-31', TODAY, 'UTC'))).toBe('15 days left · ends 31 Oct 2026');
  });
});

describe('the dashboard’s words', () => {
  it('writes a calendar day and a distance in days as the website does', () => {
    expect(dayText('2026-11-03')).toBe('3 Nov 2026');
    expect(dayText('2026-11-03T00:00:00.000Z')).toBe('3 Nov 2026');
    expect(dayText(null)).toBe('—');
    expect([0, 1, -1, 3, -4].map(relativeDays)).toEqual(['today', 'tomorrow', 'yesterday', 'in 3 days', '4 days ago']);
  });

  it('says where a milestone stands', () => {
    expect(milestoneNote('done', null)).toBe('Reached');
    expect(milestoneNote('undated', null)).toBe('No date set');
    expect(milestoneNote('overdue', -1)).toBe('Late by 1 day');
    expect(milestoneNote('overdue', -4)).toBe('Late by 4 days');
    expect(milestoneNote('upcoming', 0)).toBe('Due today');
    expect(milestoneNote('upcoming', 5)).toBe('Due in 5 days');
  });

  it('shows "—" on the tiles until the tasks arrive, and what isn’t started yet', () => {
    const s = taskStats([task('a', { columnCategory: 'TODO' }), task('b', { columnCategory: 'DONE' })], TODAY, 'UTC');
    expect(statTiles(s, true)).toEqual([
      { key: 'total', label: 'Total tasks', value: '2', hint: '1 not started', tone: 'neutral' },
      { key: 'completed', label: 'Completed', value: '1', tone: 'success' },
      { key: 'ongoing', label: 'Ongoing', value: '0', tone: 'info' },
      { key: 'overdue', label: 'Overdue', value: '0', tone: 'danger' },
      { key: 'pct', label: 'Completion', value: '50%', tone: 'brand' },
    ]);
    expect(statTiles(s, false).map((t) => t.value)).toEqual(['—', '—', '—', '—', '—']);
    expect(statTiles(s, false)[0]!.hint).toBeUndefined();
  });

  it('sums up the work done and the open tasks by priority', () => {
    const s = taskStats([task('a', { columnCategory: 'DONE' }), task('b', { columnCategory: 'TODO', progress: 40, priority: 'URGENT' })], TODAY, 'UTC');
    expect(workDoneText(s, true)).toBe('1 of 2 tasks · 70% overall');
    expect(workDoneText(s, false)).toBe('…');
    expect(priorityLine(s)).toBe('Open by priority: 1 urgent · 0 high · 0 normal · 0 low');
  });

  it('names the owner from the people list', () => {
    const people = [{ id: 'u1', username: 'omar', firstName: 'Omar', lastName: 'Said' }, { id: 'u2', username: 'aisha', firstName: '', lastName: '' }];
    expect(ownerName(null, people)).toBe('No owner');
    expect(ownerName('u1', people)).toBe('Omar Said');
    expect(ownerName('u2', people)).toBe('aisha');
    expect(ownerName('u9', people)).toBe('Unknown');
  });

  it('lets meetings be planned only while the project is still open', () => {
    expect(canScheduleIn({ status: 'ACTIVE' })).toBe(true);
    expect(canScheduleIn({ status: 'PLANNING' })).toBe(true);
    expect(canScheduleIn({ status: 'COMPLETED' })).toBe(false);
    expect(canScheduleIn({ status: 'ARCHIVED' })).toBe(false);
    expect(canScheduleIn(null)).toBe(false);
  });

  it('sums up the project’s meetings', () => {
    expect(meetingsLine({ upcoming: 2, completed: 5, openActionItems: 1, overdueActionItems: 0 })).toBe('2 upcoming · 5 held · 1 open action item');
    expect(meetingsLine({ upcoming: 0, completed: 0, openActionItems: 3, overdueActionItems: 2 })).toBe('0 upcoming · 0 held · 3 open action items (2 late)');
  });
});

describe('the Tasks tab', () => {
  const columns = [
    { id: 'c2', projectId: 'p1', name: 'Doing', category: 'IN_PROGRESS' as const, position: 2, color: '#B87611', enabled: true },
    { id: 'c1', projectId: 'p1', name: 'To do', category: 'TODO' as const, position: 1, color: '#9A918D', enabled: true },
    { id: 'c3', projectId: 'p1', name: 'Done', category: 'DONE' as const, position: 3, color: '#2E7D53', enabled: true },
  ];

  it('gives each task its column’s stage, and groups them by column in board order with strays last', () => {
    const tasks = withColumnStage(
      [task('a', { columnId: 'c3' }), task('b', { columnId: 'c1', columnCategory: 'IN_PROGRESS' }), task('c', { columnId: 'gone', columnCategory: 'REVIEW' }), task('d', { columnId: 'gone2' })],
      columns,
    );
    expect(tasks.map((t) => t.columnCategory)).toEqual(['DONE', 'TODO', 'REVIEW', 'TODO']);
    const groups = taskGroups(columns, tasks);
    expect(groups.map((g) => [g.id, g.name, g.tasks.map((t) => t.id)])).toEqual([
      ['c1', 'To do', ['b']],
      ['c2', 'Doing', []],
      ['c3', 'Done', ['a']],
      ['__orphan', 'Uncategorized', ['c', 'd']],
    ]);
    expect(groups[3]!.color).toBeNull();
  });

  it('counts and narrows by where tasks stand, milestones, or words in the title or key', () => {
    const tasks = withColumnStage(
      [
        task('a', { key: 'RIG-1', title: 'Order pipes', columnId: 'c3' }),
        task('b', { key: 'RIG-2', title: 'Inspect valves', columnId: 'c2', isMilestone: true }),
        task('c', { key: 'RIG-3', title: 'Book crane', columnId: 'c1', dueDate: '2026-10-01T00:00:00.000Z' }),
        task('d', { key: 'RIG-14', title: 'Paint', columnId: 'c1' }),
      ],
      columns,
    );
    const groups = taskGroups(columns, tasks);
    expect(TASK_FILTERS.map((f) => f.label)).toEqual(['All', 'Ongoing', 'Pending', 'Overdue', 'Completed', 'Milestones']);
    expect(filterCounts(tasks, TODAY, 'UTC')).toEqual({ all: 4, ongoing: 1, pending: 1, overdue: 1, completed: 1, milestones: 1 });
    const ids = (f: Parameters<typeof shownGroups>[1], q = '') => shownGroups(groups, f, q, TODAY, 'UTC').map((g) => [g.name, g.tasks.map((t) => t.id)]);
    expect(ids('all')).toEqual([['To do', ['c', 'd']], ['Doing', ['b']], ['Done', ['a']]]);
    expect(ids('overdue')).toEqual([['To do', ['c']]]);
    expect(ids('milestones')).toEqual([['Doing', ['b']]]);
    expect(ids('all', 'rig-1')).toEqual([['To do', ['d']], ['Done', ['a']]]);
    expect(ids('all', ' CRANE ')).toEqual([['To do', ['c']]]);
    expect(ids('completed', 'crane')).toEqual([]);
  });

  it('describes a row for TalkBack with its status, priority, progress, people and due day', () => {
    const t = task('a', { key: 'RIG-3', title: 'Book crane', priority: 'HIGH', progress: 40, dueDate: '2026-10-01T00:00:00.000Z', assignees: [{ id: 'u1', name: 'Omar' }] as never, isMilestone: true });
    expect(tasksTabRowLabel(t, { statusName: 'To do', phase: 'overdue', dueText: 'Oct 1' })).toBe('RIG-3, milestone, Book crane, To do, High priority, 40% done, Omar, overdue, due Oct 1');
    const plain = task('b', { key: 'RIG-4', title: 'Paint', columnCategory: 'DONE' });
    expect(tasksTabRowLabel(plain, { statusName: 'Done', phase: 'completed', dueText: null })).toBe('RIG-4, Paint, Done, Normal priority, 100% done, Unassigned, No due date');
  });
});

describe('the AI status summary', () => {
  it('sends the website’s figures and up to eight open task titles, within the server’s limits', () => {
    const tasks = Array.from({ length: 10 }, (_, i) => task(`t${i}`, { title: i === 1 ? 'x'.repeat(400) : `Task ${i}`, columnCategory: i === 0 ? 'DONE' : 'TODO' }));
    const s = taskStats(tasks, TODAY, 'UTC');
    const req = summaryRequest('  Rig Inspection  ', tasks, s);
    expect(req.name).toBe('Rig Inspection');
    expect(req.stats).toEqual({ total: 10, completed: 1, inProgress: 0, overdue: 0 });
    expect(req.sampleTitles).toHaveLength(8);
    expect(req.sampleTitles[0]).toHaveLength(300);
    expect(req.sampleTitles[1]).toBe('Task 2');
    expect(summaryRequest('', [], taskStats([], TODAY, 'UTC')).name).toBe('Project');
  });
});

/**
 * The website's dashboard (Web Portal/frontend/src/lib/project-dashboard.ts, and the words in
 * components/project-dashboard/parts.tsx) and this one must give the same numbers. Skipped when
 * the website's code isn't next to the app.
 */
const webDashboard = resolve(__dirname, '../../../Web Portal/frontend/src/lib/project-dashboard.ts');
const webParts = resolve(__dirname, '../../../Web Portal/frontend/src/components/project-dashboard/parts.tsx');
describe.skipIf(!existsSync(webDashboard) || !existsSync(webParts))('the same as the website', () => {
  type Fn = (...a: unknown[]) => unknown;
  const sample = [
    task('a', { columnCategory: 'DONE', priority: 'HIGH', assignees: [{ id: 'u1', name: 'Omar' }] as never }),
    task('b', { columnCategory: 'IN_PROGRESS', progress: 50, priority: 'URGENT', dueDate: '2026-10-16T21:30:00.000Z', assignees: [{ id: 'u2', name: 'Aisha' }] as never }),
    task('c', { columnCategory: 'TODO', dueDate: '2026-10-01T00:00:00.000Z', progress: 150, isMilestone: true, assignees: [{ id: 'u2', name: 'Aisha' }, { id: 'u1', name: 'Omar' }] as never }),
    task('d', { columnCategory: 'BACKLOG', priority: 'LOW', completedAt: '2026-10-02T08:00:00Z', isMilestone: true }),
    task('e', { columnCategory: 'REVIEW', dueDate: '2026-10-20', isMilestone: true }),
    task('f', { columnCategory: 'BLOCKED', progress: -5 }),
  ];

  it('works out phases, stats, workload, milestones, deadlines and the timeline alike', async () => {
    const web = (await import(/* @vite-ignore */ webDashboard)) as Record<string, Fn>;
    for (const zone of ['UTC', 'Asia/Muscat']) {
      for (const today of ['2026-10-01', TODAY, '2026-10-30']) {
        for (const t of sample) expect(taskPhase(t, today, zone)).toBe(web.taskPhase!(t, today, zone));
        expect(taskStats(sample, today, zone)).toEqual(web.taskStats!(sample, today, zone));
        expect(workload(sample, today, zone)).toEqual(web.workload!(sample, today, zone));
        expect(projectMilestones(sample, today, zone).map((m) => [m.task.id, m.state, m.daysLeft])).toEqual(
          (web.milestones!(sample, today, zone) as { task: ApiTask; state: string; daysLeft: number | null }[]).map((m) => [m.task.id, m.state, m.daysLeft]),
        );
        expect(projectDeadlines(sample, today, 14, zone).map((d) => [d.task.id, d.daysLeft])).toEqual(
          (web.deadlines!(sample, today, 14, zone) as { task: ApiTask; daysLeft: number }[]).map((d) => [d.task.id, d.daysLeft]),
        );
        for (const [a, b] of [['2026-10-01', '2026-10-31'], ['2026-11-01', '2026-11-02'], ['2026-09-01T20:00:00.000Z', '2026-10-10'], [null, '2026-10-10']]) {
          expect(projectTimeline(a, b, today, zone)).toEqual(web.projectTimeline!(a, b, today, zone));
        }
      }
    }
  });

  it('writes days the website’s way', () => {
    const { code } = transformSync(readFileSync(webParts, 'utf8'), { loader: 'tsx', jsx: 'transform', jsxFactory: '__h', format: 'cjs' });
    const mod = { exports: {} as Record<string, Fn> };
    new Function('module', 'exports', 'require', code)(mod, mod.exports, () => ({}));
    for (const k of ['2026-01-09', '2026-12-31', null, 'bad']) expect(dayText(k)).toBe(mod.exports.dayText!(k));
    for (const n of [-10, -1, 0, 1, 2, 30]) expect(relativeDays(n)).toBe(mod.exports.relativeDays!(n));
  });
});

describe('the project dashboard screen (merge of the two app lanes)', () => {
  const screen = readFileSync(resolve(__dirname, '../screens/ProjectDetailScreen.tsx'), 'utf8');
  it('has New task, starting in this project (4a), and opens the project chat through the one chat hook (3a)', () => {
    expect(screen).toMatch(/<Button title="New task" onPress=\{\(\) => navigation\.navigate\('NewTask', \{ projectId \}\)\}/);
    expect(screen).toMatch(/useOpenProjectChat\(goToChat\)/);
    expect(screen).not.toMatch(/resources\.chat\.openProjectChannel/);
  });
});
