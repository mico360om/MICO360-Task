import { describe, it, expect, vi } from 'vitest';
import { createTaskMoveService } from './task-move-service';
import { createMemoryTaskMoveRepository, type MemoryMoveState, type MemoryMoveTask } from './memory-task-move-repository';
import { TaskMovedConflictError, type MoveProject, type TaskMoveRepository } from './task-move-repository';
import { TaskKeyConflictError } from './task-repository';
import { HttpError } from '../../lib/http-errors';

const TZ = 'Asia/Muscat';
// 10:00 on Saturday 24 Oct in Muscat.
const NOW = new Date('2026-10-24T06:00:00Z');
const TODAY = new Date('2026-10-24T00:00:00.000Z');
const TODAY_BOARD = new Date('2026-10-24T12:00:00.000Z');
const EARLIER_BOARD = new Date('2026-10-20T12:00:00.000Z');

const aisha = { id: 'aisha', roles: ['EMPLOYEE'] }; // manages Rig Inspection and Operations (and two closed projects)
const khalid = { id: 'khalid', roles: ['EMPLOYEE'] }; // manages Rig Inspection only
const omar = { id: 'omar', roles: ['EMPLOYEE'] }; // on both teams, manages neither
const root = { id: 'root', roles: ['ADMIN'] };

const project = (id: string, code: string, name: string, status = 'ACTIVE'): MoveProject => ({ id, code, name, status, defaultDueToday: false, color: '#123456', icon: null, imageUrl: null });

function task(over: Partial<MemoryMoveTask> & Pick<MemoryMoveTask, 'id' | 'key' | 'projectId' | 'columnId'>): MemoryMoveTask {
  return {
    title: `Task ${over.key}`,
    description: null,
    position: 0,
    priority: 'NORMAL',
    startDate: null,
    dueDate: null,
    estimatedHours: null,
    actualHours: null,
    progress: 0,
    isMilestone: false,
    createdById: 'aisha',
    completedAt: null,
    recurrenceRule: null,
    recurrenceParentId: null,
    boardDate: EARLIER_BOARD,
    version: 3,
    createdAt: NOW,
    updatedAt: NOW,
    assigneeList: [],
    ...over,
  };
}

const OMAR = { id: 'omar', name: 'Omar Ahmed' };
const SARA = { id: 'sara', name: 'Sara Al Balushi' };
const ZAID = { id: 'zaid', name: 'Zaid Omar' };

