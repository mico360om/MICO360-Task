// @vitest-environment jsdom
/**
 * Stage 7: the side panel — Today (what is overdue and due today for me, in company time), My Tasks
 * (reading itself again in place, so the search and filters stay), its own short header and tabs,
 * the new-task form inside it, and the buttons that open it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MyTasksScreen } from '../app/screens/my-tasks.js';
import { TodayScreen } from '../app/screens/today.js';
import { PanelShell } from '../app/panel-shell.js';
import { QuickAddForm } from '../popup/quick-add-form.js';
import { formatDayKey } from './due-date.js';
import { DRAFT_KEY, PANEL_DRAFT_KEY, QUICK_ADD_SESSION_KEYS } from './quick-add.js';
import { fakeStorage } from './test-helpers.js';

const TZ = 'Asia/Muscat';
const settle = async () => {
  for (let i = 0; i < 10; i += 1) await new Promise((r) => setTimeout(r, 0));
};
const byText = (root, sel, text) => [...root.querySelectorAll(sel)].find((n) => n.textContent.trim() === text);
const byLabel = (root, label) => root.querySelector(`[aria-label="${label}"]`);
const rowTitles = (root) => [...root.querySelectorAll('.task-row .tt')].map((n) => n.textContent);
const sectionNames = (root) => [...root.querySelectorAll('.mt-section .section-title')].map((n) => n.textContent);
const section = (root, name) => [...root.querySelectorAll('.mt-section')].find((s) => s.querySelector('.section-title').textContent.startsWith(name));
const rowOf = (root, id) => [...root.querySelectorAll('.task-row')].find((r) => r.dataset.taskId === id);

beforeEach(() => {
  document.body.innerHTML = '';
});
afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
});

const PROJECTS = [{ id: 'p1', code: 'RIG', name: 'Rig Inspection', status: 'ACTIVE' }];
const COLUMNS = [
  { id: 'r1', name: 'To do', category: 'TODO', enabled: true, position: 0 },
  { id: 'r9', name: 'Done', category: 'DONE', enabled: true, position: 5 },
];
const task = (id, title, extra = {}) => ({ id, key: `RIG-${id}`, title, priority: 'NORMAL', projectId: 'p1', columnId: 'r1', columnCategory: 'TODO', dueDate: null, progress: 0, completedAt: null, ...extra });

function listCtx(tasks, over = {}) {
  return {
    params: {}, query: {},
    timeZone: TZ,
    isOnline: () => true,
    api: {
      tasks: { mine: vi.fn(async () => ({ data: tasks.map((t) => ({ ...t })) })) },
      projects: { list: vi.fn(async () => ({ data: PROJECTS })), columns: vi.fn(async () => ({ data: COLUMNS })) },
    },
    openTask: vi.fn(),
    write: vi.fn(async (kind, p) => ({ queued: false, data: { ...tasks.find((t) => t.id === p.id), columnId: p.columnId, columnCategory: 'DONE', completedAt: new Date().toISOString(), progress: 100 } })),
    afterMutation: vi.fn(),
    ...over,
  };
}

async function show(node) {
  document.body.append(node);
  await settle();
  return node;
}

describe('My Tasks reads itself again in place (Stage 7: on coming back, and every minute in the side panel)', () => {
  const MINE = [task('1', 'Valve check'), task('2', 'Book the crane'), task('3', 'Approve invoices')];

  it('keeps the search box, what was typed in it and the focused row; shows what changed; no loading spinner', async () => {
    const ctx = listCtx(MINE);
    const root = await show(MyTasksScreen(ctx));
    const search = byLabel(root, 'Search my tasks');
    search.value = 'valve';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    expect(rowTitles(root)).toEqual(['Valve check']);
    rowOf(root, '1').focus();
    ctx.api.tasks.mine.mockResolvedValueOnce({ data: [...MINE, task('4', 'Valve grease')] });

    expect(root.refresh()).toBe(true); // read in place: the app doesn't build the screen again
    expect(root.querySelector('.spinner')).toBeNull();
    await settle();
    expect(ctx.api.tasks.mine).toHaveBeenCalledTimes(2);
    expect(byLabel(root, 'Search my tasks')).toBe(search);
    expect(search.value).toBe('valve');
    expect(rowTitles(root).sort()).toEqual(['Valve check', 'Valve grease']);
    expect(document.activeElement.dataset.taskId).toBe('1');
  });

  it('a read that fails keeps the list on screen (it is not swapped for an error)', async () => {
    const ctx = listCtx(MINE);
    const root = await show(MyTasksScreen(ctx));
    ctx.api.tasks.mine.mockRejectedValueOnce(new Error('offline'));
    root.refresh();
    await settle();
    expect(rowTitles(root)).toHaveLength(3);
    expect(root.querySelector('[role="alert"]')).toBeNull();
  });

  it('doesn’t read again while a task is being marked done (an older answer would undo it on screen)', async () => {
    let release;
    const ctx = listCtx(MINE, { write: vi.fn(() => new Promise((r) => { release = r; })) });
    const root = await show(MyTasksScreen(ctx));
    byLabel(root, 'Mark done: “Valve check”').click();
    await settle();
    expect(ctx.write).toHaveBeenCalledTimes(1);
    root.refresh();
    await settle();
    expect(ctx.api.tasks.mine).toHaveBeenCalledTimes(1);
    release({ queued: false, data: { ...MINE[0], columnId: 'r9', columnCategory: 'DONE', completedAt: '2026-10-21T06:00:00Z', progress: 100 } });
    await settle();
    expect(section(root, 'Completed').textContent).toContain('Valve check');
  });

  it('an answer that comes after the task was marked done is dropped', async () => {
    let answer;
    const ctx = listCtx(MINE);
    const root = await show(MyTasksScreen(ctx));
    ctx.api.tasks.mine.mockImplementationOnce(() => new Promise((r) => { answer = r; }));
    root.refresh(); // the read starts …
    byLabel(root, 'Mark done: “Valve check”').click(); // … then a task is marked done
    await settle();
    answer({ data: MINE.map((t) => ({ ...t })) }); // still "To do" on the server when it was read
    await settle();
    expect(section(root, 'Completed').textContent).toContain('Valve check');
  });
});

describe('Today in the side panel (Stage 7)', () => {
  // 10:00 on Wednesday 21 October 2026 in Muscat.
  const NOW = new Date('2026-10-21T06:00:00Z');
  const TASKS = [
    task('o', 'Send the site report', { dueDate: '2026-10-19T00:00:00.000Z', priority: 'HIGH' }),
    task('t', 'Call the crane company', { dueDate: '2026-10-21T00:00:00.000Z' }),
    task('n', 'Order gaskets', { dueDate: '2026-10-22T00:00:00.000Z' }),
    task('x', 'Tidy the store room'),
    task('d', 'Sign the permit', { columnId: 'r9', columnCategory: 'DONE', completedAt: '2026-10-21T04:30:00Z', progress: 100 }),
    task('y', 'Old inspection', { columnId: 'r9', columnCategory: 'DONE', completedAt: '2026-10-20T08:00:00Z', progress: 100, dueDate: '2026-10-20T00:00:00.000Z' }),
  ];
  beforeEach(() => {
    vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
  });

  it('shows what is overdue and what is due today for me, and what I finished today — nothing else', async () => {
    const root = await show(TodayScreen(listCtx(TASKS)));
    expect(sectionNames(root)).toEqual(['Overdue · 1', 'Due today · 1', 'Done today · 1']);
    expect(section(root, 'Overdue').textContent).toContain('Send the site report');
    expect(section(root, 'Due today').textContent).toContain('Call the crane company');
    expect(section(root, 'Done today').textContent).toContain('Sign the permit');
    expect(root.textContent).not.toContain('Order gaskets');
    expect(root.textContent).not.toContain('Tidy the store room');
    expect(root.textContent).not.toContain('Old inspection');
  });

  it('says which day today is (the company’s), with no search or filters — a short list for a narrow panel', async () => {
    const root = await show(TodayScreen(listCtx(TASKS)));
    expect(root.querySelector('.today-date').textContent).toBe(formatDayKey('2026-10-21'));
    expect(byLabel(root, 'Search my tasks')).toBeNull();
    expect(byLabel(root, 'Filter by project')).toBeNull();
    expect(byLabel(root, 'Sort tasks')).toBeNull();
  });

  it('uses the company’s calendar day: at 01:30 in Muscat (still the 20th in London) the 21st is today', async () => {
    vi.setSystemTime(new Date('2026-10-20T21:30:00Z'));
    const root = await show(TodayScreen(listCtx(TASKS)));
    expect(section(root, 'Due today').textContent).toContain('Call the crane company');
    expect(root.querySelector('.today-date').textContent).toBe(formatDayKey('2026-10-21'));
  });

  it('“Mark done” moves it to its project’s Done column: it goes under Done today, focus stays on it, and it says so', async () => {
    const ctx = listCtx(TASKS);
    const root = await show(TodayScreen(ctx));
    const btn = byLabel(root, 'Mark done: “Call the crane company”');
    btn.focus();
    btn.click();
    await settle();
    expect(ctx.write).toHaveBeenCalledWith('task.move', { id: 't', columnId: 'r9', columnCategory: 'DONE' });
    expect(section(root, 'Due today')).toBeUndefined();
    expect(section(root, 'Done today').textContent).toContain('Call the crane company');
    expect(document.activeElement.dataset.taskId).toBe('t');
    expect(root.querySelector('.sr-only[role="status"]').textContent).toBe('“Call the crane company” is done.');
  });

  it('a row opens the task’s panel', async () => {
    const ctx = listCtx(TASKS);
    const root = await show(TodayScreen(ctx));
    rowOf(root, 'o').click();
    expect(ctx.openTask).toHaveBeenCalledWith('o');
  });

  it('nothing due: says so, and still lists what was finished today', async () => {
    const root = await show(TodayScreen(listCtx(TASKS.filter((t) => !['o', 't'].includes(t.id)))));
    expect(root.querySelector('.state-title').textContent).toBe('Nothing due today');
    expect(sectionNames(root)).toEqual(['Done today · 1']);
    const none = await show(TodayScreen(listCtx([])));
    expect(none.querySelector('.state-title').textContent).toBe('No tasks assigned');
  });

  it('reads itself again in place', async () => {
    const ctx = listCtx(TASKS);
    const root = await show(TodayScreen(ctx));
    ctx.api.tasks.mine.mockResolvedValueOnce({ data: [...TASKS, task('z', 'Fix the gate', { dueDate: '2026-10-21T00:00:00.000Z' })] });
    expect(root.refresh()).toBe(true);
    await settle();
    expect(section(root, 'Due today').textContent).toContain('Fix the gate');
    expect(byText(root, '.section-title', 'Due today · 2')).toBeTruthy();
  });
});

describe('the side panel’s own header and tabs (Stage 7)', () => {
  it('names the app, says how it is connected, and has “Open MICO360 Tasks” (the full app page)', () => {
    const onOpenApp = vi.fn();
    const shell = PanelShell({ onOpenApp });
    document.body.append(shell.node);
    expect(shell.node.querySelector('.panel-brand').textContent).toBe('MICO360');
    expect(shell.node.contains(shell.connEl)).toBe(true);
    expect(shell.node.contains(shell.offbar)).toBe(true);
    const open = byText(shell.node, 'button', 'Open MICO360 Tasks');
    open.click();
    expect(onOpenApp).toHaveBeenCalledTimes(1);
  });

  it('three tabs — Today, My Tasks, Add a task — as links in a named navigation; the one shown is the current page', () => {
    const shell = PanelShell({ onOpenApp: vi.fn() });
    document.body.append(shell.node);
    const nav = shell.node.querySelector('nav');
    expect(nav.getAttribute('aria-label')).toBe('Side panel');
    const links = [...nav.querySelectorAll('a')];
    expect(links.map((a) => [a.textContent, a.getAttribute('href')])).toEqual([['Today', '#/'], ['My Tasks', '#/my-tasks'], ['Add a task', '#/add']]);
    shell.setActive('/my-tasks', 'My Tasks');
    expect(links.map((a) => a.getAttribute('aria-current'))).toEqual([null, 'page', null]);
    expect(shell.node.querySelector('h1').textContent).toBe('My Tasks');
    shell.setActive('/', 'Today');
    expect(links.map((a) => a.getAttribute('aria-current'))).toEqual(['page', null, null]);
    shell.setActive('/task/t1', 'Task'); // a task's panel over a list: the tab stays as it was
    expect(links.map((a) => a.getAttribute('aria-current'))).toEqual(['page', null, null]);
    expect(shell.node.querySelector('h1').textContent).toBe('Today');
  });

  it('a polite live region the screens can speak through, and a place for them', () => {
    const shell = PanelShell({ onOpenApp: vi.fn() });
    expect(shell.live.getAttribute('aria-live')).toBe('polite');
    expect(shell.node.contains(shell.content)).toBe(true);
  });
});

describe('the new-task form in the side panel (Stage 7)', () => {
  const PROJ = [{ id: 'p1', name: 'Ops', code: 'OPS', status: 'ACTIVE' }];
  function panelCtx(over = {}) {
    let n = 0;
    return {
      me: { id: 'me', name: 'Mariam' },
      timeZone: TZ,
      appBase: 'https://task.mico360.com',
      local: fakeStorage(),
      session: fakeStorage(over.session || {}),
      isOnline: () => true,
      api: {
        projects: {
          list: vi.fn(async () => ({ data: PROJ })),
          columns: vi.fn(async () => ({ data: [{ id: 'c1', name: 'To do', category: 'TODO', position: 0, enabled: true }] })),
          members: vi.fn(async () => ({ data: [] })),
        },
        ai: { parseTask: vi.fn() },
        attachments: { upload: vi.fn() },
      },
      newKey: () => `key-${(n += 1)}`,
      send: vi.fn(async (kind, payload) => ({ queued: false, data: { id: 't9', key: 'OPS-12', title: payload.title, projectId: payload.projectId } })),
      currentPage: vi.fn(async () => null),
      capture: null,
      openApp: vi.fn(),
      close: vi.fn(),
      inPanel: true,
      ...over.ctx,
    };
  }
  const type = (node, value) => { node.value = value; node.dispatchEvent(new Event('input', { bubbles: true })); };

  it('has no header of its own, no “Add this page” and no shortcut tip (the panel has its own header; Chrome lets only the popup read the page)', async () => {
    const ctx = panelCtx();
    const root = await show(QuickAddForm(ctx));
    expect(root.querySelector('.qa-head')).toBeNull();
    expect(byText(root, 'button', 'Open MICO360 Tasks')).toBeUndefined();
    expect(byText(root, 'button', 'Add this page')).toBeUndefined();
    expect(root.querySelector('.qa-foot').textContent).toBe('');
    expect(root.querySelector('form').getAttribute('aria-label')).toBe('New task');
  });

  it('creates the task through the app’s write with its own key; “Open it” opens its panel here, and the side panel stays open', async () => {
    const ctx = panelCtx();
    const root = await show(QuickAddForm(ctx));
    type(document.getElementById('qa-title'), 'Call the crane company');
    root.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await settle();
    expect(ctx.send).toHaveBeenCalledWith('task.create', expect.objectContaining({ title: 'Call the crane company', projectId: 'p1' }), { idempotencyKey: 'key-1', hold: false });
    byText(root, 'button', 'Open it').click();
    await settle();
    expect(ctx.openApp).toHaveBeenCalledWith('#/task/t9');
    expect(ctx.close).not.toHaveBeenCalled();
  });

  it('keeps what was typed under its own key (not the popup’s), and sign-out takes it too', async () => {
    const ctx = panelCtx();
    await show(QuickAddForm(ctx));
    type(document.getElementById('qa-title'), 'Half typed');
    await settle();
    expect(ctx.session.data[PANEL_DRAFT_KEY]).toMatchObject({ userId: 'me', fields: { title: 'Half typed' } });
    expect(ctx.session.data[DRAFT_KEY]).toBeUndefined();
    expect(QUICK_ADD_SESSION_KEYS).toContain(PANEL_DRAFT_KEY);
    document.body.innerHTML = '';
    // Opened again (the panel was closed): it comes back.
    const again = panelCtx({ session: { [PANEL_DRAFT_KEY]: ctx.session.data[PANEL_DRAFT_KEY], [DRAFT_KEY]: { userId: 'me', fields: { title: 'The popup’s' } } } });
    await show(QuickAddForm(again));
    expect(document.getElementById('qa-title').value).toBe('Half typed');
  });
});

describe('the toolbar popup opens the side panel (Stage 7)', () => {
  const popupCtx = (over = {}) => ({
    me: { id: 'me', name: 'Mariam' }, timeZone: TZ, appBase: 'https://task.mico360.com', appPage: 'chrome-extension://abc/app/app.html',
    local: fakeStorage(), session: fakeStorage(), isOnline: () => true,
    api: { projects: { list: vi.fn(async () => ({ data: [] })), columns: vi.fn(async () => ({ data: [] })), members: vi.fn(async () => ({ data: [] })) }, ai: { parseTask: vi.fn() }, attachments: { upload: vi.fn() } },
    newKey: () => 'k', send: vi.fn(), currentPage: vi.fn(async () => null), capture: null, openApp: vi.fn(), close: vi.fn(), shortcut: async () => 'Ctrl+Shift+K',
    ...over,
  });

  it('a labelled button in the popup’s header opens it, at once (in the same click)', async () => {
    const openPanel = vi.fn();
    const root = await show(QuickAddForm(popupCtx({ openPanel })));
    const btn = root.querySelector('.qa-head [aria-label="Open the side panel"]');
    expect(btn.tagName).toBe('BUTTON');
    expect(btn.getAttribute('title')).toBe('Show your tasks beside the page you are on');
    btn.click();
    expect(openPanel).toHaveBeenCalledTimes(1);
  });

  it('no button where Chrome can’t open it (or in the small window before Chrome 127)', async () => {
    const root = await show(QuickAddForm(popupCtx()));
    expect(root.querySelector('[aria-label="Open the side panel"]')).toBeNull();
  });
});
