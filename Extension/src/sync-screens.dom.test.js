// @vitest-environment jsdom
/**
 * DOM tests for Stage 0 (correctness and sync): edit conflicts and versions in the task drawer,
 * the server's own error messages, changes saved on this device, temporary ids, hidden columns,
 * notifications that open their item, and the sign-in / settings fixes.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TaskDetail } from '../app/screens/task-detail.js';
import { BoardScreen } from '../app/screens/board.js';
import { NotificationsScreen } from '../app/screens/notifications.js';
import { SettingsScreen } from '../app/screens/settings.js';
import { LoginScreen } from '../app/screens/login.js';
import { ChatScreen } from '../app/screens/chat.js';
import { ApiError, QueueError } from './errors.js';
import { DEFAULTS } from './config.js';
import { fakeStorage, jsonRes } from './test-helpers.js';

const TZ = 'Asia/Muscat';
const settle = async () => {
  for (let i = 0; i < 8; i += 1) await new Promise((r) => setTimeout(r, 0));
};
const byText = (root, tag, text) => [...root.querySelectorAll(tag)].find((n) => n.textContent.trim() === text);
const byLabel = (root, label) => root.querySelector(`[aria-label="${label}"]`);
const change = (node, value) => { node.value = value; node.dispatchEvent(new Event('change', { bubbles: true })); };
const conflict = () => new ApiError(409, 'This task was changed by someone else. Reload and try again.', 'VERSION_CONFLICT');

beforeEach(() => {
  document.body.innerHTML = '';
  globalThis.chrome = { permissions: { request: vi.fn(async () => true) } };
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete globalThis.chrome;
});

function drawerCtx({ task, checklist = { items: [], done: 0, total: 0 }, write } = {}) {
  let current = { id: 't1', key: 'OPS-1', title: 'Report', priority: 'NORMAL', dueDate: null, recurrenceRule: null, version: 3, ...task };
  return {
    params: { taskId: 't1' },
    me: { id: 'u1', name: 'Me', email: '' },
    timeZone: TZ,
    isOnline: () => true,
    setServerTask: (t) => { current = t; },
    api: {
      tasks: {
        get: vi.fn(async () => ({ data: { ...current } })),
        assignees: async () => ({ data: [] }),
        checklist: async () => ({ data: checklist }),
        comments: async () => ({ data: [] }),
      },
      directory: async () => ({ data: [] }),
    },
    write: write || vi.fn(async () => ({ queued: false })),
    afterMutation: vi.fn(),
  };
}

describe('TaskDetail — edit conflicts (H1)', () => {
  it('sends the version it shows, takes the new one from each reply, and sends one edit at a time', async () => {
    let release;
    const gate = new Promise((r) => { release = r; });
    const write = vi.fn()
      .mockImplementationOnce(async () => { await gate; return { queued: false, data: { id: 't1', version: 4 } }; })
      .mockImplementationOnce(async () => ({ queued: false, data: { id: 't1', version: 5 } }));
    const ctx = drawerCtx({ write });
    const root = TaskDetail(ctx, () => {});
    await settle();
    byText(root, 'button', 'High').click();
    change(byLabel(root, 'Due date'), '2026-10-30');
    await settle();
    expect(write).toHaveBeenCalledTimes(1); // the second edit waits for the first one's reply
    expect(write).toHaveBeenLastCalledWith('task.update', { id: 't1', patch: { priority: 'HIGH' }, expectedVersion: 3 });
    release();
    await settle();
    expect(write).toHaveBeenCalledTimes(2);
    expect(write).toHaveBeenLastCalledWith('task.update', { id: 't1', patch: { dueDate: '2026-10-30' }, expectedVersion: 4 });
  });

  it('a refused edit says plainly that someone else changed the task, reloads it and drops the stale edit', async () => {
    const write = vi.fn(async () => { throw conflict(); });
    const ctx = drawerCtx({ write });
    const root = TaskDetail(ctx, () => {});
    await settle();
    ctx.setServerTask({ id: 't1', key: 'OPS-1', title: 'Renamed by Aisha', priority: 'LOW', version: 4 });
    const title = byLabel(root, 'Task title');
    title.value = 'My title';
    title.dispatchEvent(new Event('blur'));
    await settle();
    expect(ctx.api.tasks.get).toHaveBeenCalledTimes(2);
    expect(root.querySelector('[role="alert"]').textContent).toContain('Someone else changed this task, so your change was not saved');
    expect(byLabel(root, 'Task title').value).toBe('Renamed by Aisha');
    expect(byText(root, 'button', 'Low').className).toContain('on');
  });

  it('after its own changes saved on this device have synced, the next edit is sent against the version they made', async () => {
    const write = vi.fn(async () => ({ queued: false, data: { id: 't1', version: 10 } }));
    const ctx = drawerCtx({ write });
    ctx.api.tasks.get = vi.fn(async () => ({ data: { id: 't1', key: 'OPS-1', title: 'Edited offline', priority: 'NORMAL', version: 7 }, pending: 1 }));
    ctx.storage = fakeStorage({ syncQueue: [] }); // the queued edit has synced since the drawer opened
    ctx.cache = { peek: vi.fn(async () => ({ id: 't1', version: 9 })) };
    const root = TaskDetail(ctx, () => {});
    await settle();
    byText(root, 'button', 'Urgent').click();
    await settle();
    expect(write).toHaveBeenLastCalledWith('task.update', { id: 't1', patch: { priority: 'URGENT' }, expectedVersion: 9 });
  });
});

describe('TaskDetail — messages and changes saved on this device', () => {
  it('H2: shows the server’s own message when it refuses a change', async () => {
    const ctx = drawerCtx({ write: vi.fn(async () => { throw new ApiError(400, 'The start date must be on or before the due date.', 'VALIDATION'); }) });
    const root = TaskDetail(ctx, () => {});
    await settle();
    change(byLabel(root, 'Due date'), '2026-01-01');
    await settle();
    expect(root.querySelector('[role="alert"]').textContent).toBe('The start date must be on or before the due date.');
    expect(byLabel(root, 'Due date').value).toBe(''); // rolled back
  });

  it('H2: a task that can’t be opened says why', async () => {
    const ctx = drawerCtx();
    ctx.api.tasks.get = vi.fn(async () => { throw new ApiError(404, 'Task not found.', 'NOT_FOUND'); });
    const root = TaskDetail(ctx, () => {});
    await settle();
    expect(root.querySelector('[role="alert"]').textContent).toContain('Task not found.');
  });

  it('says "Saved on this device" for an edit waiting to sync, and when the task opens with one', async () => {
    const ctx = drawerCtx({ write: vi.fn(async () => ({ queued: true, item: { id: 'q1' } })) });
    const root = TaskDetail(ctx, () => {});
    await settle();
    expect(root.textContent).not.toContain('Saved on this device');
    byText(root, 'button', 'High').click();
    await settle();
    expect(root.querySelector('[role="status"]').textContent).toContain('Saved on this device');

    const later = drawerCtx();
    later.api.tasks.get = vi.fn(async () => ({ data: { id: 't1', key: 'OPS-1', title: 'Edited offline', priority: 'HIGH', version: 3 }, pending: 1 }));
    const again = TaskDetail(later, () => {});
    await settle();
    expect(again.querySelector('[role="status"]').textContent).toContain('Saved on this device');
  });

  it('a change that can’t be saved anywhere is reported (QueueError)', async () => {
    const ctx = drawerCtx({ write: vi.fn(async () => { throw new QueueError(); }) });
    const root = TaskDetail(ctx, () => {});
    await settle();
    byText(root, 'button', 'High').click();
    await settle();
    expect(root.querySelector('[role="alert"]').textContent).toContain('could not be saved on this device');
  });

  it('L13: a checklist item that hasn’t synced yet can’t be ticked until it has', async () => {
    const ctx = drawerCtx({ checklist: { items: [{ id: 'k1', text: 'Synced step', done: false }, { id: 'tmp-q7', text: 'Offline step', done: false }], done: 0, total: 2 } });
    const root = TaskDetail(ctx, () => {});
    document.body.append(root); // a click ticks a checkbox only in the page
    await settle();
    const offline = byLabel(root, 'Offline step');
    expect(offline.disabled).toBe(true);
    offline.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
    expect(ctx.write).not.toHaveBeenCalled();
    byLabel(root, 'Synced step').click();
    await settle();
    expect(ctx.write).toHaveBeenCalledWith('checklist.update', { id: 't1', itemId: 'k1', patch: { done: true } });
  });
});

function boardCtx(tasks, extra = {}) {
  return {
    params: { projectId: 'p1' },
    query: {},
    timeZone: TZ,
    api: {
      projects: {
        get: async () => ({ data: { name: 'Ops' } }),
        columns: async () => ({ data: [
          { id: 'c1', name: 'To do', category: 'TODO', enabled: true, position: 0 },
          { id: 'c2', name: 'Doing', category: 'IN_PROGRESS', enabled: true, position: 1 },
        ] }),
        progress: async () => ({ data: null }),
      },
      tasks: { list: vi.fn(async () => ({ data: tasks, ...extra })) },
    },
    navigate: vi.fn(),
    openTask: vi.fn(),
    write: vi.fn(async () => ({ queued: false, data: { id: 't1', columnId: 'c2', version: 6 } })),
    afterMutation: vi.fn(),
  };
}

describe('BoardScreen — Stage 0', () => {
  it('M10: tasks in columns switched off in Manage columns are not shown', async () => {
    const ctx = boardCtx([
      { id: 't1', title: 'Shown', columnId: 'c1', priority: 'NORMAL' },
      { id: 't2', title: 'In a hidden column', columnId: 'c1', columnHidden: true, priority: 'NORMAL' },
    ]);
    const root = BoardScreen(ctx);
    await settle();
    expect(root.textContent).toContain('Shown');
    expect(root.textContent).not.toContain('In a hidden column');
    expect(root.querySelector('.column .count').textContent).toBe('1');
  });

  it('L13: a card that hasn’t synced yet doesn’t open (it would fail to load); it says so instead', async () => {
    const ctx = boardCtx([{ id: 'tmp-q1', title: 'Added offline', columnId: 'c1', priority: 'NORMAL', pending: true }], { pending: 1 });
    const root = BoardScreen(ctx);
    await settle();
    root.querySelector('.tcard').click();
    await settle();
    expect(ctx.openTask).not.toHaveBeenCalled();
    expect(root.textContent).toContain('still waiting to sync');
  });

  it('H3: a board with changes waiting to sync says they are saved on this device', async () => {
    const ctx = boardCtx([{ id: 't1', title: 'Moved offline', columnId: 'c2', priority: 'NORMAL' }], { pending: 1, stale: true });
    const root = BoardScreen(ctx);
    await settle();
    expect(root.querySelector('[role="status"]').textContent).toContain('Saved on this device');
  });

  it('a move carries the column’s status (so the move shows everywhere before it syncs); a refused move shows the server’s message', async () => {
    const ctx = boardCtx([{ id: 't1', title: 'Card', columnId: 'c1', priority: 'NORMAL', version: 5 }]);
    const root = BoardScreen(ctx);
    await settle();
    const [todo, doing] = [...root.querySelectorAll('.column')];
    todo.querySelector('.tcard').dispatchEvent(new Event('dragstart', { bubbles: true }));
    doing.dispatchEvent(new Event('drop', { bubbles: true, cancelable: true }));
    await settle();
    expect(ctx.write).toHaveBeenCalledWith('task.move', { id: 't1', columnId: 'c2', position: 0, columnCategory: 'IN_PROGRESS' });

    ctx.write = vi.fn(async () => { throw new ApiError(403, 'You do not have permission to do that.', 'FORBIDDEN'); });
    const [, doingNow] = [...root.querySelectorAll('.column')];
    const [todoNow] = [...root.querySelectorAll('.column')];
    doingNow.querySelector('.tcard').dispatchEvent(new Event('dragstart', { bubbles: true }));
    todoNow.dispatchEvent(new Event('drop', { bubbles: true, cancelable: true }));
    await settle();
    expect(root.querySelector('[role="alert"]').textContent).toBe('You do not have permission to do that.');
  });
});

function notificationsCtx(list, write) {
  return {
    appBase: 'https://task.mico360.com',
    api: { notifications: { list: vi.fn(async () => ({ data: list.map((n) => ({ ...n })) })) } },
    write: write || vi.fn(async () => ({ queued: false })),
    afterMutation: vi.fn(),
    navigate: vi.fn(),
    openTask: vi.fn(),
    openExternal: vi.fn(),
  };
}

describe('NotificationsScreen (M7)', () => {
  const LIST = [
    { id: 'n1', title: 'You were assigned a task', readAt: null, entityType: 'task', entityId: 't1', createdAt: '2026-10-21T08:00:00Z' },
    { id: 'n2', title: 'New message', readAt: null, entityType: 'conversation', entityId: 'cv1', createdAt: '2026-10-21T08:00:00Z' },
    { id: 'n3', title: 'Meeting tomorrow', readAt: '2026-10-21T09:00:00Z', entityType: 'meeting', entityId: 'm1', createdAt: '2026-10-21T08:00:00Z' },
  ];

  it('a click marks the notification read and opens its task, conversation or meeting', async () => {
    const ctx = notificationsCtx(LIST);
    const root = NotificationsScreen(ctx);
    await settle();
    const rows = [...root.querySelectorAll('.nrow')];
    rows[0].click();
    await settle();
    expect(ctx.write).toHaveBeenCalledWith('notification.read', { id: 'n1' });
    expect(ctx.navigate).toHaveBeenCalledWith('#/task/t1');
    [...root.querySelectorAll('.nrow')][1].click();
    await settle();
    expect(ctx.navigate).toHaveBeenCalledWith('#/chat/cv1');
    [...root.querySelectorAll('.nrow')][2].click();
    await settle();
    expect(ctx.navigate).toHaveBeenCalledWith('#/meeting/m1'); // its page here (Stage 6)
    expect(ctx.openExternal).not.toHaveBeenCalled();
    expect(ctx.write).toHaveBeenCalledTimes(2); // n3 was already read
  });

  it('"Mark all as read" is saved like other changes (offline too) and the count follows at once', async () => {
    const ctx = notificationsCtx(LIST, vi.fn(async () => ({ queued: true, item: { id: 'q1' } })));
    const root = NotificationsScreen(ctx);
    await settle();
    byText(root, 'button', 'Mark all as read').click();
    await settle();
    // Up to the newest one shown (one that comes in meanwhile stays unread).
    expect(ctx.write).toHaveBeenCalledWith('notification.readAll', { upTo: '2026-10-21T08:00:00.000Z' });
    expect(root.querySelectorAll('.nrow.unread')).toHaveLength(0);
    expect(root.querySelector('[role="status"]').textContent).toContain('Saved on this device');
    expect(ctx.afterMutation).toHaveBeenCalled();
  });

  it('a "Mark all" or "mark read" that fails is shown and undone, not swallowed', async () => {
    const ctx = notificationsCtx(LIST, vi.fn(async () => { throw new ApiError(403, 'You do not have permission to do that.', 'FORBIDDEN'); }));
    const root = NotificationsScreen(ctx);
    await settle();
    byText(root, 'button', 'Mark all as read').click();
    await settle();
    expect(root.querySelector('[role="alert"]').textContent).toBe('You do not have permission to do that.');
    expect(root.querySelectorAll('.nrow.unread')).toHaveLength(2);
  });
});

describe('ChatScreen — messages waiting to send (H3)', () => {
  it('a message saved on this device says it has not been sent yet', async () => {
    const ctx = {
      params: { conversationId: 'cv1' },
      me: { id: 'u1' },
      navigate: vi.fn(),
      afterMutation: vi.fn(),
      api: {
        chat: {
          messages: async () => ({ data: [{ id: 'tmp-q1', userId: 'u1', body: 'Queued earlier', createdAt: '2026-10-21T08:00:00Z', pending: true }], pending: 1 }),
          markRead: async () => {},
        },
        directory: async () => ({ data: [] }),
      },
      write: vi.fn(async () => ({ queued: true, item: { id: 'q2' } })),
    };
    const root = ChatScreen(ctx);
    await settle();
    expect(root.textContent).toContain('not sent yet');
    const box = root.querySelector('textarea');
    box.value = 'And another';
    box.dispatchEvent(new Event('input', { bubbles: true }));
    byText(root, 'button', 'Send').click();
    await settle();
    // Stage 5: the message keeps one clientId through every try (each try has its Idempotency-Key).
    expect(ctx.write).toHaveBeenCalledWith('chat.send', { conversationId: 'cv1', body: 'And another', clientId: expect.any(String) }, { idempotencyKey: expect.any(String) });
    expect([...root.querySelectorAll('.msg')].filter((m) => m.textContent.includes('not sent yet'))).toHaveLength(2);
  });
});

describe('SettingsScreen (L16)', () => {
  it('saving an address on the same server reloads the app so it takes effect', async () => {
    const ctx = {
      storage: fakeStorage({ apiBase: DEFAULTS.apiBase, appBase: DEFAULTS.appBase, syncQueue: [] }),
      me: { id: 'u1', name: 'Me', email: 'me@example.com' },
      signOut: vi.fn(async () => {}),
      requestSync: vi.fn(),
      afterMutation: vi.fn(),
      reload: vi.fn(),
    };
    const root = SettingsScreen(ctx);
    document.body.append(root);
    await settle();
    root.querySelector('#set-app').value = 'https://task.mico360.com/app';
    byText(root, 'button', 'Save').click();
    await settle();
    expect(ctx.storage.data.appBase).toBe('https://task.mico360.com/app');
    expect(ctx.reload).toHaveBeenCalled();
    expect(ctx.signOut).not.toHaveBeenCalled();
  });
});

describe('LoginScreen — Stage 0', () => {
  function render(storage = fakeStorage()) {
    const onAuthed = vi.fn();
    const root = LoginScreen({ apiBase: DEFAULTS.apiBase, appBase: DEFAULTS.appBase, storage, session: fakeStorage(), onAuthed });
    document.body.append(root);
    root.querySelector('#li').value = 'me@example.com';
    root.querySelector('#lp').value = 'pw';
    return { root, onAuthed, storage };
  }

  it('L20: says when the account is switched off, and how long a locked account stays locked', async () => {
    const { root } = render();
    vi.stubGlobal('fetch', vi.fn(async () => jsonRes({ error: { code: 'ACCOUNT_INACTIVE', message: 'This account is not active. Contact an administrator.' } }, 403)));
    byText(root, 'button', 'Sign in').click();
    await settle();
    expect(root.querySelector('[role="alert"]').textContent).toBe('This account is not active. Contact an administrator.');

    vi.stubGlobal('fetch', vi.fn(async () => jsonRes({ error: { code: 'ACCOUNT_LOCKED', message: 'Too many failed sign-in attempts.', details: { retryAfterSeconds: 600 } } }, 423)));
    byText(root, 'button', 'Sign in').click();
    await settle();
    expect(root.querySelector('[role="alert"]').textContent).toContain('Try again in 10 minutes');
  });

  it('M12: keeps the profile (and roles) from the sign-in', async () => {
    const { root, onAuthed, storage } = render();
    vi.stubGlobal('fetch', vi.fn(async () => jsonRes({ data: { accessToken: 'a', refreshToken: 'r', user: { id: 'u1', email: 'me@example.com', username: 'me', roles: ['ADMIN'], avatarUrl: null } } })));
    byText(root, 'button', 'Sign in').click();
    await settle();
    expect(onAuthed).toHaveBeenCalled();
    expect(storage.data.sessionUser).toEqual({ id: 'u1', email: 'me@example.com', username: 'me', roles: ['ADMIN'], avatarUrl: null });
  });
});