function world() {
  const state: MemoryMoveState = {
    projects: [
      project('rig', 'RIG', 'Rig Inspection'),
      project('ops', 'OPS', 'Operations'),
      project('adm', 'ADM', 'Admin'),
      project('old', 'OLD', 'Old Works', 'COMPLETED'),
      project('arc', 'ARC', 'Archive', 'ARCHIVED'),
    ],
    columns: [
      { projectId: 'rig', id: 'r-todo', name: 'To do', category: 'TODO', position: 0, enabled: true },
      { projectId: 'rig', id: 'r-doing', name: 'In progress', category: 'IN_PROGRESS', position: 1, enabled: true },
      { projectId: 'rig', id: 'r-review', name: 'Review', category: 'REVIEW', position: 2, enabled: true },
      { projectId: 'rig', id: 'r-done', name: 'Done', category: 'DONE', position: 3, enabled: true },
      { projectId: 'ops', id: 'o-backlog', name: 'Backlog', category: 'BACKLOG', position: 0, enabled: true },
      { projectId: 'ops', id: 'o-todo', name: 'Next', category: 'TODO', position: 1, enabled: true },
      { projectId: 'ops', id: 'o-doing', name: 'Doing', category: 'IN_PROGRESS', position: 2, enabled: true },
      { projectId: 'ops', id: 'o-done', name: 'Finished', category: 'DONE', position: 3, enabled: true },
      // Switched off in Manage columns: never chosen for a moved task.
      { projectId: 'ops', id: 'o-review', name: 'Checked', category: 'REVIEW', position: 4, enabled: false },
      { projectId: 'adm', id: 'a-todo', name: 'To do', category: 'TODO', position: 0, enabled: true },
      { projectId: 'old', id: 'x-todo', name: 'To do', category: 'TODO', position: 0, enabled: true },
      { projectId: 'arc', id: 'z-todo', name: 'To do', category: 'TODO', position: 0, enabled: true },
    ],
    tasks: [
      task({ id: 't1', key: 'RIG-1', projectId: 'rig', columnId: 'r-todo' }),
      task({ id: 't2', key: 'RIG-2', projectId: 'rig', columnId: 'r-todo', dueDate: new Date('2026-11-02T00:00:00.000Z'), assigneeList: [SARA] }),
      task({ id: 't3', key: 'RIG-3', projectId: 'rig', columnId: 'r-review' }),
      task({ id: 't4', key: 'RIG-4', title: 'Inspect the rig', projectId: 'rig', columnId: 'r-doing', isMilestone: true, assigneeList: [OMAR, SARA] }),
      task({ id: 't5', key: 'RIG-5', projectId: 'rig', columnId: 'r-todo', recurrenceRule: { freq: 'WEEKLY', interval: 1 }, recurrenceParentId: 't0' }),
      task({ id: 't6', key: 'RIG-6', projectId: 'rig', columnId: 'r-todo', recurrenceParentId: 't0' }),
      task({ id: 't7', key: 'RIG-7', projectId: 'rig', columnId: 'r-done', completedAt: new Date('2026-10-22T08:00:00Z'), progress: 100 }),
      task({ id: 't8', key: 'RIG-8', projectId: 'rig', columnId: 'r-todo', assigneeList: [SARA, ZAID] }),
      task({ id: 'a1', key: 'ADM-1', projectId: 'adm', columnId: 'a-todo' }),
      // Operations already has 16 tasks: the next one is OPS-17.
      ...Array.from({ length: 16 }, (_, i) => task({ id: `o${i + 1}`, key: `OPS-${i + 1}`, projectId: 'ops', columnId: 'o-todo' })),
    ],
    aliases: new Map(),
    teams: new Map([
      ['rig', new Set(['aisha', 'khalid', 'omar', 'sara', 'zaid'])],
      ['ops', new Set(['aisha', 'omar'])],
      ['adm', new Set(['aisha', 'omar'])],
    ]),
    managers: new Map([
      ['aisha', new Set(['rig', 'ops', 'old', 'arc'])],
      ['khalid', new Set(['rig'])],
    ]),
    admins: new Set(['root']),
    activity: [],
  };
  const repo = createMemoryTaskMoveRepository(state);
  const onMoved = vi.fn();
  const onStatusChanged = vi.fn();
  const service = createTaskMoveService({ repo, timeZone: TZ, now: () => NOW, checklistPercent: async () => 40, onMoved, onStatusChanged });
  const find = (key: string) => state.tasks.find((t) => t.key === key || state.aliases.get(key)?.taskId === t.id)!;
  return { state, repo, service, onMoved, onStatusChanged, find };
}

/** The HttpError a promise rejects with (fails the test when it resolves). */
async function refusal(p: Promise<unknown>): Promise<HttpError> {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err, 'expected the move to be refused').toBeInstanceOf(HttpError);
  return err as HttpError;
}

describe('Moving a task to another project: who may', () => {
  it('an administrator, or someone who manages both projects, may move a task', async () => {
    const w = world();
    expect((await w.service.moveTask(aisha, 't1', { projectId: 'ops' })).task.projectId).toBe('ops');
    expect((await w.service.moveTask(root, 't3', { projectId: 'adm' })).task.projectId).toBe('adm');
  });

  it('someone who manages only one of the two, or neither, may not — and is told why', async () => {
    const w = world();
    const intoOps = await refusal(w.service.moveTask(khalid, 't1', { projectId: 'ops' }));
    expect(intoOps).toMatchObject({ status: 403, code: 'FORBIDDEN', message: 'You need to manage Operations to move tasks into it.' });
    const outOfRig = await refusal(w.service.moveTask(omar, 't1', { projectId: 'ops' }));
    expect(outOfRig).toMatchObject({ status: 403, message: 'You need to manage Rig Inspection to move its tasks.' });
    expect(await refusal(w.service.moveTask(aisha, 't1', { projectId: 'adm' }))).toMatchObject({ status: 403, message: 'You need to manage Admin to move tasks into it.' });
    expect(w.find('RIG-1').projectId).toBe('rig');
  });

  it('only into an open project other than its own', async () => {
    const w = world();
    expect(await refusal(w.service.moveTask(aisha, 't1', { projectId: 'old' }))).toMatchObject({ status: 400, code: 'PROJECT_CLOSED', message: 'Old Works is completed. Tasks can only be moved to open projects.' });
    expect(await refusal(w.service.moveTask(aisha, 't1', { projectId: 'arc' }))).toMatchObject({ status: 400, code: 'PROJECT_CLOSED', message: 'Archive is archived. Tasks can only be moved to open projects.' });
    expect(await refusal(w.service.moveTask(aisha, 't1', { projectId: 'rig' }))).toMatchObject({ status: 400, code: 'SAME_PROJECT', message: 'This task is already in Rig Inspection.' });
    expect(await refusal(w.service.moveTask(aisha, 't1', { projectId: 'nowhere' }))).toMatchObject({ status: 404, message: 'Project not found.' });
    expect(await refusal(w.service.moveTask(aisha, 'gone', { projectId: 'ops' }))).toMatchObject({ status: 404, message: 'Task not found.' });
  });
});

