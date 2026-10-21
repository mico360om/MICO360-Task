import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { transformSync } from 'esbuild';
import {
  ALL_PROJECTS_TEXT,
  STATUS_NAME,
  STATUS_ORDER,
  allBoardCard,
  boardProjects,
  composeAllProjectsBoard,
  findProjects,
  hiddenProjectsKey,
  moveToStatus,
  noStatusColumnText,
  projectFilterLabel,
  readHiddenProjects,
  statusMovePlan,
  statusMoveTargets,
  statusOfTask,
  targetColumnFor,
  withStatus,
} from './all-board';
import { cardView } from './board';
import { BOARD_TEXT } from './board-writes';
import { NetworkError, ApiError } from './api-client';
import type { ApiColumn, ApiProject, ApiTask, ColumnCategory } from './types';

const project = (id: string, patch: Partial<ApiProject> = {}): ApiProject => ({ id, code: id.toUpperCase(), name: `Project ${id}`, description: null, status: 'ACTIVE', color: '#1E5A8B', icon: null, imageUrl: null, ...patch });
const task = (id: string, patch: Partial<ApiTask> & Record<string, unknown> = {}): ApiTask =>
  ({
    id,
    key: `MICO-${id}`,
    title: `Task ${id}`,
    description: null,
    projectId: 'a',
    columnId: 'c1',
    position: 0,
    priority: 'NORMAL',
    startDate: null,
    dueDate: null,
    estimatedHours: null,
    progress: 0,
    completedAt: null,
    columnCategory: 'TODO',
    ...patch,
  }) as ApiTask;
const col = (id: string, category: ColumnCategory, patch: Partial<ApiColumn> = {}): ApiColumn => ({ id, projectId: 'a', name: id, category, position: 0, color: '#1E5A8B', enabled: true, ...patch });

