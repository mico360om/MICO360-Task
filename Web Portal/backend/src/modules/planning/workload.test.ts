import { describe, it, expect } from 'vitest';
import { buildWorkload, resolveWorkloadScope, workloadWindow, type Priority, type WorkloadRows, type WorkloadScope, type WorkloadTaskRow } from './workload';

// Wednesday 28 October 2026, 10:00 in Muscat. The week shown starts on Sunday 25 October.
const now = new Date('2026-10-28T06:00:00Z');
const WEEK = '2026-10-25';
const SUN_TO_THU = [0, 1, 2, 3, 4];

const person = (id: string, name: string) => ({ id, name, avatarUrl: null });
const OMAR = person('omar', 'Omar Said');
const SARA = person('sara', 'Sara Ahmed');
const HASSAN = person('hassan', 'Hassan Ahmed');
const RACHEL = person('rachel', 'Rachel Rea Dsouza');
const project = (id: string, name: string) => ({ id, code: id.toUpperCase(), name, color: '#2F6FAE', icon: null, imageUrl: null });
const PROJECTS = [project('rig', 'Rig Inspection Portal'), project('mob', 'Mobile App'), project('fcrm', 'Falcon CRM')];
const TEAMS = [
  { projectId: 'rig', userId: 'omar' },
  { projectId: 'rig', userId: 'hassan' },
  { projectId: 'rig', userId: 'sara' },
  { projectId: 'mob', userId: 'omar' },
  { projectId: 'mob', userId: 'rachel' },
  { projectId: 'fcrm', userId: 'omar' },
];

let seq = 0;
/** An open task due on `day`, assigned to `who`. */
function task(who: string | string[], day: string, extra: Partial<WorkloadTaskRow> = {}): WorkloadTaskRow {
  seq += 1;
  const projectId = extra.projectId ?? 'rig';
  return {
    id: `t${seq}`,
    key: `${projectId.toUpperCase()}-${seq}`,
    title: `Task ${seq}`,
    projectId,
    dueDate: new Date(`${day}T00:00:00.000Z`),
    priority: 'NORMAL',
    isMilestone: false,
    version: 1,
    assigneeIds: Array.isArray(who) ? who : [who],
    ...extra,
  };
}
const many = (n: number, who: string, day: string, extra: Partial<WorkloadTaskRow> = {}) => Array.from({ length: n }, () => task(who, day, extra));

const EVERYONE: WorkloadScope = { kind: 'everyone', projectIds: null };
function rows(tasks: WorkloadTaskRow[], extra: Partial<WorkloadRows> = {}): WorkloadRows {
  return { people: [OMAR, SARA, HASSAN, RACHEL], projects: PROJECTS, tasks, overdue: [], teams: TEAMS, ...extra };
}
const opts = { week: WEEK, timeZone: 'Asia/Muscat', now, limit: 5, workingDays: SUN_TO_THU, viewerId: 'sara', scope: EVERYONE, canChangeLimit: true };
const rowOf = (data: ReturnType<typeof buildWorkload>, id: string) => data.people.find((p) => p.id === id)!;
const cell = (data: ReturnType<typeof buildWorkload>, id: string, day: string) => rowOf(data, id).days.find((d) => d.date === day)!;

describe('resolveWorkloadScope', () => {
  it('lets an administrator see everyone', () => {
    expect(resolveWorkloadScope({ id: 'a', roles: ['ADMIN'] }, { managedProjectIds: ['p1'], visibleProjectIds: null })).toEqual({ kind: 'everyone', projectIds: null });
  });

  it('lets a project manager see the teams of the projects they manage, and only those projects', () => {
    expect(resolveWorkloadScope({ id: 'm', roles: ['EMPLOYEE'] }, { managedProjectIds: ['p1', 'p2'], visibleProjectIds: ['p1', 'p2', 'p3'] })).toEqual({
      kind: 'teams',
      projectIds: ['p1', 'p2'],
    });
  });

  it('shows anyone else only themselves, in the projects they can see', () => {
    expect(resolveWorkloadScope({ id: 'e', roles: ['EMPLOYEE'] }, { managedProjectIds: [], visibleProjectIds: ['p3'] })).toEqual({ kind: 'self', projectIds: ['p3'] });
    expect(resolveWorkloadScope({ id: 'e', roles: [] }, { managedProjectIds: [], visibleProjectIds: null })).toEqual({ kind: 'self', projectIds: [] });
  });
});