describe('Where tasks can go (move targets)', () => {
  it('lists the open projects someone may move tasks to, and the projects whose tasks they may move', async () => {
    const w = world();
    const mine = await w.service.targets(aisha);
    expect(mine.managesAll).toBe(false);
    expect([...mine.managedProjectIds].sort()).toEqual(['arc', 'old', 'ops', 'rig']);
    expect(mine.projects.map((p) => p.id)).toEqual(['rig', 'ops']);
    expect(mine.projects[0]).toEqual({ id: 'rig', code: 'RIG', name: 'Rig Inspection', status: 'ACTIVE', color: '#123456', icon: null, imageUrl: null });
    const admin = await w.service.targets(root);
    expect(admin.managesAll).toBe(true);
    expect(admin.projects.map((p) => p.id)).toEqual(['rig', 'ops', 'adm']);
    expect((await w.service.targets(omar)).projects).toEqual([]);
  });
});

describe('What a move will change (preview)', () => {
  it('names the new key, the same kind of column, the people not on the team and the milestone', async () => {
    const w = world();
    const p = await w.service.preview(aisha, ['t4'], 'ops');
    expect(p.project).toMatchObject({ id: 'ops', code: 'OPS', name: 'Operations', defaultDueToday: false });
    expect(p.columns.map((c) => c.id)).toEqual(['o-backlog', 'o-todo', 'o-doing', 'o-done']);
    expect(p.tasks).toEqual([
      {
        id: 't4',
        key: 'RIG-4',
        title: 'Inspect the rig',
        from: { id: 'rig', code: 'RIG', name: 'Rig Inspection' },
        canMove: true,
        reason: null,
        newKey: 'OPS-17',
        currentCategory: 'IN_PROGRESS',
        completed: false,
        columnId: 'o-doing',
        milestoneCleared: true,
        dueDate: null,
        repeat: null,
        outsiders: [SARA],
      },
    ]);
    expect(p.outsiders).toEqual([SARA]);
    // A preview changes nothing.
    expect(w.find('RIG-4')).toMatchObject({ key: 'RIG-4', projectId: 'rig' });
  });

  it('a stage the new project hasn’t got goes to its first column (a switched-off column is never chosen)', async () => {
    const w = world();
    expect((await w.service.preview(aisha, ['t3'], 'ops')).tasks[0]).toMatchObject({ currentCategory: 'REVIEW', columnId: 'o-backlog' });
  });

  it('an undated task gets today where new tasks are due today; a dated one keeps its date', async () => {
    const w = world();
    w.state.projects.find((p) => p.id === 'ops')!.defaultDueToday = true;
    const p = await w.service.preview(aisha, ['t1', 't2'], 'ops');
    expect(p.tasks.map((t) => t.dueDate)).toEqual(['2026-10-24', null]);
  });

  it('a repeating task: its newest copy takes the series along, an earlier copy moves alone', async () => {
    const w = world();
    const p = await w.service.preview(aisha, ['t5', 't6', 't1'], 'ops');
    expect(p.tasks.map((t) => t.repeat)).toEqual(['SERIES', 'COPY', null]);
  });

  it('many tasks: numbers in order, each person not on the team once, and why the others can’t move', async () => {
    const w = world();
    const p = await w.service.preview(aisha, ['t4', 'a1', 't2', 'o3', 'gone', 't8'], 'ops');
    expect(p.tasks.map((t) => [t.key, t.canMove, t.newKey, t.reason])).toEqual([
      ['RIG-4', true, 'OPS-17', null],
      ['ADM-1', false, null, 'You need to manage Admin to move its tasks.'],
      ['RIG-2', true, 'OPS-18', null],
      ['OPS-3', false, null, 'Already in Operations.'],
      ['', false, null, 'Task not found.'],
      ['RIG-8', true, 'OPS-19', null],
    ]);
    expect(p.outsiders).toEqual([SARA, ZAID]);
  });

  it('a project that isn’t open, isn’t found or isn’t theirs to move into is refused for every task', async () => {
    const w = world();
    expect(await refusal(w.service.preview(aisha, ['t1'], 'old'))).toMatchObject({ code: 'PROJECT_CLOSED' });
    expect(await refusal(w.service.preview(aisha, ['t1'], 'nowhere'))).toMatchObject({ status: 404 });
    expect(await refusal(w.service.preview(khalid, ['t1'], 'ops'))).toMatchObject({ status: 403, message: 'You need to manage Operations to move tasks into it.' });
  });
});