describe('the All projects board: every project’s tasks under the six shared statuses (4c)', () => {
  it('has the website’s six statuses, in its order and words', () => {
    expect(STATUS_ORDER).toEqual(['BACKLOG', 'TODO', 'IN_PROGRESS', 'BLOCKED', 'REVIEW', 'DONE']);
    expect(STATUS_ORDER.map((s) => STATUS_NAME[s])).toEqual(['Backlog', 'To Do', 'In Progress', 'Blocked', 'Review', 'Done']);
  });

  it('leaves out finished and archived projects', () => {
    const shown = boardProjects([project('a'), project('b', { status: 'COMPLETED' }), project('c', { status: 'ARCHIVED' }), project('d', { status: 'PLANNING' })]);
    expect(shown.map((p) => p.id)).toEqual(['a', 'd']);
  });

  it('puts each task under its status, its project on its card; a task with no status is To Do', () => {
    const board = composeAllProjectsBoard(
      [task('1', { columnCategory: 'IN_PROGRESS' }), task('2', { projectId: 'b', columnCategory: null }), task('3', { columnCategory: 'DONE', completedAt: '2026-10-20T10:00:00Z' })],
      [project('a'), project('b', { name: 'Bridge', code: 'BRG', icon: 'bridge' })],
    );
    expect(board.map((c) => c.status)).toEqual(STATUS_ORDER);
    expect(board.find((c) => c.status === 'IN_PROGRESS')!.tasks.map((t) => t.task.id)).toEqual(['1']);
    const todo = board.find((c) => c.status === 'TODO')!;
    expect(todo.tasks.map((t) => t.task.id)).toEqual(['2']);
    expect(todo.tasks[0]!.project).toMatchObject({ id: 'b', name: 'Bridge', code: 'BRG', icon: 'bridge' });
    expect(board.find((c) => c.status === 'DONE')!.tasks.map((t) => t.task.id)).toEqual(['3']);
  });

  it('leaves out tasks of finished, archived or filtered-out projects, and in columns switched off', () => {
    const board = composeAllProjectsBoard(
      [task('1'), task('2', { projectId: 'b' }), task('3', { projectId: 'c' }), task('4', { columnHidden: true }), task('5', { projectId: 'gone' })],
      [project('a'), project('b'), project('c', { status: 'COMPLETED' })],
      { hidden: new Set(['b']) },
    );
    expect(board.flatMap((c) => c.tasks.map((t) => t.task.id))).toEqual(['1']);
  });

  it('sorts a status by due date (none last), then priority, then key', () => {
    const board = composeAllProjectsBoard(
      [
        task('10', { dueDate: null, priority: 'URGENT' }),
        task('2', { dueDate: '2026-10-22', priority: 'LOW' }),
        task('3', { dueDate: '2026-10-21', priority: 'NORMAL' }),
        task('4', { dueDate: '2026-10-21', priority: 'URGENT' }),
        task('9', { dueDate: null, priority: 'URGENT' }),
      ],
      [project('a')],
    );
    expect(board.find((c) => c.status === 'TODO')!.tasks.map((t) => t.task.id)).toEqual(['4', '3', '2', '9', '10']);
  });

  it('a card is the board’s card with its project, coloured by its status, and says the project to TalkBack', () => {
    const card = allBoardCard(task('1', { title: 'Fix pump', counts: { comments: 1, attachments: 0, checklistDone: 0, checklistTotal: 0 } }), 'BLOCKED', project('a', { name: 'Alpha Tower' }), '#CB4632');
    expect(card).toMatchObject({ id: '1', key: 'MICO-1', accentColor: '#CB4632', blocked: true, done: false, project: { name: 'Alpha Tower', code: 'A' } });
    expect(allBoardCard(task('2'), 'DONE', project('a'), '#2E7D53').done).toBe(true);
    expect(allBoardCard(task('3', { completedAt: '2026-10-01T00:00:00Z' }), 'REVIEW', project('a'), '#3A6EA5').done).toBe(true);
    const label = cardView(card, { now: new Date('2026-10-21T08:00:00Z'), timeZone: 'Asia/Muscat' }).label;
    expect(label).toMatch(/^MICO-1, Fix pump\. In Alpha Tower\. Normal priority\. Blocked\./);
  });

  it('a task’s status is its column’s kind (To Do when the server says none)', () => {
    expect(statusOfTask(task('1', { columnCategory: 'REVIEW' }))).toBe('REVIEW');
    expect(statusOfTask(task('2', { columnCategory: null }))).toBe('TODO');
    expect(statusOfTask(task('3', { columnCategory: 'SOMETHING' }))).toBe('TODO');
  });
});

