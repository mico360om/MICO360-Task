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
import { ReportsScreen } from '../app/screens/reports.js';
import { ApiError } from './errors.js';
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

describe('BoardScreen — recurring tasks', () => {
  it('marks the cards of repeating tasks', async () => {
    const ctx = boardCtx();
    ctx.api.tasks.list = vi.fn(async () => ({ data: [
      { id: 't1', title: 'Daily check', columnId: 'c1', priority: 'NORMAL', recurrenceRule: { freq: 'DAILY', interval: 1 } },
      { id: 't2', title: 'One-off', columnId: 'c1', priority: 'NORMAL' },
    ] }));
    const root = BoardScreen(ctx);
    await settle();
    const cards = [...root.querySelectorAll('.tcard')];
    expect(cards[0].querySelector('[aria-label="Repeats"]')).toBeTruthy();
    expect(cards[1].querySelector('[aria-label="Repeats"]')).toBeNull();
  });

  it('completing a repeating task reloads the board, so its next copy shows up', async () => {
    const ctx = boardCtx();
    ctx.api.projects.columns = async () => ({ data: [
      { id: 'c1', name: 'To do', category: 'TODO', enabled: true, position: 0 },
      { id: 'c9', name: 'Done', category: 'DONE', enabled: true, position: 1 },
    ] });
    let listCalls = 0;
    ctx.api.tasks.list = vi.fn(async () => {
      listCalls += 1;
      const first = { id: 't1', title: 'Daily check', columnId: listCalls === 1 ? 'c1' : 'c9', priority: 'NORMAL', recurrenceRule: listCalls === 1 ? { freq: 'DAILY', interval: 1 } : null };
      return { data: listCalls === 1 ? [first] : [first, { id: 't2', title: 'Daily check', columnId: 'c1', priority: 'NORMAL', recurrenceRule: { freq: 'DAILY', interval: 1 } }] };
    });
    const root = BoardScreen(ctx);
    await settle();
    const [todo, doneCol] = [...root.querySelectorAll('.column')];
    todo.querySelector('.tcard').dispatchEvent(new Event('dragstart', { bubbles: true }));
    doneCol.dispatchEvent(new Event('drop', { bubbles: true, cancelable: true }));
    await settle();
    expect(ctx.write).toHaveBeenCalledWith('task.move', { id: 't1', columnId: 'c9', position: 0 });
    expect(ctx.api.tasks.list).toHaveBeenCalledTimes(2);
    expect(root.querySelectorAll('.tcard')).toHaveLength(2);
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

describe('TaskDetail — due date and repeat', () => {
  function detailCtx(task) {
    return {
      params: { taskId: task.id },
      me: { id: 'u1', name: 'Me', email: '' },
      timeZone: TZ,
      api: {
        tasks: {
          get: async () => ({ data: task }),
          assignees: async () => ({ data: [] }),
          checklist: async () => ({ data: { items: [], done: 0, total: 0 } }),
          comments: async () => ({ data: [] }),
        },
        directory: async () => ({ data: [] }),
      },
      write: vi.fn(async () => ({ queued: false })),
      afterMutation: vi.fn(),
    };
  }
  const change = (node, value) => { node.value = value; node.dispatchEvent(new Event('change', { bubbles: true })); };

  it('sets a due date and makes the task repeat, saving each change (offline-queued writes)', async () => {
    const ctx = detailCtx({ id: 't1', key: 'OPS-1', title: 'Report', priority: 'NORMAL', dueDate: null, recurrenceRule: null });
    const root = TaskDetail(ctx, () => {});
    await settle();
    change(byLabel(root, 'Due date'), '2026-10-13');
    await settle();
    expect(ctx.write).toHaveBeenCalledWith('task.update', { id: 't1', patch: { dueDate: '2026-10-13' } });
    change(byLabel(root, 'Repeat'), 'MONTHLY');
    await settle();
    expect(ctx.write).toHaveBeenLastCalledWith('task.update', { id: 't1', patch: { recurrenceRule: { freq: 'MONTHLY', interval: 1 } } });
    change(byLabel(root, 'Monthly on'), 'WEEKDAY');
    await settle();
    // Suggested from the due date: 13 Oct 2026 is the 2nd Tuesday.
    expect(ctx.write).toHaveBeenLastCalledWith('task.update', { id: 't1', patch: { recurrenceRule: { freq: 'MONTHLY', interval: 1, nthWeekday: { week: 2, day: 2 } } } });
    change(byLabel(root, 'Create the next copy'), 'ON_SCHEDULE');
    await settle();
    expect(ctx.write).toHaveBeenLastCalledWith('task.update', { id: 't1', patch: { recurrenceRule: { freq: 'MONTHLY', interval: 1, nthWeekday: { week: 2, day: 2 }, createNext: 'ON_SCHEDULE' } } });
    expect(root.textContent).toContain('Repeats every month on the 2nd Tuesday · new copy on each date');
  });

  it('picks weekdays for a weekly repeat and can stop repeating', async () => {
    const ctx = detailCtx({ id: 't1', key: 'OPS-1', title: 'Standup', priority: 'NORMAL', dueDate: '2026-10-01T00:00:00.000Z', recurrenceRule: { freq: 'WEEKLY', interval: 1 } });
    const root = TaskDetail(ctx, () => {});
    await settle();
    expect(byLabel(root, 'Due date').value).toBe('2026-10-01');
    byLabel(root, 'Sun').click();
    await settle();
    expect(ctx.write).toHaveBeenLastCalledWith('task.update', { id: 't1', patch: { recurrenceRule: { freq: 'WEEKLY', interval: 1, weekdays: [0] } } });
    change(byLabel(root, 'Repeat'), 'NONE');
    await settle();
    expect(ctx.write).toHaveBeenLastCalledWith('task.update', { id: 't1', patch: { recurrenceRule: null } });
  });

  it('an earlier copy of a series points to the newest copy instead of starting a second series', async () => {
    const ctx = detailCtx({ id: 't0', key: 'OPS-1', title: 'Standup', priority: 'NORMAL', recurrenceRule: null, recurrenceParentId: 'origin', recurrenceNextId: 't1' });
    const root = TaskDetail(ctx, () => {});
    await settle();
    expect(root.textContent).toContain('change the repeat on its newest copy');
    expect(byLabel(root, 'Repeat')).toBeNull();
  });

  it('the newest copy can turn its repeat back on after it was switched off', async () => {
    const ctx = detailCtx({ id: 't1', key: 'OPS-2', title: 'Standup', priority: 'NORMAL', recurrenceRule: null, recurrenceParentId: 'origin', recurrenceNextId: null });
    const root = TaskDetail(ctx, () => {});
    await settle();
    change(byLabel(root, 'Repeat'), 'DAILY');
    await settle();
    expect(ctx.write).toHaveBeenLastCalledWith('task.update', { id: 't1', patch: { recurrenceRule: { freq: 'DAILY', interval: 1 } } });
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

describe('ReportsScreen', () => {
  const projectRows = [
    { projectId: 'p1', projectName: 'Ops', total: 10, completed: 4, overdue: 2, completionPct: 40 },
    { projectId: 'p2', projectName: 'Rig Inspection', total: 5, completed: 5, overdue: 0, completionPct: 100 },
  ];
  const workloadRows = [
    { userId: 'u1', username: 'aisha', name: 'Aisha Khan', assigned: 6, completed: 3, overdue: 1 },
    { userId: 'u2', username: 'omar', name: 'Omar Ahmed', assigned: 4, completed: 4, overdue: 0 },
  ];
  function reportsCtx(over = {}) {
    return {
      timeZone: TZ,
      isOnline: () => true,
      api: {
        reports: {
          projects: vi.fn(async (f = {}) => (f.projectId ? projectRows.filter((r) => r.projectId === f.projectId) : projectRows)),
          status: vi.fn(async () => ({ TODO: 5, IN_PROGRESS: 1, DONE: 9 })),
          workload: vi.fn(async (f = {}) => (f.userId ? workloadRows.filter((w) => w.userId === f.userId) : workloadRows)),
          completion: vi.fn(async () => ({ total: 9, completed: 9, onTime: 6, late: 2, unclassified: 1, onTimeRate: 75 })),
          timeseries: vi.fn(async () => ({ from: '2026-09-02', to: '2026-10-01', velocityPerWeek: 2.1, points: [
            { date: '2026-09-30', created: 2, completed: 1, overdue: 3, remaining: 9, ideal: 9 },
            { date: '2026-10-01', created: 1, completed: 4, overdue: 2, remaining: 6, ideal: 4 },
          ] })),
        },
        download: vi.fn(async () => ({ blob: new Blob(['x']), fileName: 'tasks-report-2026-10-01.xlsx' })),
      },
      saveFile: vi.fn(),
      ...over,
    };
  }
  const change = (node, value) => { node.value = value; node.dispatchEvent(new Event('change', { bubbles: true })); };

  it('shows the summary, status, period and the project and team tables', async () => {
    const ctx = reportsCtx();
    const root = ReportsScreen(ctx);
    await settle();
    const text = root.textContent;
    expect(text).toContain('15Total tasks');
    expect(text).toContain('60% completion');
    expect(text).toContain('75%On-time rate');
    expect(text).toContain('6 on time · 2 late');
    expect(text).toContain('Rig Inspection');
    expect(text).toContain('Aisha Khan');
    expect(text).toContain('5Completed in period');
    expect(text).toContain('2Overdue now');
    const today = todayKey(TZ);
    expect(ctx.api.reports.timeseries).toHaveBeenCalledWith({ from: shiftDayKey(today, -29), to: today });
  });

  it('filters by project and team member, and the export carries the filters and period', async () => {
    const ctx = reportsCtx();
    const root = ReportsScreen(ctx);
    await settle();
    change(byLabel(root, 'Filter by project'), 'p2');
    await settle();
    change(byLabel(root, 'Filter by team member'), 'u1');
    await settle();
    expect(ctx.api.reports.status).toHaveBeenLastCalledWith({ projectId: 'p2', userId: 'u1' });
    expect(root.textContent).toContain('5Total tasks');
    expect(root.textContent).toContain('Showing Rig Inspection · Aisha Khan’s tasks');
    byText(root, 'button', '7d').click();
    await settle();
    const today = todayKey(TZ);
    byLabel(root, 'Export as PDF').click();
    await settle();
    expect(ctx.api.download).toHaveBeenCalledWith(`/reports/export.pdf?projectId=p2&userId=u1&from=${shiftDayKey(today, -6)}&to=${today}`);
    expect(ctx.saveFile).toHaveBeenCalledWith(expect.any(Blob), 'tasks-report-2026-10-01.xlsx');
  });

  it('exports a single report as Excel or CSV (CSV not offered for the full report)', async () => {
    const ctx = reportsCtx();
    ctx.api.download = vi.fn(async () => ({ blob: new Blob(['x']), fileName: null }));
    const root = ReportsScreen(ctx);
    await settle();
    expect(byLabel(root, 'Export as CSV').disabled).toBe(true);
    change(byLabel(root, 'Report to export'), 'workload');
    expect(byLabel(root, 'Export as CSV').disabled).toBe(false);
    byLabel(root, 'Export as Excel').click();
    await settle();
    expect(ctx.api.download).toHaveBeenCalledWith('/reports/workload.xlsx');
    expect(ctx.saveFile).toHaveBeenCalledWith(expect.any(Blob), `user-workload-${todayKey(TZ)}.xlsx`);
  });

  it('says so when the export fails, and when the user is not an admin', async () => {
    const ctx = reportsCtx();
    ctx.api.download = vi.fn(async () => { throw new ApiError(500); });
    const root = ReportsScreen(ctx);
    await settle();
    byLabel(root, 'Export as Excel').click();
    await settle();
    expect(root.querySelector('[role="alert"]').textContent).toContain('Couldn’t export the report');
    expect(ctx.saveFile).not.toHaveBeenCalled();

    const denied = reportsCtx();
    denied.api.reports.projects = vi.fn(async () => { throw new ApiError(403); });
    const r2 = ReportsScreen(denied);
    await settle();
    expect(r2.textContent).toContain('Reports are available to administrators.');
  });
});

describe('TaskDetail — export', () => {
  function exportCtx(download) {
    return {
      params: { taskId: 't1' },
      me: { id: 'u1', name: 'Me', email: '' },
      timeZone: TZ,
      isOnline: () => true,
      api: {
        tasks: {
          get: async () => ({ data: { id: 't1', key: 'OPS-7', title: 'Inspect the rig', priority: 'NORMAL' } }),
          assignees: async () => ({ data: [] }),
          checklist: async () => ({ data: { items: [], done: 0, total: 0 } }),
          comments: async () => ({ data: [] }),
        },
        directory: async () => ({ data: [] }),
        download,
      },
      saveFile: vi.fn(),
      write: vi.fn(async () => ({ queued: false })),
      afterMutation: vi.fn(),
    };
  }

  it('downloads the task as Excel or PDF', async () => {
    const ctx = exportCtx(vi.fn(async () => ({ blob: new Blob(['x']), fileName: null })));
    const root = TaskDetail(ctx, () => {});
    await settle();
    byLabel(root, 'Export task as PDF').click();
    await settle();
    expect(ctx.api.download).toHaveBeenCalledWith('/tasks/t1/export.pdf');
    expect(ctx.saveFile).toHaveBeenCalledWith(expect.any(Blob), 'OPS-7-inspect-the-rig.pdf');
    byLabel(root, 'Export task as Excel').click();
    await settle();
    expect(ctx.api.download).toHaveBeenLastCalledWith('/tasks/t1/export.xlsx');
  });

  it('explains a failed export, and that exports need a connection', async () => {
    const ctx = exportCtx(vi.fn(async () => { throw new ApiError(500); }));
    const root = TaskDetail(ctx, () => {});
    await settle();
    byLabel(root, 'Export task as Excel').click();
    await settle();
    expect(root.querySelector('[role="alert"]').textContent).toContain('Couldn’t export the task');
    ctx.isOnline = () => false;
    byLabel(root, 'Export task as PDF').click();
    await settle();
    expect(root.querySelector('[role="alert"]').textContent).toContain('Exports need a connection');
  });
});