describe('Moving one task', () => {
  it('refuses, naming them, when people assigned aren’t on the new team and nothing was chosen for them', async () => {
    const w = world();
    const one = await refusal(w.service.moveTask(aisha, 't4', { projectId: 'ops' }));
    expect(one).toMatchObject({
      status: 409,
      code: 'ASSIGNEES_NOT_ON_TEAM',
      message: 'Sara Al Balushi isn’t on the Operations team. Choose whether to add them to the team or unassign them.',
      details: { people: [SARA] },
    });
    const two = await refusal(w.service.moveTask(aisha, 't8', { projectId: 'ops' }));
    expect(two.message).toBe('Sara Al Balushi and Zaid Omar aren’t on the Operations team. Choose whether to add them to the team or unassign them.');
    expect(w.find('RIG-4')).toMatchObject({ key: 'RIG-4', projectId: 'rig' });
    expect(w.onMoved).not.toHaveBeenCalled();
  });

  it('adds them to the new team when asked', async () => {
    const w = world();
    const r = await w.service.moveTask(aisha, 't4', { projectId: 'ops', assignees: 'ADD_TO_TEAM' });
    expect(r.addedToTeam).toEqual([SARA]);
    expect(r.unassigned).toEqual([]);
    expect(w.state.teams.get('ops')!.has('sara')).toBe(true);
    expect(w.find('RIG-4').assigneeList).toEqual([OMAR, SARA]);
  });

  it('or takes them off the task', async () => {
    const w = world();
    const r = await w.service.moveTask(aisha, 't4', { projectId: 'ops', assignees: 'UNASSIGN' });
    expect(r.unassigned).toEqual([SARA]);
    expect(r.addedToTeam).toEqual([]);
    expect(w.state.teams.get('ops')!.has('sara')).toBe(false);
    expect(w.find('RIG-4').assigneeList).toEqual([OMAR]);
    expect(w.state.activity.filter((a) => a.action === 'UNASSIGNED')).toEqual([{ taskId: 't4', projectId: 'ops', userId: 'aisha', action: 'UNASSIGNED', meta: { assigneeId: 'sara', assignee: 'Sara Al Balushi' } }]);
  });

  it('needs no choice when everyone assigned is on the new team (a choice sent anyway changes nobody)', async () => {
    const w = world();
    w.state.teams.get('ops')!.add('sara');
    const r = await w.service.moveTask(aisha, 't4', { projectId: 'ops', assignees: 'UNASSIGN' });
    expect(r.unassigned).toEqual([]);
    expect(w.find('RIG-4').assigneeList).toEqual([OMAR, SARA]);
  });

  it('gets the next number there and keeps its old key; its milestone is cleared; its board day stays', async () => {
    const w = world();
    const r = await w.service.moveTask(aisha, 't4', { projectId: 'ops', assignees: 'ADD_TO_TEAM' });
    expect(r.task).toMatchObject({ id: 't4', key: 'OPS-17', projectId: 'ops', columnId: 'o-doing', isMilestone: false, formerKeys: ['RIG-4'], boardDate: EARLIER_BOARD });
    expect(r.from).toEqual({ projectId: 'rig', name: 'Rig Inspection', key: 'RIG-4' });
    expect(r.to).toEqual({ projectId: 'ops', name: 'Operations', key: 'OPS-17' });
    expect(r.milestoneCleared).toBe(true);
    expect(r.dueDateSet).toBeNull();
    expect(w.state.aliases.get('RIG-4')).toEqual({ taskId: 't4', projectId: 'rig' });
    // The next task anywhere in Operations is OPS-18, and nothing in Rig Inspection takes RIG-4 again.
    expect(await w.repo.nextKeyNumber('ops')).toBe(18);
    expect(await w.repo.nextKeyNumber('rig')).toBe(9);
  });

  it('a task shown to the old project’s client leaves that client page, and its history says why', async () => {
    const w = world();
    Object.assign(w.find('RIG-4'), { clientVisible: true });
    const r = await w.service.moveTask(aisha, 't4', { projectId: 'ops', assignees: 'ADD_TO_TEAM' });
    expect(r.clientHidden).toBe(true);
    expect(r.task.clientVisible).toBe(false);
    const updated = w.state.activity.find((l) => l.taskId === 't4' && l.action === 'UPDATED')!;
    expect((updated.meta as { changes: unknown[] }).changes).toContainEqual({ field: 'clientVisible', from: true, to: false, reason: 'moved' });
  });

  it('goes to the column chosen in the new project; a column of another project is refused', async () => {
    const w = world();
    expect((await w.service.moveTask(aisha, 't1', { projectId: 'ops', columnId: 'o-todo' })).task.columnId).toBe('o-todo');
    expect(await refusal(w.service.moveTask(aisha, 't3', { projectId: 'ops', columnId: 'r-todo' }))).toMatchObject({ status: 400, code: 'VALIDATION', message: 'That column isn’t on the Operations board.' });
    expect(await refusal(w.service.moveTask(aisha, 't3', { projectId: 'ops', columnId: 'nope' }))).toMatchObject({ status: 400, message: 'That column isn’t on the Operations board.' });
  });

  it('an undated task gets today’s date when the new project’s tasks are due today', async () => {
    const w = world();
    w.state.projects.find((p) => p.id === 'ops')!.defaultDueToday = true;
    const r = await w.service.moveTask(aisha, 't1', { projectId: 'ops' });
    expect(r.task.dueDate).toEqual(TODAY);
    expect(r.dueDateSet).toBe('2026-10-24');
    const dated = await w.service.moveTask(aisha, 't2', { projectId: 'ops', assignees: 'ADD_TO_TEAM' });
    expect(dated.task.dueDate).toEqual(new Date('2026-11-02T00:00:00.000Z'));
    expect(dated.dueDateSet).toBeNull();
  });

  it('tries the next number when another task took this one at the same moment', async () => {
    const w = world();
    let tries = 0;
    // The first try loses OPS-17 to a task created in Operations at that moment.
    const racing: TaskMoveRepository = {
      ...w.repo,
      move: async (write) => {
        if (tries++ > 0) return w.repo.move(write);
        w.state.tasks.push(task({ id: 'racer', key: 'OPS-17', projectId: 'ops', columnId: 'o-todo' }));
        throw new TaskKeyConflictError('OPS-17');
      },
    };
    const service = createTaskMoveService({ repo: racing, timeZone: TZ, now: () => NOW });
    expect((await service.moveTask(aisha, 't1', { projectId: 'ops' })).task.key).toBe('OPS-18');
  });

  it('gives up with a clear message after several tries', async () => {
    const w = world();
    const service = createTaskMoveService({ repo: { ...w.repo, move: async () => Promise.reject(new TaskKeyConflictError('OPS-17')) }, timeZone: TZ, now: () => NOW });
    expect(await refusal(service.moveTask(aisha, 't1', { projectId: 'ops' }))).toMatchObject({ status: 409, code: 'TASK_KEY_CONFLICT', message: 'Another task took that number at the same moment. Please try again.' });
  });

  it('refuses when someone else moved the task first', async () => {
    const w = world();
    const service = createTaskMoveService({ repo: { ...w.repo, move: async () => Promise.reject(new TaskMovedConflictError('t1')) }, timeZone: TZ, now: () => NOW });
    expect(await refusal(service.moveTask(aisha, 't1', { projectId: 'ops' }))).toMatchObject({ status: 409, code: 'TASK_MOVED', message: 'Someone else moved this task just now. Reload it and try again.' });
  });

  it('into a Done column it is completed; out of one it is re-opened — and the status hooks run', async () => {
    const w = world();
    expect((await w.service.preview(aisha, ['t1', 't7'], 'ops')).tasks.map((t) => t.completed)).toEqual([false, true]);
    const done = await w.service.moveTask(aisha, 't1', { projectId: 'ops', columnId: 'o-done' });
    expect(done.task).toMatchObject({ completedAt: NOW, progress: 100, boardDate: TODAY_BOARD });
    expect(done.statusChange).toBe('COMPLETED');
    expect(w.onStatusChanged).toHaveBeenCalledWith(expect.objectContaining({ id: 't1', columnId: 'o-done' }), 'r-todo', 'aisha');
    w.onStatusChanged.mockClear();
    // Already done and still in a Done column: nothing about its status changes.
    const still = await w.service.moveTask(aisha, 't7', { projectId: 'ops' });
    expect(still.task).toMatchObject({ columnId: 'o-done', completedAt: new Date('2026-10-22T08:00:00Z'), progress: 100 });
    expect(still.statusChange).toBeNull();
    expect(w.onStatusChanged).not.toHaveBeenCalled();
    const reopened = await w.service.moveTask(aisha, 't7', { projectId: 'rig', columnId: 'r-todo' });
    expect(reopened.task).toMatchObject({ columnId: 'r-todo', completedAt: null, progress: 40 });
    expect(reopened.statusChange).toBe('REOPENED');
    expect(w.onStatusChanged).toHaveBeenCalledWith(expect.objectContaining({ id: 't7' }), 'o-done', 'aisha');
  });

  it('tells onMoved about the move, with who made it', async () => {
    const w = world();
    const r = await w.service.moveTask(aisha, 't1', { projectId: 'ops' });
    expect(w.onMoved).toHaveBeenCalledWith({ ...r, actorId: 'aisha' });
  });
});

