import { describe, it, expect } from 'vitest';
import { composeBoard, resolveDrop, moveTaskInBoard, reorderColumnInBoard, dropIndex, composeAllProjectsBoard, statusOfBoardColumn, targetColumnFor, boardProjects, boardCompanies, filterBoardByCompany, fullColumnIndex } from './board';
import type { ApiProject } from '../api/projects';
import type { ApiColumn } from '../api/columns';
import type { ApiTask } from '../api/tasks';

const columns: ApiColumn[] = [
  { id: 'c2', projectId: 'p1', name: 'Done', category: 'DONE', position: 1, color: '#2E7D53', enabled: true },
  { id: 'c1', projectId: 'p1', name: 'To Do', category: 'TODO', position: 0, color: '#3A6EA5', enabled: true },
];

const tasks: ApiTask[] = [
  { id: 't1', key: 'MICO-1', title: 'A', description: null, projectId: 'p1', columnId: 'c1', position: 0, priority: 'NORMAL', startDate: null, dueDate: null, progress: 0, completedAt: null, createdAt: '', updatedAt: '' },
  { id: 't2', key: 'MICO-2', title: 'B', description: null, projectId: 'p1', columnId: 'c2', position: 0, priority: 'HIGH', startDate: null, dueDate: null, progress: 100, completedAt: null, createdAt: '', updatedAt: '' },
];

describe('composeBoard', () => {
  it('orders columns by position and groups tasks into them', () => {
    const board = composeBoard(columns, tasks);
    expect(board.map((c) => c.name)).toEqual(['To Do', 'Done']);
    expect(board[0]!.tasks[0]!.key).toBe('MICO-1');
    expect(board[1]!.tasks[0]!.key).toBe('MICO-2');
  });

  it('marks tasks in a DONE column (or completed) as done, so they are never shown overdue', () => {
    const board = composeBoard(columns, tasks);
    expect(board[1]!.tasks[0]!.done).toBe(true); // MICO-2 sits in "Done"
    expect(board[0]!.tasks[0]!.done).toBe(false);
  });

  it('flags the tasks that repeat (the newest copy of a series carries the rule)', () => {
    const board = composeBoard(columns, [{ ...tasks[0]!, recurrenceRule: { freq: 'DAILY', interval: 1 } }, tasks[1]!]);
    expect(board[0]!.tasks[0]!.recurring).toBe(true);
    expect(board[1]!.tasks[0]!.recurring).toBe(false);
  });

  it('leaves out a column switched to hidden in "Manage columns" (it used to stay on the board)', () => {
    const board = composeBoard(columns.map((c, i) => (i === 0 ? { ...c, enabled: false } : c)), tasks);
    expect(board.map((c) => c.id)).toEqual(columns.slice(1).map((c) => c.id));
    // A column that says nothing about visibility (older data) is shown.
    const legacy = columns.map((c) => ({ id: c.id, projectId: c.projectId, name: c.name, category: c.category, position: c.position, color: c.color }));
    expect(composeBoard(legacy as typeof columns, tasks)).toHaveLength(columns.length);
  });

  it('carries the Show to client mark onto the cards (the combined board too)', () => {
    const marked = tasks.map((t, i) => ({ ...t, clientVisible: i === 0 }));
    expect(composeBoard(columns, marked)[0]!.tasks[0]!.clientVisible).toBe(true);
    expect(composeBoard(columns, marked)[1]!.tasks[0]!.clientVisible).toBe(false);
    const project = { id: 'p1', code: 'MICO', name: 'MICO', status: 'ACTIVE', color: '#8B1E1E', imageUrl: null } as unknown as ApiProject;
    const all = composeAllProjectsBoard(marked.map((t) => ({ ...t, columnCategory: t.columnId === 'c1' ? 'TODO' : 'DONE' })), [project]);
    expect(all.flatMap((c) => c.tasks).find((t) => t.key === 'MICO-1')!.clientVisible).toBe(true);
  });

  it('carries a client’s sign-off onto the cards (the combined board too; 1.23)', () => {
    const at = '2026-10-30T09:00:00.000Z';
    const signed = tasks.map((t, i) => ({ ...t, clientAcceptedAt: i === 0 ? at : null }));
    expect(composeBoard(columns, signed)[0]!.tasks[0]!.clientAcceptedAt).toBe(at);
    expect(composeBoard(columns, signed)[1]!.tasks[0]!.clientAcceptedAt).toBeNull();
    const project = { id: 'p1', code: 'MICO', name: 'MICO', status: 'ACTIVE', color: '#8B1E1E', imageUrl: null } as unknown as ApiProject;
    const all = composeAllProjectsBoard(signed.map((t) => ({ ...t, columnCategory: t.columnId === 'c1' ? 'TODO' : 'DONE' })), [project]);
    expect(all.flatMap((c) => c.tasks).find((t) => t.key === 'MICO-1')!.clientAcceptedAt).toBe(at);
  });

  it('produces empty task lists for columns with no tasks', () => {
    const board = composeBoard(columns, []);
    expect(board[0]!.tasks).toHaveLength(0);
  });
});

