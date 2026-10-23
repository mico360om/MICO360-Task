import { describe, it, expect } from 'vitest';
import { loadWorkload } from './workload-service';
import { resolveWorkloadScope } from './workload';
import { fakeWorkloadStore, type FakeCompany } from './workload-store.fixture';

// Wednesday 28 October 2026 in Muscat; the week shown starts on Sunday 25 October.
const TODAY = '2026-10-28';
const WEEK = '2026-10-25';
const TZ = 'Asia/Muscat';

/**
 * Sara manages Rig (its manager). Omar and Hassan are on Rig; Omar and Sara are also on Mobile App
 * (Sara only as a member); Hassan works on Secret, which Sara can't see; Yusuf is on Mobile App;
 * Layla is deactivated. Old Website is completed, Archive is archived.
 */
const COMPANY: FakeCompany = {
  users: [
    { id: 'admin', name: 'Aisha Khan' },
    { id: 'sara', name: 'Sara Ahmed' },
    { id: 'omar', name: 'Omar Said' },
    { id: 'hassan', name: 'Hassan Ahmed' },
    { id: 'yusuf', name: 'Yusuf Ali' },
    { id: 'layla', name: 'Layla Noor', active: false },
  ],
  projects: [
    { id: 'rig', managerId: 'sara' },
    { id: 'mob', ownerId: 'admin' },
    { id: 'secret' },
    { id: 'old', status: 'COMPLETED', managerId: 'yusuf' },
    { id: 'arch', status: 'ARCHIVED' },
  ],
  members: [
    { projectId: 'rig', userId: 'omar' },
    { projectId: 'rig', userId: 'hassan' },
    { projectId: 'rig', userId: 'layla' },
    { projectId: 'mob', userId: 'omar' },
    { projectId: 'mob', userId: 'sara' },
    { projectId: 'mob', userId: 'yusuf' },
    { projectId: 'secret', userId: 'hassan' },
  ],
  tasks: [
    { id: 'rig-omar', projectId: 'rig', due: '2026-10-28', assignees: ['omar'] },
    { id: 'rig-hassan', projectId: 'rig', due: '2026-10-29', assignees: ['hassan'] },
    { id: 'rig-sara', projectId: 'rig', due: '2026-10-27', assignees: ['sara'] },
    { id: 'mob-omar', projectId: 'mob', due: '2026-10-28', assignees: ['omar'] },
    { id: 'mob-sara', projectId: 'mob', due: '2026-10-26', assignees: ['sara'] },
    { id: 'mob-yusuf-omar', projectId: 'mob', due: '2026-10-28', assignees: ['yusuf', 'omar'] },
    { id: 'secret-hassan', projectId: 'secret', due: '2026-10-28', assignees: ['hassan'] },
    { id: 'old-omar', projectId: 'old', due: '2026-10-28', assignees: ['omar'] },
    { id: 'arch-omar', projectId: 'arch', due: '2026-10-28', assignees: ['omar'] },
    { id: 'done-omar', projectId: 'rig', due: '2026-10-28', assignees: ['omar'], open: false },
    { id: 'next-month', projectId: 'rig', due: '2026-12-20', assignees: ['omar'] },
    // Overdue: before today.
    { id: 'late-rig-omar', projectId: 'rig', due: '2026-10-01', assignees: ['omar'] },
    { id: 'late-mob-omar', projectId: 'mob', due: '2026-10-02', assignees: ['omar'] },
    { id: 'late-mob-sara', projectId: 'mob', due: '2026-10-03', assignees: ['sara'] },
  ],
};

const scopeFor = async (store: ReturnType<typeof fakeWorkloadStore>, id: string, roles: string[], visible: string[] | null) =>
  resolveWorkloadScope({ id, roles }, { managedProjectIds: roles.includes('ADMIN') ? [] : await store.managedProjectIds(id), visibleProjectIds: visible });
const ids = (list: { id: string }[]) => list.map((x) => x.id).sort();
const shownFor = (tasks: { id: string; rowsFor?: string[]; assigneeIds: string[] }[]) => Object.fromEntries(tasks.map((t) => [t.id, (t.rowsFor ?? t.assigneeIds).slice().sort()]));