describe('workloadWindow', () => {
  it('reads the week and three more weeks after its end (or after today, for a past week)', () => {
    expect(workloadWindow('2026-10-25', '2026-10-28')).toEqual({ from: '2026-10-25', to: '2026-11-21' });
    expect(workloadWindow('2026-10-04', '2026-10-28')).toEqual({ from: '2026-10-04', to: '2026-11-18' });
  });
});

describe('buildWorkload: the table', () => {
  it('gives the seven days, which are working days (company working hours), today and the limit', () => {
    const data = buildWorkload(rows([]), opts);
    expect(data.days).toEqual([
      { date: '2026-10-25', working: true },
      { date: '2026-10-26', working: true },
      { date: '2026-10-27', working: true },
      { date: '2026-10-28', working: true },
      { date: '2026-10-29', working: true },
      { date: '2026-10-30', working: false },
      { date: '2026-10-31', working: false },
    ]);
    expect(data).toMatchObject({ week: WEEK, today: '2026-10-28', limit: 5, canChangeLimit: true, scope: 'everyone', projectId: null, projects: PROJECTS });
  });

  it('counts each person’s open tasks due each day (company time), against the day’s limit', () => {
    const data = buildWorkload(
      rows([
        ...many(3, 'omar', '2026-10-25'),
        ...many(7, 'omar', '2026-10-26'),
        ...many(5, 'omar', '2026-10-27'),
        // 01:00 on Thursday 29 October in Muscat — still Wednesday in UTC.
        task('omar', '2026-10-28', { dueDate: new Date('2026-10-28T21:00:00Z') }),
        task('omar', '2026-11-03'), // next week: not in the table
        task(['omar', 'sara'], '2026-10-27'), // shared: counts for both
      ]),
      opts,
    );
    const omar = rowOf(data, 'omar');
    expect(omar.days.map((d) => [d.count, d.limit, d.over])).toEqual([
      [3, 5, 0],
      [7, 5, 2],
      [6, 5, 1],
      [0, 5, 0],
      [1, 5, 0],
      [0, 0, 0],
      [0, 0, 0],
    ]);
    expect(omar).toMatchObject({ total: 17, weekLimit: 25, me: false });
    expect(rowOf(data, 'sara')).toMatchObject({ total: 1, me: true });
    // Everyone is listed, with or without work.
    expect(data.people.map((p) => p.id)).toEqual(['hassan', 'omar', 'rachel', 'sara']);
    expect(rowOf(data, 'rachel').total).toBe(0);
  });

  it('treats a task due on a day off as over the limit (the limit there is 0)', () => {
    const data = buildWorkload(rows(many(2, 'omar', '2026-10-30')), opts);
    expect(cell(data, 'omar', '2026-10-30')).toMatchObject({ count: 2, limit: 0, over: 2 });
  });

  it('counts overdue tasks: open and due before today', () => {
    const data = buildWorkload(
      rows([], {
        overdue: [
          { userId: 'omar', projectId: 'rig', dueDate: new Date('2026-10-01T00:00:00Z') },
          { userId: 'omar', projectId: 'mob', dueDate: new Date('2026-10-27T00:00:00Z') },
          { userId: 'omar', projectId: 'mob', dueDate: new Date('2026-10-28T00:00:00Z') }, // today: not overdue
          { userId: 'sara', projectId: 'rig', dueDate: new Date('2026-10-20T00:00:00Z') },
        ],
      }),
      opts,
    );
    expect([rowOf(data, 'omar').overdue, rowOf(data, 'sara').overdue, rowOf(data, 'hassan').overdue]).toEqual([2, 1, 0]);
  });

  it('narrowed to a project: counts only its tasks, and lists its team and whoever has its tasks', () => {
    const data = buildWorkload(
      rows(
        [...many(4, 'omar', '2026-10-28', { projectId: 'mob' }), ...many(3, 'omar', '2026-10-28', { projectId: 'rig' }), task('sara', '2026-10-28', { projectId: 'mob' })],
        { overdue: [{ userId: 'omar', projectId: 'rig', dueDate: new Date('2026-10-01T00:00:00Z') }] },
      ),
      { ...opts, projectId: 'mob' },
    );
    expect(data.projectId).toBe('mob');
    // Mobile App's team is Omar and Rachel; Sara has one of its tasks.
    expect(data.people.map((p) => p.id)).toEqual(['omar', 'rachel', 'sara']);
    expect(cell(data, 'omar', '2026-10-28').count).toBe(4);
    expect(rowOf(data, 'omar').overdue).toBe(0);
  });

  it('ignores a project outside the asker’s scope', () => {
    expect(buildWorkload(rows([]), { ...opts, projectId: 'elsewhere' }).projectId).toBeNull();
  });
});

