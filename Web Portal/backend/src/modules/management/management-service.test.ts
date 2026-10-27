import { describe, it, expect } from 'vitest';
import { HttpError } from '../../lib/http-errors';
import { createManagementService, type ManagementFilters } from './management-service';
import { fakeManagementSource, fakeWorkloadFor, type FakeManagementData } from './management-source.fixture';

const TZ = 'Asia/Muscat';
// Tuesday 27 October 2026, 10:00 in Muscat. The company week starts on Sunday (25 October).
const NOW = new Date('2026-10-27T06:00:00.000Z');

const STRUCTURE = { sections: [{ id: 's1', title: 'Valves', items: [{ id: 'valve', kind: 'CHECK', label: 'Valve sealed' }, { id: 'hose', kind: 'CHECK', label: 'Hose intact' }] }] };

const DATA: FakeManagementData = {
  users: [
    { id: 'sara', name: 'Sara Ahmed' },
    { id: 'omar', name: 'Omar Ahmed' },
    { id: 'bilal', name: 'Bilal Ahmed' },
    { id: 'zara', name: 'Zara Ahmed' },
    { id: 'nadia', name: 'Nadia Ahmed' },
  ],
  projects: [
    { id: 'rig', name: 'Rig Inspection Portal', status: 'ACTIVE', managerId: 'sara', members: ['bilal', 'zara'] },
    { id: 'mico', name: 'MICO360 Platform', status: 'ACTIVE', ownerId: 'omar', members: ['bilal'] },
    { id: 'fin', name: 'Finance Automation', status: 'PLANNING', managerId: 'sara', members: ['sara'] },
    { id: 'old', name: 'Old Works', status: 'ARCHIVED', managerId: 'sara' },
    { id: 'gone', name: 'Deleted Project', status: 'ACTIVE', managerId: 'sara', deleted: true },
    { id: 'idle', name: 'Idle Yard', status: 'ACTIVE', ownerId: 'omar', updatedAt: new Date('2026-10-01T08:00:00.000Z') },
  ],
  tasks: [
    // RIG: a late milestone, today's and tomorrow's work, a done task, seven checks and two follow-ups.
    { id: 'r1', projectId: 'rig', title: 'Handover', due: '2026-10-24', milestone: true, assignees: ['bilal'] },
    { id: 'r2', projectId: 'rig', due: '2026-10-27', assignees: ['bilal'], createdAt: '2026-10-26T05:00:00.000Z' },
    { id: 'r3', projectId: 'rig', due: '2026-10-28', assignees: ['bilal'] },
    { id: 'r4', projectId: 'rig', due: '2026-10-20', completedAt: '2026-10-20T09:00:00.000Z' },
    { id: 'rx', projectId: 'rig', due: '2026-10-01', deleted: true, assignees: ['bilal'] },
    { id: 'c1', projectId: 'rig', formId: 'F1', due: '2026-10-20', completedAt: '2026-10-20T08:00:00.000Z', report: true },
    { id: 'c2', projectId: 'rig', formId: 'F1', due: '2026-10-21', completedAt: '2026-10-23T08:00:00.000Z', report: true },
    { id: 'c3', projectId: 'rig', formId: 'F1', due: '2026-10-22', assignees: ['zara'] },
    { id: 'c4', projectId: 'rig', formId: 'F1', due: '2026-10-23', assignees: ['zara'] },
    { id: 'c5', projectId: 'rig', formId: 'F1', due: '2026-10-26', assignees: ['zara'] },
    { id: 'c6', projectId: 'rig', formId: 'F1', due: '2026-10-25', completedAt: '2026-10-25T08:00:00.000Z', report: false },
    { id: 'c7', projectId: 'rig', formId: 'F1', due: '2026-10-27', assignees: ['zara'] },
    { id: 'f1', projectId: 'rig', due: '2026-10-30', followUp: true },
    { id: 'f2', projectId: 'rig', due: '2026-10-22', followUp: true, completedAt: '2026-10-21T08:00:00.000Z' },
    // MICO: one late task, Wednesday overloaded for Bilal (with RIG's r3), the next milestone, one done.
    { id: 'm1', projectId: 'mico', due: '2026-10-26', assignees: ['bilal'] },
    { id: 'm2', projectId: 'mico', due: '2026-10-28', assignees: ['bilal'], createdAt: '2026-10-19T05:00:00.000Z' },
    { id: 'm3', projectId: 'mico', due: '2026-10-28', assignees: ['bilal'] },
    { id: 'm4', projectId: 'mico', due: '2026-10-28', assignees: ['bilal'] },
    { id: 'm5', projectId: 'mico', title: 'Launch', due: '2026-11-15', milestone: true },
    { id: 'm6', projectId: 'mico', completedAt: '2026-10-26T08:00:00.000Z' },
    { id: 'fn1', projectId: 'fin', due: '2026-11-02', assignees: ['sara'] },
    { id: 'o1', projectId: 'old', due: '2026-10-01', assignees: ['zara'] },
    { id: 'g1', projectId: 'gone', due: '2026-10-01', assignees: ['zara'] },
    { id: 'i1', projectId: 'idle', due: '2026-11-30', updatedAt: '2026-10-01T08:00:00.000Z' },
  ],
  inspections: [
    { id: 'in1', projectId: 'rig', formId: 'F1', title: 'Rig daily check', finishedAt: '2026-10-20T08:00:00.000Z', passed: 8, failed: 2, failedItems: ['valve', 'hose'], structure: STRUCTURE },
    { id: 'in2', projectId: 'rig', formId: 'F1', title: 'Rig daily check', finishedAt: '2026-10-26T08:00:00.000Z', passed: 9, failed: 1, failedItems: ['valve'], structure: STRUCTURE },
    { id: 'in3', projectId: 'mico', formId: 'F2', title: 'Fire extinguisher', finishedAt: '2026-10-13T08:00:00.000Z', passed: 5, failed: 0 },
    { id: 'in4', projectId: 'rig', formId: 'F1', title: 'Rig daily check', finishedAt: '2026-07-01T08:00:00.000Z', passed: 0, failed: 1, failedItems: ['hose'] },
  ],
  actions: [
    { id: 'a1', projectId: 'rig', assigneeId: 'zara', due: '2026-10-20', meetingId: 'mt1' },
    { id: 'a2', projectId: 'rig', assigneeId: 'zara', due: '2026-11-05', meetingId: 'mt1' },
    { id: 'a3', projectId: 'mico', assigneeId: 'bilal', meetingId: 'mt2' },
    { id: 'a4', projectId: 'rig', assigneeId: 'zara', open: false },
    { id: 'a5', projectId: 'gone', assigneeId: 'zara' },
  ],
};

