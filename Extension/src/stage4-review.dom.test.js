// @vitest-environment jsdom
/**
 * Stage 4 review fixes: the screen under an open New task dialog is never drawn again (a refresh or
 * a route change waits until the dialog has closed), and a task created when it was anyway still
 * shows; focus goes back to the column the form was opened from; "Mark done" keeps keyboard focus
 * while it waits and after a failure, and its name starts with what it says; a project card's
 * button tells a screen reader its status, number and description; project pictures and colours
 * are only the server's own.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BoardScreen } from '../app/screens/board.js';
import { MyTasksScreen } from '../app/screens/my-tasks.js';
import { ProjectsScreen } from '../app/screens/projects.js';
import { ProjectAvatar } from '../app/components.js';
import { createRouteHold, modalOpen } from '../app/dialog.js';
import { projectLook, projectColor, DEFAULT_PROJECT_COLOR } from './project-identity.js';
import { ApiError } from './errors.js';
import { fakeStorage } from './test-helpers.js';

const TZ = 'Asia/Muscat';
const settle = async () => {
  for (let i = 0; i < 8; i += 1) await new Promise((r) => setTimeout(r, 0));
};
const byText = (root, sel, text) => [...root.querySelectorAll(sel)].find((n) => n.textContent.trim() === text);
const byLabel = (root, label) => root.querySelector(`[aria-label="${label}"]`);
const openDialog = () => document.querySelector('[role="dialog"][aria-modal="true"]');
const typeTitle = (value) => {
  const title = document.querySelector('#qa-title');
  title.value = value;
  title.dispatchEvent(new Event('input', { bubbles: true }));
  return title;
};

beforeEach(() => {
  document.body.innerHTML = '';
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const COLUMNS = [
  { id: 'c1', name: 'To do', category: 'TODO', enabled: true, position: 0 },
  { id: 'c2', name: 'In progress', category: 'IN_PROGRESS', enabled: true, position: 1 },
  { id: 'c3', name: 'Blocked', category: 'BLOCKED', enabled: true, position: 2 },
  { id: 'c4', name: 'Done', category: 'DONE', enabled: true, position: 3 },
];

function boardCtx(over = {}) {
  return {
    params: { projectId: 'p1' },
    query: {},
    timeZone: TZ,
    apiBase: 'http://localhost:4000/api/v1',
    me: { id: 'u1', name: 'Mariam Al Hinai' },
    storage: fakeStorage(),
    isOnline: () => true,
    api: {
      projects: {
        get: async () => ({ data: { id: 'p1', code: 'OPS', name: 'Ops', color: '#1E5A8B', icon: 'cog', status: 'ACTIVE' } }),
        columns: async () => ({ data: COLUMNS }),
        progress: async () => ({ data: null }),
        members: async () => ({ data: [{ id: 'u1', firstName: 'Mariam', lastName: 'Al Hinai' }] }),
      },
      tasks: { list: vi.fn(async () => ({ data: (over.tasks ?? []).map((t) => ({ ...t })) })) },
    },
    navigate: vi.fn(),
    openTask: vi.fn(),
    refresh: vi.fn(),
    announce: vi.fn(),
    write: over.write ?? vi.fn(async (kind, p) => ({ queued: false, data: { id: 't9', key: 'OPS-9', progress: 0, ...p } })),
    afterMutation: vi.fn(),
    ...over.ctx,
  };
}

async function openBoard(ctx, host = document.body) {
  const root = BoardScreen(ctx);
  host.append(root);
  await settle();
  return root;
}

describe('a modal dialog holds back refreshes and route changes until it closes', () => {
  it('runs at once when no dialog is open; while one is, waits — and runs once, the last one asked for, after it closes', async () => {
    const hold = createRouteHold(document);
    const now = vi.fn();
    expect(hold.run(now)).toBe(true);
    expect(now).toHaveBeenCalledTimes(1);

    const layer = document.createElement('div');
    layer.innerHTML = '<div role="dialog" aria-modal="true"><input></div>';
    document.body.append(layer);
    expect(modalOpen(document)).toBe(true);
    const first = vi.fn();
    const last = vi.fn();
    expect(hold.run(first)).toBe(false);
    expect(hold.run(last)).toBe(false);
    await settle();
    expect(first).not.toHaveBeenCalled();
    expect(last).not.toHaveBeenCalled();
    layer.remove();
    await settle();
    expect(first).not.toHaveBeenCalled();
    expect(last).toHaveBeenCalledTimes(1);
    expect(hold.held()).toBe(false);
  });

  it('runs only after the dialog has put focus back', async () => {
    const hold = createRouteHold(document);
    const opener = document.createElement('button');
    const layer = document.createElement('div');
    layer.innerHTML = '<div role="dialog" aria-modal="true"></div>';
    document.body.append(opener, layer);
    let focusedWhenRun = null;
    hold.run(() => { focusedWhenRun = document.activeElement; });
    layer.remove(); // the dialog's close: removed, then focus goes back — all at once
    opener.focus();
    await settle();
    expect(focusedWhenRun).toBe(opener);
  });

  it('the task drawer (the app’s own overlay, closed by a route change) holds nothing back; a dialog over the screen does', async () => {
    const drawer = document.createElement('div');
    drawer.innerHTML = '<div role="dialog" aria-modal="true"><div role="dialog" aria-modal="true" class="td-preview"></div></div>';
    document.body.append(drawer);
    const hold = createRouteHold(document, { except: () => drawer });
    expect(modalOpen(document, drawer)).toBe(false);
    const fn = vi.fn();
    expect(hold.run(fn)).toBe(true);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('the New task form open over a board: coming back to the tab waits; the task goes onto the same board, said, focus back; then the board is read again in place', async () => {
    const A = { id: 't1', key: 'OPS-1', title: 'A', priority: 'NORMAL', columnId: 'c1' };
    const ctx = boardCtx({ tasks: [A] });
    const root = await openBoard(ctx);
    expect(typeof root.refresh).toBe('function'); // the board reads itself again without being rebuilt
    const hold = createRouteHold(document);
    const refresh = vi.fn(() => root.refresh());
    const opener = byLabel(root, 'Add a task to To do');
    opener.focus();
    opener.click();
    await settle();
    typeTitle('Check the gauge');
    expect(hold.run(refresh)).toBe(false); // the person switched tabs and came back
    await settle();
    expect(refresh).not.toHaveBeenCalled();
    expect(ctx.api.tasks.list).toHaveBeenCalledTimes(1);
    // The server has the new task by the time the board is read again.
    ctx.api.tasks.list.mockImplementation(async () => ({ data: [{ ...A }, { id: 't9', key: 'OPS-9', title: 'Check the gauge', priority: 'NORMAL', columnId: 'c1', progress: 0 }] }));
    byText(openDialog(), 'button', 'Create task').click();
    await settle();
    expect(openDialog()).toBeNull();
    expect(refresh).toHaveBeenCalledTimes(1); // once the dialog had closed
    expect(ctx.api.tasks.list).toHaveBeenCalledTimes(2);
    expect(root.isConnected).toBe(true);
    const col = [...root.querySelectorAll('.column')].find((c) => c.querySelector('.cname').textContent === 'To do');
    expect([...col.querySelectorAll('.tcard')].filter((c) => c.textContent.includes('Check the gauge'))).toHaveLength(1);
    expect(root.querySelector('.sr-only[role="status"]').textContent).toBe('Created OPS-9 “Check the gauge”.');
    expect(document.activeElement).toBe(byLabel(root, 'Add a task to To do'));
    expect(ctx.refresh).not.toHaveBeenCalled();
  });

  it('past midnight it isn’t read again in place (the app builds it again, for the new day)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-21T19:59:00Z')); // 23:59 in Muscat
    const root = await openBoard(boardCtx());
    expect(root.refresh()).toBeTruthy();
    await settle();
    vi.setSystemTime(new Date('2026-10-21T20:01:00Z')); // 00:01 the next day
    expect(root.refresh()).toBeNull();
  });

  it('read again in place: keeps focus on a card, a column’s “Add a task to …” or “New task”, without a loading screen', async () => {
    const ctx = boardCtx({ tasks: [{ id: 't1', key: 'OPS-1', title: 'A', priority: 'NORMAL', columnId: 'c1' }] });
    const root = await openBoard(ctx);
    for (const pick of [() => root.querySelector('.tcard'), () => byLabel(root, 'Add a task to Blocked'), () => byText(root, 'button', 'New task')]) {
      const target = pick();
      target.focus();
      const p = root.refresh();
      expect(root.querySelector('.board')).toBeTruthy(); // still shown while it reads
      await p;
      await settle();
      expect(document.activeElement).toBe(pick());
      expect(document.activeElement).not.toBe(target); // drawn again, focus followed
    }
  });

  it('created while the dialog was open, without a refresh: the card is in its column and it is said', async () => {
    const ctx = boardCtx({ tasks: [{ id: 't1', key: 'OPS-1', title: 'A', priority: 'NORMAL', columnId: 'c1' }] });
    const root = await openBoard(ctx);
    byLabel(root, 'Add a task to To do').click();
    await settle();
    typeTitle('Check the gauge');
    byText(openDialog(), 'button', 'Create task').click();
    await settle();
    const col = [...root.querySelectorAll('.column')].find((c) => c.querySelector('.cname').textContent === 'To do');
    expect(col.textContent).toContain('Check the gauge');
    expect(root.querySelector('.sr-only[role="status"]').textContent).toBe('Created OPS-9 “Check the gauge”.');
    expect(ctx.refresh).not.toHaveBeenCalled();
  });
});

describe('a board drawn again under the dialog anyway: the task created still shows', () => {
  it('online: the app reads the screen again and says what was created', async () => {
    const ctx = boardCtx();
    const root = await openBoard(ctx);
    byLabel(root, 'Add a task to To do').click();
    await settle();
    typeTitle('Check the gauge');
    root.remove(); // the screen it would write into was replaced
    byText(openDialog(), 'button', 'Create task').click();
    await settle();
    expect(ctx.write).toHaveBeenCalledTimes(1);
    expect(openDialog()).toBeNull();
    expect(ctx.refresh).toHaveBeenCalledTimes(1);
    expect(ctx.announce).toHaveBeenCalledWith('Created OPS-9 “Check the gauge”.');
  });

  it('offline: the same — the waiting card comes back from this device’s queue when the screen is read again', async () => {
    const ctx = boardCtx({ write: vi.fn(async () => ({ queued: true, item: { id: 'q1', idempotencyKey: 'k1' } })) });
    const root = await openBoard(ctx);
    byLabel(root, 'Add a task to To do').click();
    await settle();
    typeTitle('Offline idea');
    root.remove();
    byText(openDialog(), 'button', 'Create task').click();
    await settle();
    expect(ctx.refresh).toHaveBeenCalledTimes(1);
    expect(ctx.announce).toHaveBeenCalledWith(expect.stringContaining('Saved on this device'));
  });
});

describe('closing the New task form: focus goes back to the column it was opened from', () => {
  it('a task created from an empty column’s box: that box is gone, so focus goes to that column’s “Add a task to …”', async () => {
    const ctx = boardCtx({ tasks: [{ id: 't1', key: 'OPS-1', title: 'A', priority: 'NORMAL', columnId: 'c1' }] });
    const root = await openBoard(ctx);
    const done = [...root.querySelectorAll('.column')].find((c) => c.querySelector('.cname').textContent === 'Done');
    const box = done.querySelector('.column-empty');
    box.focus();
    box.click();
    await settle();
    expect(document.querySelector('#qa-column').value).toBe('c4');
    typeTitle('Filed report');
    byText(openDialog(), 'button', 'Create task').click();
    await settle();
    expect(document.activeElement).toBe(byLabel(root, 'Add a task to Done'));
  });

  it('closed without creating: back on the same empty box (not another column’s)', async () => {
    const ctx = boardCtx({ tasks: [{ id: 't1', key: 'OPS-1', title: 'A', priority: 'NORMAL', columnId: 'c1' }] });
    const root = await openBoard(ctx);
    const blocked = [...root.querySelectorAll('.column')].find((c) => c.querySelector('.cname').textContent === 'Blocked');
    blocked.querySelector('.column-empty').click();
    await settle();
    byLabel(openDialog(), 'Close').click();
    await settle();
    expect(openDialog()).toBeNull();
    expect(document.activeElement.closest('.column')).toBe([...root.querySelectorAll('.column')].find((c) => c.querySelector('.cname').textContent === 'Blocked'));
    expect(document.activeElement.classList.contains('column-empty')).toBe(true);
  });

  it('“New task” at the top: back on “New task”', async () => {
    const root = await openBoard(boardCtx({ tasks: [{ id: 't1', key: 'OPS-1', title: 'A', priority: 'NORMAL', columnId: 'c1' }] }));
    byText(root, 'button', 'New task').click();
    await settle();
    typeTitle('From the top');
    byText(openDialog(), 'button', 'Create task').click();
    await settle();
    expect(document.activeElement).toBe(byText(root, 'button', 'New task'));
  });
});

const MINE = [
  { id: 'm1', key: 'RIG-1', title: 'Valve check', priority: 'LOW', projectId: 'p1', columnId: 'r1', columnCategory: 'TODO', dueDate: null, progress: 10 },
  { id: 'm2', key: 'OPS-4', title: 'Approve invoices', priority: 'URGENT', projectId: 'p2', columnId: 'o1', columnCategory: 'IN_PROGRESS', dueDate: null, progress: 60 },
];
const RIG_COLUMNS = [
  { id: 'r1', name: 'To do', category: 'TODO', enabled: true, position: 0 },
  { id: 'r9', name: 'Done', category: 'DONE', enabled: true, position: 5 },
];

function mineCtx(over = {}) {
  return {
    params: {}, query: {},
    timeZone: TZ,
    isOnline: () => true,
    api: {
      tasks: { mine: vi.fn(async () => ({ data: (over.tasks ?? MINE).map((t) => ({ ...t })) })) },
      projects: {
        list: vi.fn(async () => ({ data: [] })),
        columns: over.columns ?? vi.fn(async (pid) => ({ data: pid === 'p1' ? RIG_COLUMNS : [] })),
      },
    },
    openTask: vi.fn(),
    write: over.write ?? vi.fn(async (kind, p) => ({ queued: false, data: { ...MINE.find((t) => t.id === p.id), columnId: p.columnId, columnCategory: 'DONE', completedAt: '2026-10-21T08:00:00Z', progress: 100 } })),
    afterMutation: vi.fn(),
  };
}

async function openMine(ctx) {
  const root = MyTasksScreen(ctx);
  document.body.append(root);
  await settle();
  return root;
}

describe('“Mark done” keeps keyboard focus', () => {
  it('its name starts with what it says: “Mark done: “Title””', async () => {
    const root = await openMine(mineCtx());
    const btn = byLabel(root, 'Mark done: “Valve check”');
    expect(btn).toBeTruthy();
    expect(btn.textContent).toContain('Mark done');
  });

  it('while it waits, focus stays on the button, which says it is busy; pressing it again does nothing', async () => {
    let answer;
    const ctx = mineCtx({ write: vi.fn(() => new Promise((r) => { answer = r; })) });
    const root = await openMine(ctx);
    const btn = byLabel(root, 'Mark done: “Valve check”');
    btn.focus();
    btn.click();
    await settle();
    const waiting = byLabel(root, 'Mark done: “Valve check”');
    expect(document.activeElement).toBe(waiting);
    expect(waiting.getAttribute('aria-disabled')).toBe('true');
    waiting.click();
    await settle();
    expect(ctx.write).toHaveBeenCalledTimes(1);
    answer({ queued: false, data: { ...MINE[0], columnId: 'r9', columnCategory: 'DONE', completedAt: '2026-10-21T08:00:00Z', progress: 100 } });
    await settle();
    expect(document.activeElement.dataset.taskId).toBe('m1'); // done: on its row
  });

  it('refused by the server: focus is back on its “Mark done”', async () => {
    const ctx = mineCtx({ write: vi.fn(async () => { throw new ApiError(403, 'You do not have permission to do that.', 'FORBIDDEN'); }) });
    const root = await openMine(ctx);
    const btn = byLabel(root, 'Mark done: “Valve check”');
    btn.focus();
    btn.click();
    await settle();
    expect(root.querySelector('[role="alert"]').textContent).toBe('You do not have permission to do that.');
    expect(document.activeElement).toBe(byLabel(root, 'Mark done: “Valve check”'));
    expect(document.activeElement.getAttribute('aria-disabled')).not.toBe('true');
  });

  it('its board can’t be read: focus is back on its “Mark done”', async () => {
    const ctx = mineCtx({ columns: vi.fn(async () => { throw new TypeError('Failed to fetch'); }) });
    const root = await openMine(ctx);
    const btn = byLabel(root, 'Mark done: “Valve check”');
    btn.focus();
    btn.click();
    await settle();
    expect(root.querySelector('[role="alert"]')).toBeTruthy();
    expect(document.activeElement).toBe(byLabel(root, 'Mark done: “Valve check”'));
  });

  it('no Done column, or not synced yet: focus is back on its “Mark done”', async () => {
    const root = await openMine(mineCtx());
    const btn = byLabel(root, 'Mark done: “Approve invoices”');
    btn.focus();
    btn.click();
    await settle();
    expect(root.querySelector('[role="alert"]').textContent).toBe('This project has no Done column — open its board to move the task.');
    expect(document.activeElement).toBe(byLabel(root, 'Mark done: “Approve invoices”'));

    document.body.innerHTML = '';
    const waiting = await openMine(mineCtx({ tasks: [{ ...MINE[0], id: 'tmp-q7' }] }));
    const w = byLabel(waiting, 'Mark done: “Valve check”');
    w.focus();
    w.click();
    await settle();
    expect(waiting.querySelector('[role="alert"]').textContent).toBe('This task is still waiting to sync — mark it done after it syncs.');
    expect(document.activeElement).toBe(byLabel(waiting, 'Mark done: “Valve check”'));
  });
});

describe('a project card tells a screen reader what it shows', () => {
  it('the button’s description is its code, number, status and description', async () => {
    const ctx = {
      params: {}, query: {}, apiBase: 'http://localhost:4000/api/v1', appBase: 'http://localhost:5173', navigate: vi.fn(),
      api: { projects: { list: async () => ({ data: [
        { id: 'p1', code: 'RIG', number: 'JOB-2041', name: 'Rig Inspection', description: 'North field rigs', status: 'ON_HOLD', color: '#0F766E', icon: 'oil' },
        { id: 'p2', code: 'OPS', number: null, name: 'Office Ops', description: null, status: 'ACTIVE' },
      ] }) } },
    };
    const root = ProjectsScreen(ctx);
    document.body.append(root);
    await settle();
    const describedBy = (btn) => (btn.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean)
      .map((id) => document.getElementById(id)?.textContent ?? '').join(' ');
    const rig = byLabel(root, 'Open the board of Rig Inspection');
    const said = describedBy(rig);
    expect(said).toContain('RIG');
    expect(said).toContain('Project number JOB-2041');
    expect(said).toContain('On hold');
    expect(said).toContain('North field rigs');
    const ops = describedBy(byLabel(root, 'Open the board of Office Ops'));
    expect(ops).toContain('Active');
    expect(ops).not.toContain('Project number');
  });
});

describe('project pictures and colours are only the server’s own', () => {
  const apiBase = 'http://localhost:4000/api/v1';

  it('a picture only from this server’s /uploads/ — anything else shows the icon or initials', () => {
    const shown = (imageUrl) => {
      const node = ProjectAvatar({ name: 'Rig Inspection', icon: 'oil', color: '#0F766E', imageUrl }, { apiBase });
      return { kind: node.dataset.projectAvatar, src: node.querySelector('img')?.getAttribute('src') ?? null };
    };
    expect(shown('/uploads/p.png')).toEqual({ kind: 'image', src: 'http://localhost:4000/uploads/p.png' });
    for (const bad of ['https://elsewhere.example/p.png', 'http://localhost:4000/uploads/p.png', 'data:image/png;base64,AAAA', 'blob:x', '/api/v1/tasks', '//elsewhere.example/p.png', '/uploads/../api/v1/me', 'javascript:alert(1)']) {
      expect(shown(bad), bad).toEqual({ kind: 'icon', src: null });
    }
    expect(projectLook({ name: 'Ops', imageUrl: 'https://elsewhere.example/p.png' }).kind).toBe('initials');
  });

  it('a colour only like #8B1E1E — anything else is the default red, never put into the page as is', () => {
    expect(projectColor({ color: '#0F766E' })).toBe('#0F766E');
    for (const bad of ['url(https://evil.example/x.png)', 'red', '#abc', '#0F766E; background-image: url(x)', 'rgb(1,2,3)', null, undefined, 42]) {
      expect(projectColor({ color: bad }), String(bad)).toBe(DEFAULT_PROJECT_COLOR);
    }
    const tile = ProjectAvatar({ name: 'Ops', color: 'url(https://evil.example/x.png)' }, { apiBase });
    expect(tile.style.background).toBe('rgb(139, 30, 30)');
    expect(projectLook({ name: 'Ops', color: 'url(x)' }).color).toBe(DEFAULT_PROJECT_COLOR);
  });

  it('the project card’s colour stripe follows the same rule', async () => {
    const ctx = {
      params: {}, query: {}, apiBase, appBase: 'http://localhost:5173', navigate: vi.fn(),
      api: { projects: { list: async () => ({ data: [
        { id: 'p1', code: 'A', name: 'A', status: 'ACTIVE', color: '#0F766E' },
        { id: 'p2', code: 'B', name: 'B', status: 'ACTIVE', color: 'url(https://evil.example/x.png)' },
      ] }) } },
    };
    const root = ProjectsScreen(ctx);
    document.body.append(root);
    await settle();
    const [a, b] = root.querySelectorAll('.project');
    expect(a.style.borderTopColor).toBe('rgb(15, 118, 110)');
    expect(b.style.borderTopColor).toBe('');
  });
});