describe('moving a card to a status: into its own project’s first column of that kind (4c)', () => {
  it('the first shown column of that kind, by place', () => {
    const columns = [col('late', 'REVIEW', { position: 5 }), col('off', 'REVIEW', { position: 0, enabled: false }), col('early', 'REVIEW', { position: 2 }), col('todo', 'TODO')];
    expect(targetColumnFor(columns, 'REVIEW')).toBe('early');
    expect(targetColumnFor(columns, 'DONE')).toBeNull();
  });

  it('offers the other five statuses', () => {
    expect(statusMoveTargets('TODO').map((t) => t.status)).toEqual(['BACKLOG', 'IN_PROGRESS', 'BLOCKED', 'REVIEW', 'DONE']);
    expect(statusMoveTargets('TODO')[1]).toEqual({ status: 'IN_PROGRESS', name: 'In Progress' });
  });

  it('a plan: nothing for the same status; the column to move to; or why it stays, in the website’s words', () => {
    const t = task('1', { columnCategory: 'TODO' });
    expect(statusMovePlan(t, 'TODO', [col('c1', 'TODO')], 'Alpha')).toEqual({ kind: 'same' });
    expect(statusMovePlan(t, 'DONE', [col('c1', 'TODO'), col('d', 'DONE')], 'Alpha')).toEqual({ kind: 'move', columnId: 'd' });
    expect(statusMovePlan(t, 'BLOCKED', [col('c1', 'TODO')], 'Alpha')).toEqual({ kind: 'no-column', message: 'Alpha has no “Blocked” column, so MICO-1 stayed where it was.' });
    expect(noStatusColumnText(null, 'REVIEW', 'MICO-2')).toBe('Its project has no “Review” column, so MICO-2 stayed where it was.');
  });

  it('shows the card under its new status at once; leaving Done reopens it', () => {
    const list = [task('1', { columnCategory: 'DONE', completedAt: '2026-10-20T10:00:00Z', columnId: 'd' }), task('2')];
    const moved = withStatus(list, '1', 'c9', 'IN_PROGRESS');
    expect(moved[0]).toMatchObject({ columnId: 'c9', columnCategory: 'IN_PROGRESS', completedAt: null });
    expect(moved[1]).toBe(list[1]);
    expect(withStatus(list, '2', 'd', 'DONE')[1]).toMatchObject({ columnId: 'd', columnCategory: 'DONE' });
    expect(withStatus(list, 'none', 'd', 'DONE')).toEqual(list);
  });

  it('sends the move through the task write path: moved, kept on the phone, or refused (put back)', async () => {
    const sent: unknown[] = [];
    expect(await moveToStatus(async (id, columnId) => void sent.push([id, columnId]), { id: '1', columnId: 'd' })).toEqual({ kind: 'moved' });
    expect(sent).toEqual([['1', 'd']]);
    const offline = await moveToStatus(async () => {
      throw new NetworkError('Network request failed.');
    }, { id: '1', columnId: 'd' });
    expect(offline).toEqual({ kind: 'kept', message: 'Saved on this phone — will sync when you’re online.' });
    const refused = await moveToStatus(async () => {
      throw new ApiError(400, 'VALIDATION', 'No.');
    }, { id: '1', columnId: 'd' });
    expect(refused).toEqual({ kind: 'refused', message: 'Couldn’t move that task — it was put back. No.' });
    expect(BOARD_TEXT.moveRefused).toMatch(/^Couldn’t move that task — it was put back\./);
  });
});

describe('the project filter (4c), as the website’s “Projects:” button', () => {
  it('says how many projects are shown', () => {
    expect(projectFilterLabel(12, 12)).toBe('Projects: all');
    expect(projectFilterLabel(3, 12)).toBe('Projects: 3 of 12');
    expect(projectFilterLabel(0, 4)).toBe('Projects: 0 of 4');
  });

  it('finds a project by name (case and spaces ignored)', () => {
    const ps = [project('a', { name: 'Alpha Tower' }), project('b', { name: 'Bridge' })];
    expect(findProjects(ps, '  tow ').map((p) => p.id)).toEqual(['a']);
    expect(findProjects(ps, '').map((p) => p.id)).toEqual(['a', 'b']);
  });

  it('remembers the projects left out, per person, so a new project shows', () => {
    expect(hiddenProjectsKey('u1')).toBe('mico360.board.hiddenProjects.u1');
    expect([...readHiddenProjects('["a","b",3]')]).toEqual(['a', 'b']);
    expect([...readHiddenProjects('not json')]).toEqual([]);
    expect([...readHiddenProjects(null)]).toEqual([]);
    expect([...readHiddenProjects('{"a":1}')]).toEqual([]);
  });

  it('uses the website’s words', () => {
    expect(ALL_PROJECTS_TEXT).toMatchObject({
      title: 'All projects',
      showAll: 'Show all',
      showNone: 'Show none',
      find: 'Find a project',
      noMatch: 'No project matches.',
      filterTitle: 'Projects on the board',
    });
  });
});