const ADMIN = { id: 'admin', roles: ['ADMIN'] };
const SARA = { id: 'sara', roles: ['EMPLOYEE'] };
const NADIA = { id: 'nadia', roles: ['EMPLOYEE'] };
const filters = (over: Partial<ManagementFilters> = {}): ManagementFilters => ({ projectIds: [], ownerId: null, statuses: ['PLANNING', 'ACTIVE', 'ON_HOLD'], weeks: 12, ...over });

function service(data: FakeManagementData = DATA, weekStart: 0 | 1 | 6 = 0) {
  const source = fakeManagementSource(data);
  return {
    source,
    svc: createManagementService({
      source,
      workload: fakeWorkloadFor(data),
      settings: { companyWeekStart: async () => weekStart, workingHours: async () => ({ days: [0, 1, 2, 3, 4] }), dailyLimit: async () => 2 },
      timeZone: TZ,
      now: () => NOW,
    }),
  };
}
const status = async (p: Promise<unknown>) => {
  try {
    await p;
    return 200;
  } catch (e) {
    return e instanceof HttpError ? e.status : 500;
  }
};

describe('who may see the Management page', () => {
  it('administrators see every project; project runners theirs; anyone else nothing', async () => {
    const { svc } = service();
    expect(await svc.access(ADMIN)).toEqual({ allowed: true, scope: 'ALL' });
    expect(await svc.access(SARA)).toEqual({ allowed: true, scope: 'RUN' });
    expect(await svc.access(NADIA)).toEqual({ allowed: false, scope: null });
    expect(await status(svc.overview(NADIA, filters()))).toBe(403);
    expect(await status(svc.items(NADIA, filters(), { metric: 'late-tasks' }))).toBe(403);
  });

  it('an administrator gets every live project still going (not deleted; completed and archived only when chosen)', async () => {
    const { svc } = service();
    const o = await svc.overview(ADMIN, filters());
    expect(o.scope).toBe('ALL');
    expect(o.projects.map((p) => p.id)).toEqual(['rig', 'mico', 'idle', 'fin']);
    const withArchived = await svc.overview(ADMIN, filters({ statuses: ['ACTIVE', 'ARCHIVED'] }));
    expect(withArchived.projects.map((p) => p.id).sort()).toEqual(['idle', 'mico', 'old', 'rig']);
    // The pickers offer every live project the person can see, whatever the filters.
    expect(o.options.projects.map((p) => p.id).sort()).toEqual(['fin', 'idle', 'mico', 'old', 'rig']);
    expect(o.options.owners).toEqual([{ id: 'omar', name: 'Omar Ahmed' }]);
  });

  it('a project runner gets only the projects they run, and can never ask for another project by its id', async () => {
    const { svc } = service();
    const o = await svc.overview(SARA, filters());
    expect(o.scope).toBe('RUN');
    expect(o.projects.map((p) => p.id)).toEqual(['rig', 'fin']);
    expect(o.options.projects.map((p) => p.id).sort()).toEqual(['fin', 'old', 'rig']);
    expect(await status(svc.overview(SARA, filters({ projectIds: ['mico'] })))).toBe(404);
    expect(await status(svc.overview(SARA, filters({ projectIds: ['gone'] })))).toBe(404);
    expect(await status(svc.items(SARA, filters(), { metric: 'late-tasks', projectId: 'mico' }))).toBe(404);
    // One of theirs that the status filter leaves out is simply not shown.
    expect((await svc.overview(SARA, filters({ projectIds: ['old'] }))).projects).toEqual([]);
    expect((await svc.overview(SARA, filters({ projectIds: ['fin'] }))).projects.map((p) => p.id)).toEqual(['fin']);
  });

  it('narrows to one owner', async () => {
    const { svc } = service();
    expect((await svc.overview(ADMIN, filters({ ownerId: 'omar' }))).projects.map((p) => p.id)).toEqual(['mico', 'idle']);
  });
});

