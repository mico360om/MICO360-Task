// @vitest-environment jsdom
/**
 * Task approvals (server 1.19): a task that needs approval, finished by someone who can't approve it,
 * waits instead of being done — the server answers the move with the task where it waits. My Tasks
 * and the board say so and show it there (not as done until the next read). Someone who can approve
 * it (the server's To approve list says which) gets Approve and Send back, as on the website.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ApiError } from './errors.js';
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
      tasks: {
        mine: vi.fn(async () => ({ data: (over.tasks ?? MINE).map((t) => ({ ...t })) })),
        // The To approve list: who may approve which waiting tasks (none, unless the test says).
        approvals: vi.fn(async () => over.approvals ?? { canApprove: false, tasks: [] }),
        approve: over.approve ?? vi.fn(async (id) => ({ ...MINE.find((t) => t.id === id), columnId: 'r9', columnCategory: 'DONE', completedAt: WAITED, approvalRequestedAt: null, approvedById: 'me', progress: 100, version: 5 })),
        sendBack: over.sendBack ?? vi.fn(async (id) => ({ ...MINE.find((t) => t.id === id), columnId: 'r1', columnCategory: 'TODO', approvalRequestedAt: null, version: 5 })),
      },
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

describe('My Tasks: Approve and Send back, for someone who can approve (owner, 30 Oct)', () => {
  const approver = (over = {}) => mineCtx({ approvals: { canApprove: true, tasks: [{ id: 'm2', key: 'RIG-2' }] }, ...over });
  const dialog = () => document.querySelector('[role="dialog"]');

  it('a waiting task they can approve shows “Waiting for approval” with Approve and Send back; one they can’t, the label only', async () => {
    const ctx = approver();
    const root = await openMine(ctx);
    const wrap = wrapOf(root, 'm2');
    expect(wrap.querySelector('.waiting-approval').textContent).toBe('Waiting for approval');
    expect(byLabel(root, 'Approve RIG-2').tagName).toBe('BUTTON');
    expect(byLabel(root, 'Send RIG-2 back').tagName).toBe('BUTTON');
    // Non-approver: no buttons.
    const other = await openMine(mineCtx());
    expect(other.querySelector('[aria-label="Approve RIG-2"]')).toBeNull();
    expect(ctx.api.tasks.approvals).toHaveBeenCalled();
  });

  it('no waiting task in the list: the To approve list isn’t even asked for', async () => {
    const ctx = approver({ tasks: [MINE[0]] });
    await openMine(ctx);
    expect(ctx.api.tasks.approvals).not.toHaveBeenCalled();
  });

  it('Approve: sent with the version seen; the task is done, says so, and focus stays on its row', async () => {
    const ctx = approver();
    const root = await openMine(ctx);
    const btn = byLabel(root, 'Approve RIG-2');
    btn.focus();
    btn.click();
    await settle();
    expect(ctx.api.tasks.approve).toHaveBeenCalledWith('m2', 4);
    expect(section(root, 'Completed').textContent).toContain('Pressure report');
    expect(root.querySelector('.sr-only[role="status"]').textContent).toBe('Approved RIG-2.');
    expect(byLabel(root, 'Approve RIG-2')).toBeNull();
    expect(document.activeElement.dataset.taskId).toBe('m2');
    expect(ctx.afterMutation).toHaveBeenCalled();
  });

  it('Approve refused (approved by someone else meanwhile): the server’s words, and the list is read again', async () => {
    const ctx = approver({ approve: vi.fn(async () => { throw new ApiError(409, 'This task isn’t waiting for approval any more.', 'NOT_WAITING'); }) });
    const root = await openMine(ctx);
    byLabel(root, 'Approve RIG-2').click();
    await settle();
    expect(root.querySelector('[role="alert"]').textContent).toBe('This task isn’t waiting for approval any more.');
    expect(ctx.api.tasks.mine).toHaveBeenCalledTimes(2);
  });

  it('Send back asks why (required) in a dialog; Escape keeps things as they are', async () => {
    const ctx = approver();
    const root = await openMine(ctx);
    const opener = byLabel(root, 'Send RIG-2 back');
    opener.focus();
    opener.click();
    await settle();
    const d = dialog();
    expect(d.getAttribute('aria-modal')).toBe('true');
    expect(d.querySelector('h2').textContent).toBe('Send RIG-2 back?');
    expect(d.textContent).toContain('Pressure report goes back to In progress. Your reason is added as a comment and sent to the people on it.');
    const box = d.querySelector('textarea');
    expect(document.activeElement).toBe(box);
    expect(d.querySelector(`label[for="${box.id}"]`).textContent).toBe('Why are you sending it back?');
    expect(box.getAttribute('maxlength')).toBe('2000');
    byText(d, 'button', 'Send back').click();
    await settle();
    expect(ctx.api.tasks.sendBack).not.toHaveBeenCalled();
    expect(d.textContent).toContain('Write a reason first.');
    expect(box.getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(box);
    box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await settle();
    expect(dialog()).toBeNull();
    expect(ctx.api.tasks.sendBack).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(byLabel(root, 'Send RIG-2 back'));
  });

  it('Send back with a reason (Ctrl+Enter or the button): sent with the version seen; it is in progress again with “Mark done”', async () => {
    const ctx = approver();
    const root = await openMine(ctx);
    byLabel(root, 'Send RIG-2 back').click();
    await settle();
    const box = dialog().querySelector('textarea');
    box.value = '  Add the gauge readings ';
    box.dispatchEvent(new Event('input', { bubbles: true }));
    box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true, cancelable: true }));
    await settle();
    expect(ctx.api.tasks.sendBack).toHaveBeenCalledWith('m2', 'Add the gauge readings', 4);
    expect(dialog()).toBeNull();
    expect(root.querySelector('.sr-only[role="status"]').textContent).toBe('Sent RIG-2 back.');
    expect(wrapOf(root, 'm2').querySelector('.waiting-approval')).toBeNull();
    expect(byLabel(root, 'Mark done: “Pressure report”')).toBeTruthy();
  });

  it('a send-back that fails keeps the dialog open with the reason, saying why', async () => {
    const ctx = approver({ sendBack: vi.fn(async () => { throw new ApiError(403, 'Only the project’s managers can approve or send back its tasks.', 'FORBIDDEN'); }) });
    const root = await openMine(ctx);
    byLabel(root, 'Send RIG-2 back').click();
    await settle();
    const box = dialog().querySelector('textarea');
    box.value = 'Redo';
    box.dispatchEvent(new Event('input', { bubbles: true }));
    byText(dialog(), 'button', 'Send back').click();
    await settle();
    expect(dialog().querySelector('[role="alert"]').textContent).toBe('Only the project’s managers can approve or send back its tasks.');
    expect(dialog().querySelector('textarea').value).toBe('Redo');
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
      tasks: {
        // Copies, as from the server: a screen changing its tasks never changes the test's own.
        list: vi.fn(async () => ({ data: (over.tasks ?? [{ id: 't1', key: 'OPS-1', title: 'Survey report', columnId: 'c1', columnCategory: 'TODO', priority: 'NORMAL', needsApproval: true, version: 2 }]).map((t) => ({ ...t })) })),
        approvals: vi.fn(async () => over.approvals ?? { canApprove: false, tasks: [] }),
        approve: vi.fn(async (id) => ({ id, key: 'OPS-7', columnId: 'c9', columnCategory: 'DONE', completedAt: WAITED, approvalRequestedAt: null, progress: 100, version: 6 })),
        sendBack: vi.fn(async (id) => ({ id, key: 'OPS-7', columnId: 'c1', columnCategory: 'TODO', completedAt: null, approvalRequestedAt: null, version: 6 })),
      },
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

describe('Board: the “Waiting for approval” badge, and Approve / Send back for someone who can approve (owner, 30 Oct)', () => {
  const WAITING_CARD = { id: 't7', key: 'OPS-7', title: 'Valve datasheet', columnId: 'c5', columnCategory: 'REVIEW', priority: 'NORMAL', needsApproval: true, approvalRequestedAt: WAITED, version: 5 };
  const cardOf = (root, id) => [...root.querySelectorAll('.tcard')].find((c) => c.dataset.taskId === id);

  it('a waiting card shows the badge and says it in its name; someone who can’t approve gets no buttons', async () => {
    const root = await openBoard(boardCtx({ tasks: [WAITING_CARD] }));
    const card = cardOf(root, 't7');
    expect(card.querySelector('.twaiting').textContent).toBe('Waiting for approval');
    expect(card.getAttribute('aria-label')).toContain('waiting for approval');
    expect(root.querySelector('[aria-label="Approve OPS-7"]')).toBeNull();
  });

  it('for an approver: Approve and Send back beside the card (not inside it); Approve draws it in Done at once', async () => {
    const ctx = boardCtx({ tasks: [WAITING_CARD], approvals: { canApprove: true, tasks: [{ id: 't7' }] } });
    const root = await openBoard(ctx);
    const approve = byLabel(root, 'Approve OPS-7');
    expect(cardOf(root, 't7').contains(approve)).toBe(false); // two controls, not one inside the other
    approve.click();
    await settle();
    expect(ctx.api.tasks.approve).toHaveBeenCalledWith('t7', 5);
    expect(columnOf(root, 't7')).toBe('Done');
    expect(cardOf(root, 't7').querySelector('.twaiting')).toBeNull();
    expect(root.querySelector('.sr-only[role="status"]').textContent).toBe('Approved OPS-7.');
    expect(ctx.afterMutation).toHaveBeenCalled();
  });

  it('Send back from the board asks why, then draws it where the server put it', async () => {
    const ctx = boardCtx({ tasks: [WAITING_CARD], approvals: { canApprove: true, tasks: [{ id: 't7' }] } });
    const root = await openBoard(ctx);
    byLabel(root, 'Send OPS-7 back').click();
    await settle();
    const d = document.querySelector('[role="dialog"]');
    expect(d.querySelector('h2').textContent).toBe('Send OPS-7 back?');
    const box = d.querySelector('textarea');
    box.value = 'Wrong revision';
    box.dispatchEvent(new Event('input', { bubbles: true }));
    byText(d, 'button', 'Send back').click();
    await settle();
    expect(ctx.api.tasks.sendBack).toHaveBeenCalledWith('t7', 'Wrong revision', 5);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(columnOf(root, 't7')).toBe('To do');
    expect(root.querySelector('.sr-only[role="status"]').textContent).toBe('Sent OPS-7 back.');
  });
});
