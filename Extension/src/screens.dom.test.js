// @vitest-environment jsdom
/**
 * DOM smoke tests for the app screens most affected by the audit fixes. They render the real
 * screen modules against stub contexts (no chrome runtime needed beyond small stubs).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BoardScreen } from '../app/screens/board.js';
import { LoginScreen } from '../app/screens/login.js';
import { SettingsScreen } from '../app/screens/settings.js';
import { ChatScreen } from '../app/screens/chat.js';
import { TaskDetail } from '../app/screens/task-detail.js';
import { DashboardScreen } from '../app/screens/dashboard.js';
import { DEFAULTS } from './config.js';
import { todayKey, shiftDayKey } from './due-date.js';
import { fakeStorage, jsonRes } from './test-helpers.js';

const TZ = 'Asia/Muscat';
const settle = async () => {
  for (let i = 0; i < 6; i += 1) await new Promise((r) => setTimeout(r, 0));
};
const byText = (root, tag, text) => [...root.querySelectorAll(tag)].find((n) => n.textContent.trim() === text);
const byLabel = (root, label) => root.querySelector(`[aria-label="${label}"]`);

beforeEach(() => {
  document.body.innerHTML = '';
  globalThis.chrome = { permissions: { request: vi.fn(async () => true) } };
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  delete globalThis.chrome;
});

function boardCtx(query = {}) {
  return {
    params: { projectId: 'p1' },
    query,
    timeZone: TZ,
    api: {
      projects: {
        get: async () => ({ data: { name: 'Ops' } }),
        columns: async () => ({ data: [{ id: 'c1', name: 'To do', category: 'TODO', enabled: true, position: 0 }] }),
        progress: async () => ({ data: null }),
      },
      tasks: { list: vi.fn(async () => ({ data: [{ id: 't1', title: 'Existing', columnId: 'c1', priority: 'NORMAL' }] })) },
    },
    navigate: vi.fn(),
    openTask: vi.fn(),
    write: vi.fn(async () => ({ queued: false, data: { id: 't2', title: 'New thing', columnId: 'c1', priority: 'NORMAL' } })),
    afterMutation: vi.fn(),
  };
}

describe('BoardScreen (EXT-03)', () => {
  it('loads today’s board in the company time zone and navigates day by day', async () => {
    const ctx = boardCtx();
    const root = BoardScreen(ctx);
    await settle();
    const today = todayKey(TZ);
    expect(ctx.api.tasks.list).toHaveBeenCalledWith({ projectId: 'p1', boardDate: today });
    expect(root.textContent).toContain('Today');
    byLabel(root, 'Next day').click();
    expect(ctx.navigate).toHaveBeenCalledWith(`#/board/p1?date=${shiftDayKey(today, 1)}`);
    byLabel(root, 'Previous day').click();
    expect(ctx.navigate).toHaveBeenLastCalledWith(`#/board/p1?date=${shiftDayKey(today, -1)}`);
  });

  it('shows the requested day and creates new tasks on that day', async () => {
    const ctx = boardCtx({ date: '2026-01-15' });
    vi.stubGlobal('prompt', () => 'New thing');
    const root = BoardScreen(ctx);
    await settle();
    expect(ctx.api.tasks.list).toHaveBeenCalledWith({ projectId: 'p1', boardDate: '2026-01-15' });
    byText(root, 'button', 'Today').click();
    expect(ctx.navigate).toHaveBeenCalledWith('#/board/p1');
    byText(root, 'button', '+ Add task').click();
    await settle();
    expect(ctx.write).toHaveBeenCalledWith('task.create', { projectId: 'p1', columnId: 'c1', title: 'New thing', priority: 'NORMAL', boardDate: '2026-01-15' });
    expect(root.textContent).toContain('New thing');
  });

  it('EXT-05: a change that could not be saved at all is reported, not shown as saved', async () => {
    const ctx = boardCtx();
    ctx.write = vi.fn(async () => { const e = new Error('full'); e.userMessage = 'Your change could not be saved on this device.'; throw e; });
    vi.stubGlobal('prompt', () => 'Lost?');
    const root = BoardScreen(ctx);
    await settle();
    byText(root, 'button', '+ Add task').click();
    await settle();
    expect(root.textContent).toContain('could not be saved on this device');
    expect(root.textContent).not.toContain('Lost?');
  });
});

describe('LoginScreen (EXT-01 / EXT-04)', () => {
  function render(storage, extra = {}) {
    const onAuthed = vi.fn();
    const session = fakeStorage();
    const root = LoginScreen({ apiBase: DEFAULTS.apiBase, appBase: DEFAULTS.appBase, storage, session, onAuthed, ...extra });
    document.body.append(root);
    return { root, onAuthed, session };
  }

  it('offers an Advanced server field before sign-in; rejects insecure hosts', async () => {
    const storage = fakeStorage();
    const { root } = render(storage);
    const toggle = byText(root, 'button', 'Advanced: change server');
    expect(toggle).toBeTruthy();
    toggle.click();
    const input = root.querySelector('#ls');
    expect(input.value).toBe('https://task.mico360.com');
    input.value = 'http://evil.example.com';
    byText(root, 'button', 'Use this server').click();
    await settle();
    expect(root.textContent).toMatch(/https:\/\//);
    expect(globalThis.chrome.permissions.request).not.toHaveBeenCalled();
    expect(storage.data.apiBase).toBeUndefined();
  });

  it('switching server asks Chrome for access, stores it and wipes the old server’s data; sign-in then goes there', async () => {
    const storage = fakeStorage({ syncQueue: [{ id: 'q', userId: 'u0' }], 'cache:tasks:mine': { data: [], cachedAt: 1 }, lastUnread: 3 });
    const { root, onAuthed, session } = render(storage);
    byText(root, 'button', 'Advanced: change server').click();
    root.querySelector('#ls').value = 'https://staging.example.com';
    byText(root, 'button', 'Use this server').click();
    await settle();
    expect(globalThis.chrome.permissions.request).toHaveBeenCalledWith({ origins: ['https://staging.example.com/*'] });
    expect(storage.data.apiBase).toBe('https://staging.example.com/api/v1');
    expect(storage.data.appBase).toBe('https://staging.example.com');
    expect(storage.data.syncQueue).toBeUndefined();
    expect(storage.data['cache:tasks:mine']).toBeUndefined();

    const fetchMock = vi.fn(async () => jsonRes({ data: { accessToken: 'a', refreshToken: 'r', user: { id: 'u1' } } }));
    vi.stubGlobal('fetch', fetchMock);
    root.querySelector('#li').value = 'me@example.com';
    root.querySelector('#lp').value = 'pw';
    byText(root, 'button', 'Sign in').click();
    await settle();
    expect(fetchMock.mock.calls[0][0]).toBe('https://staging.example.com/api/v1/auth/login');
    expect(onAuthed).toHaveBeenCalled();
    expect(session.data.accessToken).toBe('a');
    expect(storage.data).toMatchObject({ refreshToken: 'r', sessionUserId: 'u1', sessionApiBase: 'https://staging.example.com/api/v1' });
  });

  it('shows why the user is back at sign-in', () => {
    const { root } = render(fakeStorage(), { notice: 'Your session has ended.' });
    expect(root.textContent).toContain('Your session has ended.');
  });
});

describe('SettingsScreen', () => {
  function settingsCtx(queue = []) {
    return {
      storage: fakeStorage({ apiBase: DEFAULTS.apiBase, appBase: DEFAULTS.appBase, syncQueue: queue }),
      me: { id: 'u1', name: 'Me', email: 'me@example.com' },
      signOut: vi.fn(async () => {}),
      requestSync: vi.fn(),
      afterMutation: vi.fn(),
    };
  }

  it('EXT-04: refuses an insecure API address and signs out when the host changes', async () => {
    const ctx = settingsCtx();
    const root = SettingsScreen(ctx);
    document.body.append(root);
    await settle();
    const api = root.querySelector('#set-api');
    api.value = 'http://evil.example.com/api/v1';
    byText(root, 'button', 'Save').click();
    await settle();
    expect(root.textContent).toMatch(/https:\/\//);
    expect(ctx.storage.data.apiBase).toBe(DEFAULTS.apiBase);
    expect(ctx.signOut).not.toHaveBeenCalled();

    vi.stubGlobal('confirm', vi.fn(() => true));
    api.value = 'https://staging.example.com/api/v1';
    byText(root, 'button', 'Save').click();
    await settle();
    expect(globalThis.chrome.permissions.request).toHaveBeenCalledWith({ origins: ['https://staging.example.com/*'] });
    expect(ctx.storage.data.apiBase).toBe('https://staging.example.com/api/v1');
    expect(ctx.signOut).toHaveBeenCalled();
  });

  it('XP-06: lists changes that failed to sync with Retry / Discard', async () => {
    const ctx = settingsCtx([
      { id: 'q1', userId: 'u1', kind: 'comment.add', status: 'failed', lastError: '404 — Task not found', payload: {} },
      { id: 'q2', userId: 'someone-else', kind: 'comment.add', status: 'failed', payload: {} },
    ]);
    const root = SettingsScreen(ctx);
    document.body.append(root);
    await settle();
    expect(root.textContent).toContain('1 change could not be synced');
    expect(root.textContent).toContain('404 — Task not found');
    byText(root, 'button', 'Discard').click();
    await settle();
    expect(ctx.storage.data.syncQueue.map((i) => i.id)).toEqual(['q2']);
  });

  it('XP-01: warns before signing out with unsynced changes', async () => {
    const ctx = settingsCtx([{ id: 'q1', userId: 'u1', kind: 'chat.send', status: 'pending', payload: {} }]);
    const root = SettingsScreen(ctx);
    document.body.append(root);
    await settle();
    const confirm = vi.fn(() => false);
    vi.stubGlobal('confirm', confirm);
    byText(root, 'button', 'Sign out').click();
    await settle();
    expect(confirm.mock.calls[0][0]).toMatch(/1 change/);
    expect(ctx.signOut).not.toHaveBeenCalled();
    confirm.mockReturnValue(true);
    byText(root, 'button', 'Sign out').click();
    await settle();
    expect(ctx.signOut).toHaveBeenCalled();
  });
});

describe('ChatScreen inbox (CHAT-01)', () => {
  it('never shows a deleted message’s text, even from data cached by an older version', async () => {
    const ctx = {
      params: {},
      me: { id: 'u1' },
      navigate: vi.fn(),
      api: {
        projects: { list: async () => ({ data: [{ id: 'p1', name: 'Ops' }] }) },
        chat: {
          conversations: async () => ({
            data: [
              { conversation: { id: 'cv1', kind: 'PROJECT', projectId: 'p1' }, participants: [], unread: 1, lastMessage: { body: 'channel secret', deletedAt: '2026-09-26T09:00:00Z' } },
              { conversation: { id: 'cv2', kind: 'DIRECT' }, participants: [{ userId: 'u1' }, { userId: 'u2' }], unread: 0, lastMessage: { body: 'dm secret', deletedAt: '2026-09-26T09:00:00Z' } },
            ],
          }),
        },
        directory: async () => ({ data: [{ id: 'u2', firstName: 'Ada', lastName: 'L' }] }),
      },
    };
    const root = ChatScreen(ctx);
    await settle();
    expect(root.textContent).not.toContain('secret');
    expect(root.textContent).toContain('Message deleted');
  });
});

describe('TaskDetail', () => {
  it('EXT-02: "Unassign me" sends a task.unassign write', async () => {
    const ctx = {
      params: { taskId: 't1' },
      me: { id: 'u1', name: 'Me', email: '' },
      api: {
        tasks: {
          get: async () => ({ data: { id: 't1', key: 'OPS-1', title: 'Task', priority: 'NORMAL' } }),
          assignees: async () => ({ data: [{ id: 'u1', firstName: 'Me' }] }),
          checklist: async () => ({ data: { items: [], done: 0, total: 0 } }),
          comments: async () => ({ data: [] }),
        },
        directory: async () => ({ data: [] }),
      },
      write: vi.fn(async () => ({ queued: false })),
      afterMutation: vi.fn(),
    };
    const root = TaskDetail(ctx, () => {});
    await settle();
    byText(root, 'button', 'Unassign me').click();
    await settle();
    expect(ctx.write).toHaveBeenCalledWith('task.unassign', { id: 't1', userId: 'u1' });
    expect(byText(root, 'button', 'Assign me')).toBeTruthy();
  });
});

describe('DashboardScreen (XP-03)', () => {
  it('a task due today is not overdue at 09:00 in Muscat (05:00 UTC)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-30T05:00:00Z'));
    const ctx = {
      timeZone: TZ,
      openTask: vi.fn(),
      api: { tasks: { mine: async () => ({ data: [{ id: 't1', title: 'Report', columnCategory: 'TODO', dueDate: '2026-09-30T00:00:00.000Z' }], stale: false }) } },
    };
    const root = DashboardScreen(ctx);
    await settle();
    const stats = [...root.querySelectorAll('.stat')].map((s) => s.textContent);
    expect(stats).toContain('1Due today');
    expect(stats).toContain('0Overdue');
  });
});