describe('the overview', () => {
  it('rates each project red / amber / green with its reasons, worst first', async () => {
    const { svc } = service();
    const o = await svc.overview(ADMIN, filters());
    const rig = o.projects[0]!;
    expect(rig).toMatchObject({ id: 'rig', rag: 'RED', total: 13, done: 5, open: 8, late: 4, completionPct: 38, missingChecks: 3, lateMilestones: 1, openFollowUps: 1, checksDue: 7, checksDone: 3 });
    expect(rig.reasons.map((r) => r.text)).toEqual(['Milestone “Handover” is 3 days late', '4 of 8 open tasks are late', '3 missing checks']);
    expect(rig.nextMilestone).toEqual({ id: 'r1', key: 'R1', title: 'Handover', due: '2026-10-24', daysLeft: -3 });
    const mico = o.projects[1]!;
    expect(mico).toMatchObject({ id: 'mico', rag: 'AMBER', late: 1, completionPct: 17, owner: { id: 'omar', name: 'Omar Ahmed' } });
    expect(mico.reasons.map((r) => r.text)).toEqual(['1 late task']);
    expect(mico.nextMilestone).toMatchObject({ title: 'Launch', due: '2026-11-15', daysLeft: 19 });
    expect(o.projects[2]).toMatchObject({ id: 'idle', rag: 'AMBER', reasons: [{ code: 'NO_ACTIVITY', text: 'No activity for 26 days' }] });
    expect(o.projects[3]).toMatchObject({ id: 'fin', rag: 'GREEN', reasons: [{ text: 'On track' }], nextMilestone: null });
  });

  it('adds up the headline numbers', async () => {
    const { svc } = service();
    const o = await svc.overview(ADMIN, filters());
    expect(o.tiles).toEqual({
      projects: 4,
      red: 1,
      amber: 2,
      green: 1,
      lateTasks: 5,
      missingChecks: 3,
      checksDue: 7,
      checksDone: 3,
      checksDoneLate: 1,
      passRate: 88,
      openFollowUps: 1,
      overloadedPeople: 1,
    });
    expect(o.period).toEqual({ from: '2026-08-09', to: '2026-10-27', weeks: 12 });
    expect(o.today).toBe('2026-10-27');
  });

  it('inspections: checks done vs due, late and missing, closed without a report, pass rate, most-failed items and forms', async () => {
    const { svc } = service();
    const { inspections } = await svc.overview(ADMIN, filters());
    expect(inspections).toMatchObject({ due: 7, done: 3, doneLate: 1, noReport: 1, missing: 3, finished: 3, passed: 22, failed: 3, passRate: 88, openFollowUps: 1 });
    expect(inspections.topItems).toEqual([
      { formId: 'F1', itemId: 'valve', label: 'Valve sealed', formTitle: 'Rig daily check', failures: 2 },
      { formId: 'F1', itemId: 'hose', label: 'Hose intact', formTitle: 'Rig daily check', failures: 1 },
    ]);
    expect(inspections.topForms).toEqual([{ formId: 'F1', title: 'Rig daily check', finished: 2, withFailures: 2, failedItems: 3 }]);
  });

  it('people: late work, overloaded days this week (the Workload limit, working days) and open action items', async () => {
    const { svc } = service();
    const o = await svc.overview(ADMIN, filters());
    expect(o.workload).toEqual({ week: '2026-10-25', limit: 2, workingDays: [0, 1, 2, 3, 4] });
    expect(o.people.map((p) => p.id)).toEqual(['zara', 'bilal']);
    expect(o.people[0]).toMatchObject({ name: 'Zara Ahmed', lateTasks: 3, overloadedDays: [], openActions: 2, overdueActions: 1 });
    expect(o.people[1]).toMatchObject({ name: 'Bilal Ahmed', lateTasks: 2, overloadedDays: [{ date: '2026-10-28', count: 4, limit: 2 }], openActions: 1, overdueActions: 0 });
    // Sara runs RIG and FIN only: Bilal's MICO work isn't hers to see, so his Wednesday is not over there.
    const mine = await svc.overview(SARA, filters());
    expect(mine.people.find((p) => p.id === 'bilal')).toMatchObject({ lateTasks: 1, overloadedDays: [] });
  });

  it('trends: a row per company week (the current one last) with created, completed, late and the pass rate', async () => {
    const { svc, source } = service();
    const o = await svc.overview(ADMIN, filters({ weeks: 4 }));
    expect(source.calls).toContain('trend:4');
    expect(o.trends.map((w) => w.start)).toEqual(['2026-10-04', '2026-10-11', '2026-10-18', '2026-10-25']);
    expect(o.trends.map((w) => w.passRate)).toEqual([null, 100, 80, 90]);
    expect(o.trends.map((w) => w.created)).toEqual([0, 0, 1, 1]);
    expect(o.trends[2]).toMatchObject({ completed: 4, late: 2, current: false });
    expect(o.trends[3]).toMatchObject({ late: 5, current: true });
    // The period follows the range: the July inspection only counts over 26 weeks.
    expect(o.inspections.finished).toBe(3);
    expect((await svc.overview(ADMIN, filters({ weeks: 26 }))).inspections.finished).toBe(4);
  });

  it('follows the company week start (Monday)', async () => {
    const { svc } = service(DATA, 1);
    const o = await svc.overview(ADMIN, filters({ weeks: 4 }));
    expect(o.trends.map((w) => w.start)).toEqual(['2026-10-05', '2026-10-12', '2026-10-19', '2026-10-26']);
    expect(o.workload.week).toBe('2026-10-26');
    expect(o.weekStart).toBe(1);
  });

  it('with no project in scope: empty sections, never an error', async () => {
    const { svc } = service();
    const o = await svc.overview(ADMIN, filters({ statuses: ['COMPLETED'] }));
    expect(o.projects).toEqual([]);
    expect(o.tiles).toMatchObject({ projects: 0, lateTasks: 0, passRate: null });
    expect(o.people).toEqual([]);
  });
});