describe('resolveDrop', () => {
  const board = composeBoard(columns, tasks); // c1 "To Do" has MICO-1, c2 "Done" has MICO-2

  it('moves a task dropped onto another column', () => {
    expect(resolveDrop('MICO-1', 'c2', board)).toEqual({ taskKey: 'MICO-1', toColumnId: 'c2' });
  });

  it('moves a task dropped onto a task in another column', () => {
    expect(resolveDrop('MICO-1', 'MICO-2', board)).toEqual({ taskKey: 'MICO-1', toColumnId: 'c2' });
  });

  it('is a no-op when dropped in the same column', () => {
    expect(resolveDrop('MICO-1', 'c1', board)).toBeNull();
  });

  it('is null for an unknown task', () => {
    expect(resolveDrop('nope', 'c2', board)).toBeNull();
  });
});

describe('moveTaskInBoard', () => {
  const board = composeBoard(columns, tasks); // c1 "To Do" has MICO-1, c2 "Done" has MICO-2

  it('moves the task out of its column and into the target', () => {
    const next = moveTaskInBoard(board, 'MICO-1', 'c2');
    const todo = next.find((c) => c.id === 'c1')!;
    const done = next.find((c) => c.id === 'c2')!;
    expect(todo.tasks.map((t) => t.key)).toEqual([]);
    expect(done.tasks.map((t) => t.key)).toEqual(['MICO-2', 'MICO-1']);
  });

  it('does not mutate the input columns', () => {
    moveTaskInBoard(board, 'MICO-1', 'c2');
    expect(board.find((c) => c.id === 'c1')!.tasks.map((t) => t.key)).toEqual(['MICO-1']);
  });

  it('returns the columns unchanged when the task is not found', () => {
    expect(moveTaskInBoard(board, 'nope', 'c2')).toBe(board);
  });

  it('inserts the task where it was dropped in the target column', () => {
    const next = moveTaskInBoard(board, 'MICO-1', 'c2', 0);
    expect(next.find((c) => c.id === 'c2')!.tasks.map((t) => t.key)).toEqual(['MICO-1', 'MICO-2']);
  });
});

describe('reorderColumnInBoard', () => {
  const cols = composeBoard(columns, [
    ...tasks,
    { id: 't3', key: 'MICO-3', title: 'C', description: null, projectId: 'p1', columnId: 'c1', position: 1, priority: 'LOW', startDate: null, dueDate: null, progress: 0, completedAt: null, createdAt: '', updatedAt: '' },
  ]); // c1 "To Do" now has MICO-1, MICO-3

  it('reorders a column to the given key order', () => {
    const next = reorderColumnInBoard(cols, 'c1', ['MICO-3', 'MICO-1']);
    expect(next.find((c) => c.id === 'c1')!.tasks.map((t) => t.key)).toEqual(['MICO-3', 'MICO-1']);
    // other columns untouched
    expect(next.find((c) => c.id === 'c2')!.tasks.map((t) => t.key)).toEqual(['MICO-2']);
  });

  it('appends any task missing from the order (safety net)', () => {
    const next = reorderColumnInBoard(cols, 'c1', ['MICO-3']);
    expect(next.find((c) => c.id === 'c1')!.tasks.map((t) => t.key)).toEqual(['MICO-3', 'MICO-1']);
  });
});

describe('dropIndex', () => {
  const dest = { id: 'c2', name: 'Doing', color: '#000', tasks: ['A', 'B', 'C'].map((k) => ({ key: k, title: k, priority: 'NORMAL' as const, progress: 0, assignees: [] })) };

  it('lands on the slot of the card it was dropped on (before it, or after it in its lower half)', () => {
    expect(dropIndex(dest, 'B', 'X', false)).toBe(1);
    expect(dropIndex(dest, 'B', 'X', true)).toBe(2);
  });

  it('lands at the end when dropped on the column’s empty space', () => {
    expect(dropIndex(dest, 'c2', 'X', false)).toBe(3);
  });
});