describe('Moving many tasks', () => {
  it('moves the ones it can and reports each, so one refused task doesn’t hide the others', async () => {
    const w = world();
    const r = await w.service.moveTasks(aisha, ['t1', 'a1', 't3', 'gone'], { projectId: 'ops' });
    expect(r.moved).toBe(2);
    expect(r.failed).toBe(2);
    expect(r.results.map((x) => (x.ok ? [x.taskId, true, x.to.key] : [x.taskId, false, x.error.code, x.error.message]))).toEqual([
      ['t1', true, 'OPS-17'],
      ['a1', false, 'FORBIDDEN', 'You need to manage Admin to move its tasks.'],
      ['t3', true, 'OPS-18'],
      ['gone', false, 'NOT_FOUND', 'Task not found.'],
    ]);
    expect(w.onMoved).toHaveBeenCalledTimes(2);
  });

  it('without a choice, only the tasks with people not on the team are refused', async () => {
    const w = world();
    const r = await w.service.moveTasks(aisha, ['t4', 't1'], { projectId: 'ops' });
    expect(r.results.map((x) => [x.taskId, x.ok, x.ok ? null : x.error.code])).toEqual([
      ['t4', false, 'ASSIGNEES_NOT_ON_TEAM'],
      ['t1', true, null],
    ]);
    const chosen = await w.service.moveTasks(aisha, ['t4', 't8'], { projectId: 'ops', assignees: 'UNASSIGN' });
    expect(chosen.moved).toBe(2);
    expect(w.find('RIG-8').assigneeList).toEqual([]);
  });

  it('one column for all of them when one is chosen, else each to its own kind of column', async () => {
    const w = world();
    const own = await w.service.moveTasks(aisha, ['t1', 't3'], { projectId: 'ops' });
    expect(own.results.map((x) => (x.ok ? x.task.columnId : null))).toEqual(['o-todo', 'o-backlog']);
    const chosen = await w.service.moveTasks(aisha, ['t5', 't6'], { projectId: 'ops', columnId: 'o-doing' });
    expect(chosen.results.map((x) => (x.ok ? x.task.columnId : null))).toEqual(['o-doing', 'o-doing']);
  });

  it('reads each project once, however many of its tasks are moved or previewed', async () => {
    const w = world();
    const reads: string[] = [];
    const counting: TaskMoveRepository = { ...w.repo, findProject: async (id) => (reads.push(id), w.repo.findProject(id)) };
    const service = createTaskMoveService({ repo: counting, timeZone: TZ, now: () => NOW });
    await service.preview(aisha, ['t1', 't3', 't5', 't6'], 'ops');
    expect(reads.sort()).toEqual(['ops', 'rig']);
    reads.length = 0;
    await service.moveTasks(aisha, ['t1', 't3', 't5'], { projectId: 'ops' });
    expect(reads.sort()).toEqual(['ops', 'rig']);
  });

  it('a project that can’t take tasks refuses the whole request', async () => {
    const w = world();
    expect(await refusal(w.service.moveTasks(aisha, ['t1', 't3'], { projectId: 'arc' }))).toMatchObject({ code: 'PROJECT_CLOSED' });
    expect(await refusal(w.service.moveTasks(khalid, ['t1'], { projectId: 'ops' }))).toMatchObject({ status: 403 });
    expect(w.find('RIG-1').projectId).toBe('rig');
  });
});