describe('the lists behind the numbers (always inside the caller’s scope)', () => {
  it('late tasks: of a project, of a person, most overdue first', async () => {
    const { svc } = service();
    const rig = await svc.items(ADMIN, filters(), { metric: 'late-tasks', projectId: 'rig' });
    expect(rig.total).toBe(4);
    expect(rig.rows.map((r) => r.id)).toEqual(['c3', 'c4', 'r1', 'c5']);
    expect(rig.rows[0]).toMatchObject({ kind: 'task', key: 'C3', due: '2026-10-22', daysLate: 5, project: { id: 'rig', name: 'Rig Inspection Portal' }, people: ['Zara Ahmed'] });
    expect(rig.title).toBe('Late tasks · Rig Inspection Portal');
    const zara = await svc.items(ADMIN, filters(), { metric: 'late-tasks', personId: 'zara' });
    expect(zara.rows.map((r) => r.id)).toEqual(['c3', 'c4', 'c5']);
    expect(zara.title).toBe('Late tasks · Zara Ahmed');
    // Archived OLD is not in the default filters, so its late task isn’t either.
    expect((await svc.items(ADMIN, filters({ statuses: ['ARCHIVED'] }), { metric: 'late-tasks', personId: 'zara' })).rows.map((r) => r.id)).toEqual(['o1']);
  });

  it('checks: missing, done late, closed without a report, due and done in the period', async () => {
    const { svc } = service();
    const ids = async (metric: string) => (await svc.items(ADMIN, filters(), { metric })).rows.map((r) => r.id);
    expect(await ids('missing-checks')).toEqual(['c3', 'c4', 'c5']);
    expect(await ids('checks-done-late')).toEqual(['c2']);
    expect(await ids('checks-no-report')).toEqual(['c6']);
    expect(await ids('checks-done')).toEqual(['c1', 'c2', 'c6']);
    expect(await ids('checks-due')).toEqual(['c1', 'c2', 'c3', 'c4', 'c6', 'c5', 'c7']);
    const late = await svc.items(ADMIN, filters(), { metric: 'checks-done-late' });
    expect(late.rows[0]).toMatchObject({ detail: 'Done 2 days late', tone: 'warning' });
  });

  it('follow-ups, late milestones, inspections in the period, where an item failed', async () => {
    const { svc } = service();
    expect((await svc.items(ADMIN, filters(), { metric: 'follow-ups' })).rows.map((r) => r.id)).toEqual(['f1']);
    expect((await svc.items(ADMIN, filters(), { metric: 'late-milestones' })).rows.map((r) => r.id)).toEqual(['r1']);
    const insp = await svc.items(ADMIN, filters(), { metric: 'inspections' });
    expect(insp.rows.map((r) => [r.id, r.kind, r.detail])).toEqual([
      ['in2', 'inspection', '9 passed · 1 failed'],
      ['in1', 'inspection', '8 passed · 2 failed'],
      ['in3', 'inspection', '5 passed · 0 failed'],
    ]);
    const valve = await svc.items(ADMIN, filters(), { metric: 'failed-item', formId: 'F1', itemId: 'valve' });
    expect(valve.rows.map((r) => r.id)).toEqual(['in2', 'in1']);
    expect(valve.title).toBe('“Valve sealed” failed');
  });

  it("a person's overloaded days (their tasks those days) and open action items, inside the scope", async () => {
    const { svc } = service();
    const over = await svc.items(ADMIN, filters(), { metric: 'person-overloaded', personId: 'bilal' });
    expect(over.rows.map((r) => r.id).sort()).toEqual(['m2', 'm3', 'm4', 'r3']);
    expect(over.rows[0]!.detail).toBe('Wed 28 Oct: 4 due (limit 2)');
    expect((await svc.items(SARA, filters(), { metric: 'person-overloaded', personId: 'bilal' })).rows).toEqual([]);
    const actions = await svc.items(ADMIN, filters(), { metric: 'person-actions', personId: 'zara' });
    expect(actions.rows.map((r) => [r.id, r.kind, r.meetingId, r.tone])).toEqual([
      ['a1', 'action', 'mt1', 'danger'],
      ['a2', 'action', 'mt1', 'neutral'],
    ]);
  });

  it('projects by their mark, and people overloaded this week', async () => {
    const { svc } = service();
    const red = await svc.items(ADMIN, filters(), { metric: 'projects', rag: 'RED' });
    expect(red.rows.map((r) => [r.id, r.kind])).toEqual([['rig', 'project']]);
    expect(red.rows[0]!.detail).toContain('3 missing checks');
    const amber = await svc.items(ADMIN, filters(), { metric: 'projects', rag: 'AMBER' });
    expect(amber.rows.map((r) => r.id)).toEqual(['mico', 'idle']);
    const people = await svc.items(ADMIN, filters(), { metric: 'people-overloaded' });
    expect(people.rows.map((r) => [r.id, r.kind])).toEqual([['bilal', 'person']]);
  });

  it('refuses an unknown list, a person list without a person, and a failed item without its item', async () => {
    const { svc } = service();
    expect(await status(svc.items(ADMIN, filters(), { metric: 'everything' }))).toBe(400);
    expect(await status(svc.items(ADMIN, filters(), { metric: 'person-overloaded' }))).toBe(400);
    expect(await status(svc.items(ADMIN, filters(), { metric: 'failed-item', formId: 'F1' }))).toBe(400);
  });
});