describe('the All projects board', () => {
  const project = (id: string, code: string, extra: Partial<ApiProject> = {}) =>
    ({ id, code, name: `Project ${code}`, status: 'ACTIVE', color: '#1E5A8B', icon: null, imageUrl: null, ...extra }) as ApiProject;
  const projects = [project('p1', 'MICO'), project('p2', 'RIG', { icon: 'rocket' }), project('p3', 'OLD', { status: 'ARCHIVED' }), project('p4', 'FIN', { status: 'COMPLETED' })];
  const task = (key: string, projectId: string, columnCategory: string | null, extra: Partial<ApiTask> = {}) =>
    ({ id: key.toLowerCase(), key, title: key, description: null, projectId, columnId: `${projectId}-${columnCategory}`, columnCategory, position: 0, priority: 'NORMAL', startDate: null, dueDate: null, progress: 0, completedAt: null, createdAt: '', updatedAt: '', ...extra }) as ApiTask;

  it('has the six status columns in board order, named and coloured as everywhere else', () => {
    const board = composeAllProjectsBoard([], projects);
    expect(board.map((c) => c.name)).toEqual(['Backlog', 'To Do', 'In Progress', 'Blocked', 'Review', 'Done']);
    expect(board.map((c) => statusOfBoardColumn(c.id))).toEqual(['BACKLOG', 'TODO', 'IN_PROGRESS', 'BLOCKED', 'REVIEW', 'DONE']);
    expect(board[2]!.color).toBe('rgb(var(--c-cat-progress))');
  });

  it('puts each task under its status, with its project on the card', () => {
    const board = composeAllProjectsBoard([task('MICO-1', 'p1', 'IN_PROGRESS'), task('RIG-4', 'p2', 'BLOCKED'), task('RIG-5', 'p2', 'DONE')], projects);
    const col = (name: string) => board.find((c) => c.name === name)!;
    expect(col('In Progress').tasks.map((t) => t.key)).toEqual(['MICO-1']);
    expect(col('Blocked').tasks[0]).toMatchObject({ key: 'RIG-4', blocked: true, project: { name: 'Project RIG', code: 'RIG', icon: 'rocket' } });
    expect(col('Done').tasks[0]!.done).toBe(true);
  });

  it('sorts a column by due date (no date last), then priority, then key', () => {
    const board = composeAllProjectsBoard(
      [
        task('MICO-3', 'p1', 'TODO'),
        task('MICO-2', 'p1', 'TODO', { dueDate: '2026-10-25', priority: 'LOW' }),
        task('RIG-9', 'p2', 'TODO', { dueDate: '2026-10-25', priority: 'URGENT' }),
        task('MICO-1', 'p1', 'TODO', { dueDate: '2026-10-22' }),
      ],
      projects,
    );
    expect(board[1]!.tasks.map((t) => t.key)).toEqual(['MICO-1', 'RIG-9', 'MICO-2', 'MICO-3']);
  });

  it('leaves out finished and archived projects, projects filtered out, and columns switched off', () => {
    const board = composeAllProjectsBoard(
      [task('MICO-1', 'p1', 'TODO'), task('RIG-1', 'p2', 'TODO'), task('OLD-1', 'p3', 'TODO'), task('FIN-1', 'p4', 'TODO'), task('MICO-2', 'p1', 'BACKLOG', { columnHidden: true }), task('X-1', 'gone', 'TODO')],
      projects,
      { hidden: new Set(['p2']) },
    );
    expect(board.flatMap((c) => c.tasks.map((t) => t.key))).toEqual(['MICO-1']);
  });

  it('treats a task without a known status as To Do', () => {
    expect(composeAllProjectsBoard([task('MICO-1', 'p1', null)], projects)[1]!.tasks.map((t) => t.key)).toEqual(['MICO-1']);
  });

  it('only lists the projects that can be shown', () => {
    expect(boardProjects(projects).map((p) => p.code)).toEqual(['MICO', 'RIG']);
  });

  it('a project whose companies are all archived is left out too', () => {
    expect(boardProjects(projects.map((p) => (p.code === 'RIG' ? { ...p, archived: true } : p))).map((p) => p.code)).toEqual(['MICO']);
  });
});