describe('buildWorkload: suggestions', () => {
  const titled = (who: string, day: string, key: string, projectId: string, priority: Priority = 'NORMAL', extra: Partial<WorkloadTaskRow> = {}) =>
    task(who, day, { key, title: key, projectId, priority, ...extra });

  it('suggests as many tasks as the day is over: least-busy teammate on the task’s project, or the next lighter working day', () => {
    const data = buildWorkload(
      rows([
        titled('omar', '2026-10-28', 'RIG-14', 'rig', 'LOW'),
        titled('omar', '2026-10-28', 'MOB-8', 'mob', 'LOW'),
        titled('omar', '2026-10-28', 'FCRM-3', 'fcrm', 'LOW'),
        titled('omar', '2026-10-28', 'RIG-15', 'rig', 'NORMAL'),
        titled('omar', '2026-10-28', 'RIG-16', 'rig', 'HIGH'),
        titled('omar', '2026-10-28', 'MOB-9', 'mob', 'URGENT'),
        titled('omar', '2026-10-28', 'FCRM-4', 'fcrm', 'LOW', { isMilestone: true }),
        titled('omar', '2026-10-28', 'RIG-17', 'rig', 'NORMAL'),
        ...many(2, 'hassan', '2026-10-28'),
        ...many(5, 'sara', '2026-10-28'),
        ...many(3, 'omar', '2026-10-29'),
      ]),
      opts,
    );
    const wed = cell(data, 'omar', '2026-10-28');
    expect(wed).toMatchObject({ count: 8, limit: 5, over: 3 });
    // Lowest priority first, milestones last; Falcon CRM has nobody else, so its task moves.
    expect(wed.tasks.slice(0, 3).map((t) => [t.key, t.suggestion])).toEqual([
      ['FCRM-3', { kind: 'move', date: '2026-10-29', count: 3 }],
      ['MOB-8', { kind: 'reassign', to: { id: 'rachel', name: 'Rachel Rea Dsouza' }, count: 0 }],
      // Hassan (2) has more room than Sara (5, at the limit).
      ['RIG-14', { kind: 'reassign', to: { id: 'hassan', name: 'Hassan Ahmed' }, count: 2 }],
    ]);
    // The rest, most urgent first, with no suggestion.
    expect(wed.tasks.slice(3).map((t) => [t.key, t.suggestion])).toEqual([
      ['MOB-9', null],
      ['RIG-16', null],
      ['RIG-15', null],
      ['RIG-17', null],
      ['FCRM-4', null],
    ]);
    // A day at or under the limit gets no suggestions.
    expect(cell(data, 'sara', '2026-10-28').tasks.every((t) => t.suggestion === null)).toBe(true);
  });

  it('counts the suggestions already made, so one teammate or day is not filled past the limit', () => {
    const data = buildWorkload(
      rows([
        ...many(7, 'omar', '2026-10-28', { priority: 'LOW' }),
        ...many(4, 'hassan', '2026-10-28'),
        ...many(5, 'sara', '2026-10-28'),
        ...many(4, 'omar', '2026-10-29'),
      ]),
      opts,
    );
    const suggestions = cell(data, 'omar', '2026-10-28').tasks.slice(0, 2).map((t) => t.suggestion);
    expect(suggestions).toEqual([
      { kind: 'reassign', to: { id: 'hassan', name: 'Hassan Ahmed' }, count: 4 },
      // Hassan is now at the limit, Thursday has room for one, Friday and Saturday are days off.
      { kind: 'move', date: '2026-10-29', count: 4 },
    ]);
  });

  it('never suggests someone already on the task, someone off the project’s team, or a person not shown', () => {
    const data = buildWorkload(
      rows(
        [
          ...many(5, 'omar', '2026-10-28'),
          task(['omar', 'hassan'], '2026-10-28', { key: 'RIG-50', title: 'RIG-50', priority: 'LOW' }),
          task('omar', '2026-10-28', { key: 'MOB-50', title: 'MOB-50', projectId: 'mob', priority: 'LOW' }),
        ],
        // Rachel is on Mobile App's team but no longer active, so she isn't among the people.
        { people: [OMAR, SARA, HASSAN] },
      ),
      opts,
    );
    const wed = cell(data, 'omar', '2026-10-28');
    expect(wed.over).toBe(2);
    const byKey = Object.fromEntries(wed.tasks.map((t) => [t.key, t.suggestion]));
    // Hassan is already on RIG-50: Sara (0) takes it.
    expect(byKey['RIG-50']).toEqual({ kind: 'reassign', to: { id: 'sara', name: 'Sara Ahmed' }, count: 0 });
    // Nobody else on Mobile App is shown: the task moves.
    expect(byKey['MOB-50']).toEqual({ kind: 'move', date: '2026-10-29', count: 0 });
  });

  it('on a day off or a past day only moves tasks, to today or later', () => {
    const data = buildWorkload(
      rows([
        task('omar', '2026-10-30', { key: 'RIG-60', title: 'RIG-60' }),
        ...many(6, 'omar', '2026-10-26', { priority: 'LOW' }),
        ...many(5, 'omar', '2026-10-28'),
      ]),
      opts,
    );
    // Friday is a day off: to the next working day, Sunday 1 November (Thursday is closer but before it).
    expect(cell(data, 'omar', '2026-10-30').tasks[0]!.suggestion).toEqual({ kind: 'move', date: '2026-11-01', count: 0 });
    // Monday has passed: not given to Hassan for a day that is over, but moved to the first day from today with room.
    expect(cell(data, 'omar', '2026-10-26').tasks[0]!.suggestion).toEqual({ kind: 'move', date: '2026-10-29', count: 0 });
  });

  it('suggests only moves to someone who sees only their own row', () => {
    const data = buildWorkload(rows([...many(6, 'sara', '2026-10-28', { priority: 'LOW' })], { people: [SARA] }), {
      ...opts,
      scope: { kind: 'self', projectIds: ['rig', 'mob', 'fcrm'] },
    });
    expect(cell(data, 'sara', '2026-10-28').tasks[0]!.suggestion).toEqual({ kind: 'move', date: '2026-10-29', count: 0 });
  });

  it('weighs a teammate by everything they have that day, even when the page is narrowed to a project', () => {
    const data = buildWorkload(
      rows([
        ...many(6, 'omar', '2026-10-28', { projectId: 'rig', priority: 'LOW' }),
        ...many(4, 'hassan', '2026-10-28', { projectId: 'mob' }), // Hassan's other project
        task('sara', '2026-10-28', { projectId: 'rig' }),
      ]),
      { ...opts, projectId: 'rig' },
    );
    expect(cell(data, 'hassan', '2026-10-28').count).toBe(0);
    expect(cell(data, 'omar', '2026-10-28').tasks[0]!.suggestion).toEqual({ kind: 'reassign', to: { id: 'sara', name: 'Sara Ahmed' }, count: 1 });
  });

  it('gives no suggestion when no teammate has room and no lighter day comes within three weeks', () => {
    const busy = ['2026-10-29', '2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-08', '2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-15', '2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19'];
    const data = buildWorkload(
      rows([task('omar', '2026-10-28', { projectId: 'fcrm' }), ...many(5, 'omar', '2026-10-28', { projectId: 'fcrm' }), ...busy.flatMap((d) => many(5, 'omar', d, { projectId: 'fcrm' }))]),
      opts,
    );
    expect(cell(data, 'omar', '2026-10-28').tasks.every((t) => t.suggestion === null)).toBe(true);
  });
});