describe('loadWorkload: who sees what', () => {
  it('an administrator: every active person, the tasks of open projects (not completed or archived) in the shown week', async () => {
    const store = fakeWorkloadStore(COMPANY);
    const scope = await scopeFor(store, 'admin', ['ADMIN'], null);
    const { rows } = await loadWorkload(store, { scope, viewerId: 'admin', projectId: null, week: WEEK, today: TODAY, timeZone: TZ });
    expect(ids(rows.people)).toEqual(['admin', 'hassan', 'omar', 'sara', 'yusuf']);
    expect(ids(rows.projects)).toEqual(['mob', 'rig', 'secret']);
    expect(ids(rows.tasks)).toEqual(['mob-omar', 'mob-sara', 'mob-yusuf-omar', 'rig-hassan', 'rig-omar', 'rig-sara', 'secret-hassan']);
    // Sara's tasks due on the 26th and 27th are overdue too.
    expect(rows.overdue.sort((a, b) => a.userId.localeCompare(b.userId))).toEqual([
      { userId: 'omar', count: 2 },
      { userId: 'sara', count: 3 },
    ]);
  });

  it('a project manager: the team of the projects they manage with only those projects’ tasks — and their own tasks everywhere they can see', async () => {
    const store = fakeWorkloadStore(COMPANY);
    const scope = await scopeFor(store, 'sara', ['EMPLOYEE'], ['rig', 'mob']);
    expect(scope).toEqual({ kind: 'teams', projectIds: ['rig'], ownProjectIds: ['rig', 'mob'] });
    const { rows } = await loadWorkload(store, { scope, viewerId: 'sara', projectId: null, week: WEEK, today: TODAY, timeZone: TZ });
    expect(ids(rows.people)).toEqual(['hassan', 'omar', 'sara']); // not the deactivated member, not Yusuf (Mobile App only)
    expect(ids(rows.projects)).toEqual(['rig']);
    // Omar's Mobile App task and Hassan's Secret task are not shown; Sara's own Mobile App task is, on her row only.
    expect(shownFor(rows.tasks)).toEqual({ 'rig-omar': ['omar'], 'rig-hassan': ['hassan'], 'rig-sara': ['sara'], 'mob-sara': ['sara'] });
    // Overdue: Omar's Rig task (not his Mobile App one); Sara's Rig task and her own two Mobile App ones.
    expect(rows.overdue.sort((a, b) => a.userId.localeCompare(b.userId))).toEqual([
      { userId: 'omar', count: 1 },
      { userId: 'sara', count: 3 },
    ]);
    // Suggestions weigh everyone's whole load (never shown): Hassan's Secret task and Omar's Mobile App ones count.
    const day28 = rows.loads.filter((l) => l.dueDate?.toISOString().startsWith('2026-10-28'));
    expect(day28.filter((l) => l.userId === 'hassan')).toHaveLength(1);
    expect(day28.filter((l) => l.userId === 'omar')).toHaveLength(3); // Rig, Mobile App, and the one shared with Yusuf
  });

  it('managing only a completed project is not managing: that person sees their own row', async () => {
    const store = fakeWorkloadStore(COMPANY);
    expect(await scopeFor(store, 'yusuf', ['EMPLOYEE'], ['mob', 'old'])).toEqual({ kind: 'self', projectIds: ['mob', 'old'] });
  });

  it('anyone else: only their own row, in the open projects they can see; the people on their tasks are weighed but not shown', async () => {
    const store = fakeWorkloadStore(COMPANY);
    const scope = await scopeFor(store, 'yusuf', ['EMPLOYEE'], ['mob', 'old']);
    const { rows } = await loadWorkload(store, { scope, viewerId: 'yusuf', projectId: null, week: WEEK, today: TODAY, timeZone: TZ });
    expect(ids(rows.people)).toEqual(['yusuf']);
    expect(ids(rows.projects)).toEqual(['mob']);
    expect(ids(rows.tasks)).toEqual(['mob-yusuf-omar']);
    expect(rows.teams.every((m) => m.userId === 'yusuf')).toBe(true);
    // Omar (on the shared task) is weighed, so a move suggestion can't land on a day he is full.
    expect(rows.loads.some((l) => l.userId === 'omar')).toBe(true);
  });

  it('narrowed to a project: only its tasks and overdue work (and none of a manager’s other own tasks)', async () => {
    const store = fakeWorkloadStore(COMPANY);
    const scope = await scopeFor(store, 'sara', ['EMPLOYEE'], ['rig', 'mob']);
    const { rows, projectId } = await loadWorkload(store, { scope, viewerId: 'sara', projectId: 'rig', week: WEEK, today: TODAY, timeZone: TZ });
    expect(projectId).toBe('rig');
    expect(ids(rows.tasks)).toEqual(['rig-hassan', 'rig-omar', 'rig-sara']);
    expect(rows.overdue.sort((a, b) => a.userId.localeCompare(b.userId))).toEqual([
      { userId: 'omar', count: 1 },
      { userId: 'sara', count: 1 },
    ]);
    // A project outside the scope is ignored.
    expect((await loadWorkload(store, { scope, viewerId: 'sara', projectId: 'secret', week: WEEK, today: TODAY, timeZone: TZ })).projectId).toBeNull();
  });
});