describe('targetColumnFor (where a card dropped on a status lands in its own project)', () => {
  const cols: ApiColumn[] = [
    { id: 'rev', projectId: 'p1', name: 'QA', category: 'REVIEW', position: 3, color: '#000', enabled: true },
    { id: 'doing2', projectId: 'p1', name: 'Doing later', category: 'IN_PROGRESS', position: 2, color: '#000', enabled: true },
    { id: 'doing1', projectId: 'p1', name: 'Doing', category: 'IN_PROGRESS', position: 1, color: '#000', enabled: true },
    { id: 'off', projectId: 'p1', name: 'Blocked', category: 'BLOCKED', position: 4, color: '#000', enabled: false },
  ];
  it('is the first column of that status by position', () => {
    expect(targetColumnFor(cols, 'IN_PROGRESS')).toBe('doing1');
    expect(targetColumnFor(cols, 'REVIEW')).toBe('rev');
  });
  it('is nothing when the project has no such column on its board', () => {
    expect(targetColumnFor(cols, 'BLOCKED')).toBeNull(); // switched off
    expect(targetColumnFor(cols, 'DONE')).toBeNull();
  });

  it('marks the cards of tasks that carry an inspection form (the combined board too)', () => {
    const marked = tasks.map((t, i) => ({ ...t, inspectionFormId: i === 0 ? 'f1' : null }));
    expect(composeBoard(columns, marked)[0]!.tasks[0]!.inspection).toBe(true);
    expect(composeBoard(columns, marked)[1]!.tasks[0]!.inspection).toBe(false);
    const project = { id: 'p1', code: 'MICO', name: 'MICO', status: 'ACTIVE', color: '#8B1E1E', imageUrl: null } as unknown as ApiProject;
    const all = composeAllProjectsBoard(marked.map((t) => ({ ...t, columnCategory: t.columnId === 'c1' ? 'TODO' : 'DONE' })), [project]);
    expect(all.flatMap((c) => c.tasks).find((t) => t.key === 'MICO-1')!.inspection).toBe(true);
  });

  it('marks the cards of tasks waiting for approval (the combined board too)', () => {
    const marked = tasks.map((t, i) => ({ ...t, approvalRequestedAt: i === 0 ? '2026-10-30T08:00:00Z' : null }));
    expect(composeBoard(columns, marked)[0]!.tasks[0]!.awaitingApproval).toBe(true);
    expect(composeBoard(columns, marked)[1]!.tasks[0]!.awaitingApproval).toBe(false);
    const project = { id: 'p1', code: 'MICO', name: 'MICO', status: 'ACTIVE', color: '#8B1E1E', imageUrl: null } as unknown as ApiProject;
    const all = composeAllProjectsBoard(marked.map((t) => ({ ...t, columnCategory: t.columnId === 'c1' ? 'TODO' : 'DONE' })), [project]);
    expect(all.flatMap((c) => c.tasks).find((t) => t.key === 'MICO-1')!.awaitingApproval).toBe(true);
  });
});

describe('external contacts on the board', () => {
  const oxy = { count: 2, name: 'Ahmed Al Said', company: 'OXY', names: ['Ahmed Al Said', 'Sara Nasser'], companies: ['OXY', 'PDO'] };
  const withContacts = [{ ...tasks[0]!, externalSummary: oxy }, { ...tasks[1]!, externalSummary: null }];
  const projects = [{ id: 'p1', code: 'MICO', name: 'MICO360', status: 'ACTIVE', color: null }] as unknown as ApiProject[];

  it('every card carries its contacts in short (the card line), on a project’s board and on All projects', () => {
    expect(composeBoard(columns, withContacts)[0]!.tasks[0]!.external).toEqual(oxy);
    expect(composeBoard(columns, withContacts)[1]!.tasks[0]!.external).toBeNull();
    const all = composeAllProjectsBoard(withContacts, projects);
    expect(all.flatMap((c) => c.tasks).find((t) => t.key === 'MICO-1')!.external).toEqual(oxy);
  });

  it('lists the companies on the board and keeps only the cards with a contact from the one chosen', () => {
    const board = composeBoard(columns, withContacts);
    expect(boardCompanies(board)).toEqual(['OXY', 'PDO']);
    const pdo = filterBoardByCompany(board, 'pdo');
    expect(pdo.map((c) => c.tasks.map((t) => t.key))).toEqual([['MICO-1'], []]);
    expect(filterBoardByCompany(board, '')).toBe(board);
  });
});

describe('dropping a card on a board filtered by company', () => {
  const card = (key: string) => ({ key, title: key, priority: 'NORMAL' as const, progress: 0, assignees: [] });
  const full = [
    { id: 'a', name: 'To Do', color: '#000', tasks: [card('M1')] },
    { id: 'b', name: 'Doing', color: '#000', tasks: [card('H1'), card('S1'), card('H2'), card('S2'), card('H3')] },
  ];
  // Only S1 and S2 have a contact from the chosen company: the hidden cards H1–H3 keep their places.
  const shown = [
    { id: 'a', name: 'To Do', color: '#000', tasks: [card('M1')] },
    { id: 'b', name: 'Doing', color: '#000', tasks: [card('S1'), card('S2')] },
  ];

  it('puts it just before the shown card it was dropped on, in the whole column', () => {
    expect(fullColumnIndex(full, shown, 'b', 0, 'M1')).toBe(1);
    expect(fullColumnIndex(full, shown, 'b', 1, 'M1')).toBe(3);
  });

  it('after the last shown card when dropped at the end, and at the end of a column with none shown', () => {
    expect(fullColumnIndex(full, shown, 'b', 2, 'M1')).toBe(4);
    expect(fullColumnIndex(full, [{ ...shown[0]!, tasks: [] }, { ...shown[1]!, tasks: [] }], 'b', 0, 'M1')).toBe(5);
  });
});
