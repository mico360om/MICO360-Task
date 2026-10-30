// @vitest-environment jsdom
/**
 * Task approvals (server 1.19): a task that needs approval, finished by someone who can't approve it,
 * waits instead of being done — the server answers the move with the task where it waits. My Tasks
 * and the board say so and show it there (not as done until the next read).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BoardScreen } from '../app/screens/board.js';
import { MyTasksScreen } from '../app/screens/my-tasks.js';
import { fakeStorage } from './test-helpers.js';

const TZ = 'Asia/Muscat';
const settle = async () => {
  for (let i = 0; i < 8; i += 1) await new Promise((r) => setTimeout(r, 0));
};
const byText = (root, sel, text) => [...root.querySelectorAll(sel)].find((n) => n.textContent.trim() === text);
const byLabel = (root, label) => root.querySelector(`[aria-label="${label}"]`);
const WAITED = '2026-10-30T08:00:00.000Z';

beforeEach(() => {
  document.body.innerHTML = '';
});

const RIG_COLUMNS = [
  { id: 'r1', name: 'To do', category: 'TODO', enabled: true, position: 0 },
  { id: 'r5', name: 'Review', category: 'REVIEW', enabled: true, position: 1 },
  { id: 'r9', name: 'Done', category: 'DONE', enabled: true, position: 2 },
];
const MINE = [
  { id: 'm1', key: 'RIG-1', title: 'Valve check', priority: 'LOW', projectId: 'p1', columnId: 'r1', columnCategory: 'TODO', dueDate: null, progress: 10, needsApproval: true, version: 1 },
  { id: 'm2', key: 'RIG-2', title: 'Pressure report', priority: 'HIGH', projectId: 'p1', columnId: 'r5', columnCategory: 'REVIEW', dueDate: null, progress: 80, needsApproval: true, approvalRequestedAt: WAITED, version: 4 },
];
/** The server's answer to a move to Done of a task that needs approval: it waits in Review. */
const waitsInReview = (t) => ({ ...t, columnId: 'r5', columnCategory: 'REVIEW', completedAt: null, approvalRequestedAt: WAITED, approvalRequestedById: 'u1', version: (t.version ?? 0) + 1 });

function mineCtx(over = {}) {
  return {
    params: {}, query: {},
    timeZone: TZ,
    isOnline: () => true,
    api: {
      tasks: { mine: vi.fn(async () => ({ data: (over.tasks ?? MINE).map((t) => ({ ...t })) })) },
      projects: { list: vi.fn(async () => ({ data: [{ id: 'p1', code: 'RIG', name: 'Rig Inspection' }] })), columns: vi.fn(async () => ({ data: RIG_COLUMNS })) },
    },
    openTask: vi.fn(),
    write: over.write ?? vi.fn(async (kind, p) => ({ queued: false, data: waitsInReview(MINE.find((t) => t.id === p.id)) })),
    afterMutation: vi.fn(),
  };
}
async function openMine(ctx) {
  const root = MyTasksScreen(ctx);
  document.body.append(root);
  await settle();
  return root;
}
const section = (root, name) => [...root.querySelectorAll('.mt-section')].find((s) => s.querySelector('.section-title').textContent.startsWith(name));
const rowOf = (root, id) => [...root.querySelectorAll('.task-row')].find((r) => r.dataset.taskId === id);
const wrapOf = (root, id) => rowOf(root, id).closest('.task-row-wrap') || rowOf(root, id);

describe('My Tasks: “Mark done” on a task that needs approval', () => {
  it('the server puts it to wait: it says “… is waiting for approval.”, keeps it out of Completed, and shows it waiting instead of “Mark done”', async () => {
    const ctx = mineCtx();
    const root = await openMine(ctx);
    const btn = byLabel(root, 'Mark done: “Valve check”');
    btn.focus();
    btn.click();
    await settle();
    expect(ctx.write).toHaveBeenCalledWith('task.move', { id: 'm1', columnId: 'r9', columnCategory: 'DONE' });
    expect(root.querySelector('.sr-only[role="status"]').textContent).toBe('“Valve check” is waiting for approval.');
    expect(section(root, 'Completed')).toBeUndefined();
    expect(section(root, 'No due date').textContent).toContain('Valve check');
    expect(byLabel(root, 'Mark done: “Valve check”')).toBeNull(); // pressing it again would change nothing
    expect(wrapOf(root, 'm1').querySelector('.waiting-approval').textContent).toBe('Waiting for approval');
    expect(document.activeElement.dataset.taskId).toBe('m1'); // focus on its row (the button is gone)
    expect(ctx.afterMutation).toHaveBeenCalled();
  });

  it('a task already waiting shows it, with no “Mark done”', async () => {
    const root = await openMine(mineCtx());
    expect(byLabel(root, 'Mark done: “Pressure report”')).toBeNull();
    expect(wrapOf(root, 'm2').querySelector('.waiting-approval').textContent).toBe('Waiting for approval');
    expect(byLabel(root, 'Mark done: “Valve check”')).toBeTruthy(); // not waiting: it has the button
  });

  it('a task that doesn’t need approval is still “done” as before', async () => {
    const ctx = mineCtx({ write: vi.fn(async (kind, p) => ({ queued: false, data: { ...MINE[0], needsApproval: false, columnId: p.columnId, columnCategory: 'DONE', completedAt: WAITED, progress: 100, version: 2 } })) });
    const root = await openMine(ctx);
    byLabel(root, 'Mark done: “Valve check”').click();
    await settle();
    expect(root.querySelector('.sr-only[role="status"]').textContent).toBe('“Valve check” is done.');
    expect(section(root, 'Completed').textContent).toContain('Valve check');
  });
});