describe('Numbering, history and changes made meanwhile — as the database does them', () => {
  it('numbers after the highest number the project used, old keys included, even after a gap', async () => {
    const w = world();
    w.state.tasks.push(task({ id: 'o30', key: 'OPS-30', projectId: 'ops', columnId: 'o-todo' }));
    expect((await w.service.preview(aisha, ['t1'], 'ops')).tasks[0]!.newKey).toBe('OPS-31');
    expect((await w.service.moveTask(aisha, 't1', { projectId: 'ops' })).task.key).toBe('OPS-31');
    w.state.aliases.set('RIG-40', { taskId: 'x', projectId: 'rig' });
    expect(await w.repo.nextKeyNumber('rig')).toBe(41);
  });

  it('writes the history in order — people taken off, what changed, the move — and tells the old project where it went', async () => {
    const w = world();
    w.state.projects.find((p) => p.id === 'ops')!.defaultDueToday = true;
    await w.service.moveTask(aisha, 't4', { projectId: 'ops', assignees: 'UNASSIGN' });
    expect(w.state.activity).toEqual([
      { taskId: 't4', projectId: 'ops', userId: 'aisha', action: 'UNASSIGNED', meta: { assigneeId: 'sara', assignee: 'Sara Al Balushi' } },
      { taskId: 't4', projectId: 'ops', userId: 'aisha', action: 'UPDATED', meta: { changes: [{ field: 'dueDate', from: null, to: '2026-10-24' }, { field: 'milestone', from: true, to: false }] } },
      { taskId: 't4', projectId: 'ops', userId: 'aisha', action: 'PROJECT_CHANGED', meta: { fromProjectId: 'rig', fromProject: 'Rig Inspection', fromKey: 'RIG-4', toProjectId: 'ops', toProject: 'Operations', toKey: 'OPS-17' } },
      // Filed under the old project, not the task (its people may not be able to open it any more).
      { taskId: null, projectId: 'rig', userId: 'aisha', action: 'PROJECT_MOVED_OUT', meta: { key: 'RIG-4', title: 'Inspect the rig', fromProjectId: 'rig', fromProject: 'Rig Inspection', toProjectId: 'ops', toProject: 'Operations', toKey: 'OPS-17' } },
    ]);
  });

  it('a milestone cleared on its own is a history line too', async () => {
    const w = world();
    w.state.teams.get('ops')!.add('sara');
    await w.service.moveTask(aisha, 't4', { projectId: 'ops' });
    expect(w.state.activity.find((a) => a.action === 'UPDATED')!.meta).toEqual({ changes: [{ field: 'milestone', from: true, to: false }] });
  });

  it('refuses when the task changed after it was read (completed meanwhile), and leaves it as it is', async () => {
    const w = world();
    const changing: TaskMoveRepository = {
      ...w.repo,
      findTasks: async (ids) => {
        const read = await w.repo.findTasks(ids);
        const t = w.state.tasks.find((x) => x.id === 't1')!;
        Object.assign(t, { version: t.version + 1, completedAt: NOW, columnId: 'r-done' });
        return read;
      },
    };
    const service = createTaskMoveService({ repo: changing, timeZone: TZ, now: () => NOW });
    expect(await refusal(service.moveTask(aisha, 't1', { projectId: 'ops' }))).toMatchObject({ status: 409, code: 'VERSION_CONFLICT', message: 'This task changed while you were moving it. Reload it and try again.' });
    expect(w.find('RIG-1')).toMatchObject({ key: 'RIG-1', projectId: 'rig', columnId: 'r-done' });
  });
});