describe('the All projects board follows the website’s rules (drift)', () => {
  const web = (p: string) => readFileSync(resolve(__dirname, '../../../Web Portal/frontend/src', p), 'utf8');
  type Fn = (...a: unknown[]) => unknown;
  const load = (p: string, req: (name: string) => unknown = () => ({})) => {
    const { code } = transformSync(web(p), { loader: 'ts', format: 'cjs' });
    const mod = { exports: {} as Record<string, unknown> };
    new Function('module', 'exports', 'require', code)(mod, mod.exports, req);
    return mod.exports;
  };
  const status = load('lib/taskStatus.ts');
  const board = load('lib/board.ts', (name) => (name.includes('taskStatus') ? status : {}));

  it('the same statuses, order and words', () => {
    expect(status.STATUS_ORDER).toEqual(STATUS_ORDER);
    expect(STATUS_ORDER.map((s) => (status.STATUS_META as Record<string, { label: string }>)[s]!.label)).toEqual(STATUS_ORDER.map((s) => STATUS_NAME[s]));
  });

  it('the website’s composeAllProjectsBoard gives the same columns, cards, order and projects', () => {
    const projects = [project('a', { name: 'Alpha' }), project('b', { name: 'Bridge', icon: 'bridge' }), project('c', { status: 'ARCHIVED' }), project('h')];
    const tasks = [
      task('1', { columnCategory: 'IN_PROGRESS', dueDate: '2026-10-22', assignees: [{ id: 'u1', name: 'Ann' }] as never }),
      task('2', { projectId: 'b', columnCategory: 'IN_PROGRESS', dueDate: '2026-10-21', priority: 'HIGH' }),
      task('3', { projectId: 'b', columnCategory: null, recurrenceRule: { freq: 'DAILY', interval: 1 }, isMilestone: true }),
      task('4', { columnCategory: 'DONE', completedAt: '2026-10-01T00:00:00Z', counts: { comments: 2, attachments: 1, checklistDone: 1, checklistTotal: 2 } }),
      task('5', { columnCategory: 'BLOCKED', progress: 40 }),
      task('6', { projectId: 'c' }),
      task('7', { projectId: 'h' }),
      task('8', { columnHidden: true }),
    ];
    const hidden = new Set(['h']);
    const theirs = (board.composeAllProjectsBoard as Fn)(tasks, projects, { hidden }) as { name: string; tasks: Record<string, unknown>[] }[];
    const ours = composeAllProjectsBoard(tasks, projects, { hidden });
    expect(ours.map((c) => c.name)).toEqual(theirs.map((c) => c.name));
    const fields = ['key', 'title', 'priority', 'dueDate', 'progress', 'assignees', 'counts', 'blocked', 'recurring', 'milestone', 'done'] as const;
    theirs.forEach((column, i) => {
      const mine = ours[i]!.tasks.map((t) => allBoardCard(t.task, ours[i]!.status, t.project, '#000'));
      expect(mine.map((card) => Object.fromEntries(fields.map((f) => [f, card[f]])))).toEqual(column.tasks.map((t) => Object.fromEntries(fields.map((f) => [f, t[f]]))));
      expect(mine.map((card) => card.project)).toEqual(column.tasks.map((t) => t.project));
    });
  });

  it('the website’s targetColumnFor picks the same column', () => {
    const columns = [col('late', 'REVIEW', { position: 5 }), col('off', 'REVIEW', { position: 0, enabled: false }), col('early', 'REVIEW', { position: 2 })];
    for (const s of ['REVIEW', 'DONE'] as const) expect(targetColumnFor(columns, s)).toBe((board.targetColumnFor as Fn)(columns, s));
  });

  it('the website’s words for the filter, the notice and the board', () => {
    const filter = web('components/board/ProjectFilter.tsx');
    expect(filter).toMatch(/'Projects: all' : `Projects: \$\{shownCount\} of \$\{projects\.length\}`/);
    for (const w of [ALL_PROJECTS_TEXT.showAll, ALL_PROJECTS_TEXT.showNone, ALL_PROJECTS_TEXT.noMatch]) expect(filter).toContain(`>${w}<`);
    expect(filter).toContain(`aria-label="${ALL_PROJECTS_TEXT.filterTitle}"`);
    expect(filter).toContain(`placeholder="${ALL_PROJECTS_TEXT.find}"`);
    const page = web('pages/BoardPage.tsx');
    expect(page).toMatch(/has no “\$\{STATUS_META\[status\]!\.label\}” column, so \$\{taskKey\} stayed where it was\./);
    expect(page).toContain(`label: '${ALL_PROJECTS_TEXT.title}'`);
  });
});
