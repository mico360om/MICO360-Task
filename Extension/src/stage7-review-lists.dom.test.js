// @vitest-environment jsdom
/**
 * Stage 7 review fixes — Today and My Tasks: reading again every minute without drawing again what
 * didn’t change, a read never undoing “Mark done” on screen, Today’s day when the list is empty, and
 * the groups as headings.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MyTasksScreen } from '../app/screens/my-tasks.js';
import { TodayScreen } from '../app/screens/today.js';
import { formatDayKey } from './due-date.js';

const TZ = 'Asia/Muscat';
const settle = async () => {
  for (let i = 0; i < 10; i += 1) await new Promise((r) => setTimeout(r, 0));
};
const byLabel = (root, label) => root.querySelector(`[aria-label="${label}"]`);
const section = (root, name) => [...root.querySelectorAll('.mt-section')].find((s) => s.querySelector('.section-title').textContent.startsWith(name));
const rowOf = (root, id) => [...root.querySelectorAll('.task-row')].find((r) => r.dataset.taskId === id);
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};

beforeEach(() => {
  document.body.innerHTML = '';
});
afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
});

async function show(node) {
  document.body.append(node);
  await settle();
  return node;
}

const PROJECTS = [{ id: 'p1', code: 'RIG', name: 'Rig Inspection', status: 'ACTIVE' }];
const COLUMNS = [
  { id: 'r1', name: 'To do', category: 'TODO', enabled: true, position: 0 },
  { id: 'r9', name: 'Done', category: 'DONE', enabled: true, position: 5 },
];
const task = (id, title, extra = {}) => ({ id, key: `RIG-${id}`, title, priority: 'NORMAL', projectId: 'p1', columnId: 'r1', columnCategory: 'TODO', dueDate: null, progress: 0, completedAt: null, ...extra });
const doneCopy = (t) => ({ ...t, columnId: 'r9', columnCategory: 'DONE', completedAt: '2026-10-21T06:00:00Z', progress: 100 });

function listCtx(tasks, over = {}) {
  return {
    params: {}, query: {},
    timeZone: TZ,
    isOnline: () => true,
    api: {
      tasks: { mine: vi.fn(async () => ({ data: tasks.map((t) => ({ ...t })) })) },
      projects: { list: vi.fn(async () => ({ data: PROJECTS.map((p) => ({ ...p })) })), columns: vi.fn(async () => ({ data: COLUMNS })) },
    },
    openTask: vi.fn(),
    write: vi.fn(async (kind, p) => ({ queued: false, data: doneCopy(tasks.find((t) => t.id === p.id)) })),
    afterMutation: vi.fn(),
    ...over,
  };
}

// ---- #5 the minute's read ------------------------------------------------------------------------

describe('review fix #5: reading again every minute leaves what didn’t change alone', () => {
  const MINE = [task('1', 'Valve check'), task('2', 'Book the crane')];

  it('the same tasks and projects: the rows and the project filter aren’t drawn again (a screen reader keeps its place, an open list stays open)', async () => {
    const ctx = listCtx(MINE);
    const root = await show(MyTasksScreen(ctx));
    const row = rowOf(root, '1');
    const filter = byLabel(root, 'Filter by project');
    const options = [...filter.options];
    root.refresh();
    await settle();
    expect(ctx.api.tasks.mine).toHaveBeenCalledTimes(2);
    expect(rowOf(root, '1')).toBe(row);
    expect([...filter.options]).toEqual(options);
  });

  it('something changed: the list shows it', async () => {
    const ctx = listCtx(MINE);
    const root = await show(MyTasksScreen(ctx));
    ctx.api.tasks.mine.mockResolvedValueOnce({ data: [...MINE, task('3', 'Order gaskets')] });
    root.refresh();
    await settle();
    expect(rowOf(root, '3')).toBeTruthy();
  });

  it('the first read failed: the next minute’s failure doesn’t put up (and announce) the error again', async () => {
    const ctx = listCtx(MINE);
    ctx.api.tasks.mine.mockRejectedValue(new Error('offline'));
    const root = await show(MyTasksScreen(ctx));
    const alert = root.querySelector('[role="alert"]');
    expect(alert.textContent).toContain('Could not load your tasks.');
    root.refresh();
    await settle();
    expect(ctx.api.tasks.mine).toHaveBeenCalledTimes(2);
    expect(root.querySelector('[role="alert"]')).toBe(alert);
  });

  it('…and once it can read, the list replaces the error', async () => {
    const ctx = listCtx(MINE);
    ctx.api.tasks.mine.mockRejectedValueOnce(new Error('offline'));
    const root = await show(MyTasksScreen(ctx));
    root.refresh();
    await settle();
    expect(root.querySelector('[role="alert"]')).toBeNull();
    expect(rowOf(root, '1')).toBeTruthy();
  });
});

// ---- #6 a read never undoes "Mark done" -----------------------------------------------------------

describe('review fix #6: a read made before a “Mark done” never undoes it on screen', () => {
  it('marking a repeating task, then another before its next copy is read: both stay done, and the next copy shows', async () => {
    const A = task('a', 'Weekly report', { recurrenceRule: { frequency: 'WEEKLY' } });
    const B = task('b', 'Book the crane');
    const next = task('a2', 'Weekly report', { recurrenceRule: { frequency: 'WEEKLY' }, dueDate: '2026-10-28T00:00:00.000Z' });
    const bWrite = deferred();
    const reread = deferred();
    const ctx = listCtx([A, B], {
      write: vi.fn((kind, p) => (p.id === 'a' ? Promise.resolve({ queued: false, data: doneCopy(A) }) : bWrite.promise)),
    });
    const root = await show(MyTasksScreen(ctx));
    ctx.api.tasks.mine.mockImplementationOnce(() => reread.promise) // A's next copy is read …
      .mockImplementationOnce(async () => ({ data: [doneCopy(A), next, doneCopy(B)] }));
    byLabel(root, 'Mark done: “Weekly report”').click();
    await settle();
    byLabel(root, 'Mark done: “Book the crane”').click(); // … while B is being marked done
    await settle();
    reread.resolve({ data: [doneCopy(A), next, B] }); // read before B's change reached the server
    await settle();
    bWrite.resolve({ queued: false, data: doneCopy(B) });
    await settle();
    expect(byLabel(root, 'Mark done: “Book the crane”')).toBeNull();
    expect(section(root, 'Completed').textContent).toContain('Book the crane');
    expect(rowOf(root, 'a2')).toBeTruthy();
  });
});

// ---- #7 Today's day ---------------------------------------------------------------------------------

describe('review fix #7: Today says which day it is even when nothing is assigned to you', () => {
  it('no tasks: the day is shown', async () => {
    vi.useFakeTimers({ now: new Date('2026-10-21T06:00:00Z'), toFake: ['Date'] });
    const root = await show(TodayScreen(listCtx([])));
    expect(root.querySelector('.state-title').textContent).toBe('No tasks assigned');
    expect(root.querySelector('.today-date').textContent).toBe(formatDayKey('2026-10-21'));
  });
});

// ---- #10 groups are headings ----------------------------------------------------------------------

describe('review fix #10: the groups in Today and My Tasks are headings (a screen reader can jump between them)', () => {
  it('each group’s name is a level-2 heading under the page’s one', async () => {
    const root = await show(MyTasksScreen(listCtx([task('1', 'Valve check', { dueDate: '2026-10-01T00:00:00.000Z' }), task('2', 'Later')])));
    const titles = [...root.querySelectorAll('.mt-section .section-title')];
    expect(titles.length).toBeGreaterThan(1);
    for (const t of titles) expect(t.tagName).toBe('H2');
  });
});