describe('loadWorkload: days', () => {
  it('judges overdue by the company’s day: a moment just after midnight today is not overdue, one just before is', async () => {
    const store = fakeWorkloadStore({
      ...COMPANY,
      tasks: [
        { id: 'a', projectId: 'rig', due: new Date('2026-10-27T21:00:00Z'), assignees: ['omar'] }, // 01:00 today in Muscat
        { id: 'b', projectId: 'rig', due: new Date('2026-10-27T19:00:00Z'), assignees: ['omar'] }, // 23:00 yesterday
        { id: 'c', projectId: 'rig', due: '2026-10-27', assignees: ['omar'] }, // yesterday
        { id: 'd', projectId: 'rig', due: '2026-10-28', assignees: ['omar'] }, // today
      ],
    });
    const scope = await scopeFor(store, 'admin', ['ADMIN'], null);
    const { rows } = await loadWorkload(store, { scope, viewerId: 'admin', projectId: null, week: WEEK, today: TODAY, timeZone: TZ });
    expect(rows.overdue).toEqual([{ userId: 'omar', count: 2 }]);
  });

  it('for a past week, weighs that week and the three weeks from today — never everything in between', async () => {
    const store = fakeWorkloadStore(COMPANY);
    const scope = await scopeFor(store, 'admin', ['ADMIN'], null);
    await loadWorkload(store, { scope, viewerId: 'admin', projectId: null, week: '2026-09-06', today: TODAY, timeZone: TZ });
    const loads = store.calls.find((c) => c.name === 'openDue' && (c.args as { projectIds: unknown }).projectIds === null)!.args as { windows: { from: Date; to: Date }[] };
    expect(loads.windows.map((w) => [w.from.toISOString().slice(0, 10), w.to.toISOString().slice(0, 10)])).toEqual([
      ['2026-09-05', '2026-09-14'],
      ['2026-10-27', '2026-11-20'],
    ]);
    // The shown tasks are read for the shown week only (a day either side).
    const shown = store.calls.find((c) => c.name === 'openTasks')!.args as { from: Date; to: Date };
    expect([shown.from.toISOString().slice(0, 10), shown.to.toISOString().slice(0, 10)]).toEqual(['2026-09-05', '2026-09-14']);
  });

  it('asks the store a fixed number of questions, however many people there are', async () => {
    const many: FakeCompany = { ...COMPANY, users: [...COMPANY.users, ...Array.from({ length: 50 }, (_, i) => ({ id: `u${i}`, name: `Person ${i}` }))] };
    const small = fakeWorkloadStore(COMPANY);
    const large = fakeWorkloadStore(many);
    for (const store of [small, large]) {
      const scope = await scopeFor(store, 'admin', ['ADMIN'], null);
      await loadWorkload(store, { scope, viewerId: 'admin', projectId: null, week: WEEK, today: TODAY, timeZone: TZ });
    }
    expect(large.calls.length).toBe(small.calls.length);
  });
});