const COLUMNS = [
  { id: 'c1', name: 'To do', category: 'TODO', enabled: true, position: 0 },
  { id: 'c5', name: 'Review', category: 'REVIEW', enabled: true, position: 1 },
  { id: 'c9', name: 'Done', category: 'DONE', enabled: true, position: 2 },
];
function boardCtx(over = {}) {
  return {
    params: { projectId: 'p1' },
    query: {},
    timeZone: TZ,
    apiBase: 'http://localhost:4000/api/v1',
    me: { id: 'u1', name: 'Mariam' },
    storage: fakeStorage(),
    isOnline: () => true,
    api: {
      projects: {
        get: async () => ({ data: { id: 'p1', code: 'OPS', name: 'Ops' } }),
        columns: async () => ({ data: COLUMNS }),
        progress: async () => ({ data: null }),
        members: async () => ({ data: [] }),
      },
      tasks: { list: vi.fn(async () => ({ data: over.tasks ?? [{ id: 't1', key: 'OPS-1', title: 'Survey report', columnId: 'c1', columnCategory: 'TODO', priority: 'NORMAL', needsApproval: true, version: 2 }] })) },
    },
    navigate: vi.fn(),
    openTask: vi.fn(),
    write: over.write ?? vi.fn(async (kind, p) => ({ queued: false, data: { id: p.id, key: 'OPS-1', columnId: 'c5', columnCategory: 'REVIEW', completedAt: null, progress: 0, approvalRequestedAt: WAITED, version: 3 } })),
    afterMutation: vi.fn(),
  };
}
async function openBoard(ctx) {
  const root = BoardScreen(ctx);
  document.body.append(root);
  await settle();
  return root;
}
const columnOf = (root, id) => [...root.querySelectorAll('.column')].find((c) => [...c.querySelectorAll('.tcard')].some((n) => n.dataset.taskId === id))?.getAttribute('aria-label');

describe('Board: a card finished into waiting for approval', () => {
  it('dragged to Done: drawn where the server put it (Review), saying why', async () => {
    const ctx = boardCtx();
    const root = await openBoard(ctx);
    const [todo, , doneCol] = [...root.querySelectorAll('.column')];
    todo.querySelector('.tcard').dispatchEvent(new Event('dragstart', { bubbles: true }));
    doneCol.dispatchEvent(new Event('drop', { bubbles: true, cancelable: true }));
    await settle();
    expect(ctx.write).toHaveBeenCalledWith('task.move', { id: 't1', columnId: 'c9', position: 0, columnCategory: 'DONE' });
    expect(columnOf(root, 't1')).toBe('Review');
    expect(root.querySelector('.infobar').textContent).toBe('OPS-1 needs approval, so it’s waiting for a project manager.');
    expect(ctx.api.tasks.list).toHaveBeenCalledTimes(1); // no extra read needed
  });

  it('moved from the keyboard: focus follows the card to where it waits', async () => {
    const ctx = boardCtx();
    const root = await openBoard(ctx);
    root.querySelector('[aria-haspopup="menu"]').click();
    byText(root, '[role="menuitem"]', 'Done').click();
    await settle();
    expect(columnOf(root, 't1')).toBe('Review');
    expect(document.activeElement.dataset.taskId).toBe('t1');
  });

  it('a move that went where it was asked is drawn as before, with no note', async () => {
    const ctx = boardCtx({ write: vi.fn(async (kind, p) => ({ queued: false, data: { id: p.id, columnId: 'c9', columnCategory: 'DONE', completedAt: WAITED, progress: 100, version: 3 } })) });
    const root = await openBoard(ctx);
    const [todo, , doneCol] = [...root.querySelectorAll('.column')];
    todo.querySelector('.tcard').dispatchEvent(new Event('dragstart', { bubbles: true }));
    doneCol.dispatchEvent(new Event('drop', { bubbles: true, cancelable: true }));
    await settle();
    expect(columnOf(root, 't1')).toBe('Done');
    expect(root.querySelector('.infobar')).toBeNull();
  });
});