describe('the weekly summary’s figures (each person’s own scope)', () => {
  it('red and amber counts with the worst projects, late tasks, missing checks, last week’s checks and pass rate, and who has the most late work', async () => {
    const { svc } = service();
    const d = await svc.digest(SARA);
    expect(d).not.toBeNull();
    expect(d!).toMatchObject({ projects: 2, red: 1, amber: 0, lateTasks: 4, missingChecks: 3, doneLateLastWeek: 1, passRateLastWeek: 80, lastWeek: { start: '2026-10-18', end: '2026-10-24' } });
    expect(d!.worst.map((p) => [p.name, p.rag, p.reasons.length])).toEqual([['Rig Inspection Portal', 'RED', 3]]);
    expect(d!.mostLate).toEqual([
      { id: 'zara', name: 'Zara Ahmed', lateTasks: 3 },
      { id: 'bilal', name: 'Bilal Ahmed', lateTasks: 1 },
    ]);
    const all = await svc.digest(ADMIN);
    expect(all!.worst.map((p) => p.id)).toEqual(['rig', 'mico', 'idle']);
  });

  it('is null for someone with nothing in scope', async () => {
    const { svc } = service({ ...DATA, projects: DATA.projects.map((p) => (p.managerId === 'sara' ? { ...p, status: 'COMPLETED' as const } : p)) });
    expect(await svc.digest(SARA)).toBeNull();
    expect(await svc.digest(NADIA)).toBeNull();
  });
});
