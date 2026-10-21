// @vitest-environment jsdom
/**
 * Stage 4: the board, My Tasks and Projects at the web's level — a project's picture, number and
 * status in words, its dashboard on the website; cards with their people, counts, due day and
 * milestone; a task added in any column with the new-task form; My Tasks filtered by project,
 * sorted, and a task marked done from the list.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ProjectsScreen } from '../app/screens/projects.js';
import { BoardScreen } from '../app/screens/board.js';
import { MyTasksScreen } from '../app/screens/my-tasks.js';
import { ApiError } from './errors.js';
import { fakeStorage } from './test-helpers.js';

const TZ = 'Asia/Muscat';
const key = (node, k) => {
  const e = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true });
  node.dispatchEvent(e);
  return e;
};

const settle = async () => {
  for (let i = 0; i < 8; i += 1) await new Promise((r) => setTimeout(r, 0));
};
const byText = (root, sel, text) => [...root.querySelectorAll(sel)].find((n) => n.textContent.trim() === text);
const byLabel = (root, label) => root.querySelector(`[aria-label="${label}"]`);

beforeEach(() => {
  document.body.innerHTML = '';
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const PROJECTS = [
  { id: 'p1', code: 'RIG', number: 'JOB-2041', name: 'Rig Inspection', description: 'North field rigs', status: 'ON_HOLD', color: '#0F766E', icon: 'oil', imageUrl: null },
  { id: 'p2', code: 'OPS', number: null, name: 'Office Ops', description: null, status: 'ACTIVE', color: null, icon: null, imageUrl: null },
  { id: 'p3', code: 'SITE', number: null, name: 'Site Photos', description: null, status: 'PLANNING', color: '#1E5A8B', icon: null, imageUrl: '/uploads/site.png' },
];

function projectsCtx(over = {}) {
  return {
    params: {}, query: {},
    apiBase: 'http://localhost:4000/api/v1',
    appBase: 'http://localhost:5173',
    api: { projects: { list: vi.fn(async () => ({ data: over.projects ?? PROJECTS })) } },
    navigate: vi.fn(),
    ...over.ctx,
  };
}

describe('Projects: number, picture or icon, status in words, the dashboard on the web', () => {
  it('each card shows the project’s picture as the web does: its image, else its icon, else its initials, on its colour', async () => {
    const root = ProjectsScreen(projectsCtx());
    document.body.append(root);
    await settle();
    const cards = [...root.querySelectorAll('.project')];
    expect(cards).toHaveLength(3);
    const avatar = (card) => card.querySelector('.pavatar');
    expect(avatar(cards[0]).dataset.projectAvatar).toBe('icon');
    expect(avatar(cards[0]).querySelector('svg path')).toBeTruthy();
    expect(avatar(cards[0]).style.background).toBe('rgb(15, 118, 110)');
    expect(avatar(cards[1]).dataset.projectAvatar).toBe('initials');
    expect(avatar(cards[1]).textContent).toBe('OO');
    expect(avatar(cards[2]).dataset.projectAvatar).toBe('image');
    expect(avatar(cards[2]).querySelector('img').getAttribute('src')).toBe('http://localhost:4000/uploads/site.png');
    expect(avatar(cards[0]).getAttribute('aria-hidden')).toBe('true'); // the name is written beside it
  });

  it('a picture that won’t load falls back to the icon or initials', async () => {
    const root = ProjectsScreen(projectsCtx());
    document.body.append(root);
    await settle();
    const tile = root.querySelectorAll('.project')[2].querySelector('.pavatar');
    tile.querySelector('img').dispatchEvent(new Event('error'));
    const again = root.querySelectorAll('.project')[2].querySelector('.pavatar');
    expect(again.dataset.projectAvatar).toBe('initials');
    expect(again.textContent).toBe('SP');
  });

  it('the code, the project’s own number and its status in words', async () => {
    const root = ProjectsScreen(projectsCtx());
    document.body.append(root);
    await settle();
    const [rig, ops] = root.querySelectorAll('.project');
    expect(rig.querySelector('.code').textContent).toBe('RIG');
    expect(rig.querySelector('.pnumber').textContent).toBe('JOB-2041');
    expect(rig.querySelector('.pnumber').getAttribute('title')).toBe('Project number');
    expect(rig.querySelector('.pstatus').textContent).toBe('On hold');
    expect(ops.querySelector('.pnumber')).toBeNull();
    expect(ops.querySelector('.pstatus').textContent).toBe('Active');
    expect(root.textContent).not.toContain('ON_HOLD');
  });

  it('opens the board from the card; “Open dashboard on the web” opens the project’s page on the website in a new tab', async () => {
    const ctx = projectsCtx();
    const root = ProjectsScreen(ctx);
    document.body.append(root);
    await settle();
    const rig = root.querySelector('.project');
    const open = byLabel(rig, 'Open the board of Rig Inspection');
    expect(open.tagName).toBe('BUTTON');
    open.click();
    expect(ctx.navigate).toHaveBeenCalledWith('#/board/p1');
    const web = byText(rig, 'a', 'Open dashboard on the web ↗');
    expect(web.getAttribute('href')).toBe('http://localhost:5173/projects/p1');
    expect(web.getAttribute('target')).toBe('_blank');
    expect(web.getAttribute('rel')).toContain('noopener');
    expect(open.contains(web)).toBe(false); // two controls, not a link inside a button
  });
});

const COLUMNS = [
  { id: 'c1', name: 'To do', category: 'TODO', enabled: true, position: 0 },
  { id: 'c2', name: 'In progress', category: 'IN_PROGRESS', enabled: true, position: 1 },
  { id: 'c3', name: 'Blocked', category: 'BLOCKED', enabled: true, position: 2 },
  { id: 'c4', name: 'Done', category: 'DONE', enabled: true, position: 3 },
];
const PEOPLE = [{ id: 'u1', name: 'Mariam Al Hinai' }, { id: 'u2', name: 'Omar Ahmed' }, { id: 'u3', name: 'Aisha Khan' }, { id: 'u4', name: 'Bilal' }];

function boardCtx(over = {}) {
  return {
    params: { projectId: 'p1' },
    query: over.query ?? {},
    timeZone: TZ,
    apiBase: 'http://localhost:4000/api/v1',
    me: { id: 'u1', name: 'Mariam Al Hinai' },
    storage: fakeStorage(),
    isOnline: () => true,
    api: {
      projects: {
        get: async () => ({ data: { id: 'p1', code: 'OPS', name: 'Ops', color: '#1E5A8B', icon: 'cog', ownerId: 'u2', status: 'ACTIVE' } }),
        columns: async () => ({ data: COLUMNS }),
        progress: async () => ({ data: null }),
        members: async () => ({ data: [{ id: 'u1', firstName: 'Mariam', lastName: 'Al Hinai' }, { id: 'u2', firstName: 'Omar', lastName: 'Ahmed' }] }),
      },
      tasks: { list: vi.fn(async () => ({ data: over.tasks ?? [] })) },
    },
    navigate: vi.fn(),
    openTask: vi.fn(),
    write: over.write ?? vi.fn(async (kind, p) => ({ queued: false, data: { id: 't9', key: 'OPS-9', progress: 0, ...p } })),
    afterMutation: vi.fn(),
  };
}

async function openBoard(ctx) {
  const root = BoardScreen(ctx);
  document.body.append(root);
  await settle();
  return root;
}

const typeTitle = (value) => {
  const title = document.querySelector('#qa-title');
  title.value = value;
  title.dispatchEvent(new Event('input', { bubbles: true }));
  return title;
};
const openDialog = () => document.querySelector('[role="dialog"][aria-modal="true"]');

describe('Board cards: people, counts, due day and milestone, as on the web', () => {
  it('a card shows its due day — “Overdue” in company time — subtasks, comments, files, people and flags', async () => {
    const root = await openBoard(boardCtx({ tasks: [
      { id: 't1', key: 'OPS-1', title: 'Inspect the valve', priority: 'HIGH', columnId: 'c3', dueDate: '2020-01-05T00:00:00.000Z', progress: 40, isMilestone: true,
        counts: { comments: 3, attachments: 1, checklistDone: 2, checklistTotal: 5 }, assignees: PEOPLE },
      { id: 't2', key: 'OPS-2', title: 'Order spares', priority: 'NORMAL', columnId: 'c1', dueDate: '2099-03-01T00:00:00.000Z', progress: 0, assignees: [PEOPLE[1]] },
      { id: 't3', key: 'OPS-3', title: 'Filed report', priority: 'LOW', columnId: 'c4', dueDate: '2020-01-05T00:00:00.000Z', progress: 100, completedAt: '2020-01-04T10:00:00Z' },
    ] }));
    const card = (id) => [...root.querySelectorAll('.tcard')].find((c) => c.dataset.taskId === id);
    const late = card('t1');
    expect(late.querySelector('.tdue').textContent).toBe('Overdue · Jan 5, 2020');
    expect(late.querySelector('.tdue').classList.contains('overdue')).toBe(true);
    expect(late.classList.contains('overdue')).toBe(true);
    expect(late.querySelector('[aria-label="Subtasks done"]').textContent).toBe('2/5');
    expect(late.querySelector('[aria-label="Comments"]').textContent).toBe('3');
    expect(late.querySelector('[aria-label="Attachments"]').textContent).toBe('1');
    expect([...late.querySelectorAll('.tavatar')].map((a) => a.textContent)).toEqual(['MA', 'OA', 'AK']);
    expect(late.querySelector('.tmore').textContent).toBe('+1');
    expect(late.querySelector('[aria-label="Milestone"]')).toBeTruthy();
    expect(late.querySelector('.tblocked').textContent).toBe('Blocked');
    expect(late.getAttribute('aria-label')).toBe('Inspect the valve, OPS-1, High priority, milestone, blocked, overdue, due Jan 5, 2020, 2 of 5 subtasks done, 3 comments, 1 attachment, assigned to Mariam Al Hinai, Omar Ahmed, Aisha Khan and Bilal');
    const later = card('t2');
    expect(later.querySelector('.tdue').textContent).toBe('Mar 1, 2099');
    expect(later.querySelector('.tdue').classList.contains('overdue')).toBe(false);
    expect(later.querySelector('.tperson').textContent).toBe('Omar Ahmed'); // one person: their name
    expect(later.querySelector('[aria-label="Comments"]')).toBeNull();
    expect(card('t3').querySelector('.tdue').classList.contains('overdue')).toBe(false); // done: never overdue
  });
});

describe('Board: add a task in any column with the new-task form', () => {
  it('every column offers “Add a task to …”: the New task form opens in this project and column, on the board’s day', async () => {
    const ctx = boardCtx({ query: { date: '2026-11-02' } });
    const root = await openBoard(ctx);
    const opener = byLabel(root, 'Add a task to In progress');
    expect(opener.tagName).toBe('BUTTON');
    opener.focus();
    opener.click();
    await settle();
    const dialog = openDialog();
    expect(dialog).toBeTruthy();
    expect(document.getElementById(dialog.getAttribute('aria-labelledby')).textContent).toBe('New task');
    expect(dialog.querySelector('#qa-project').textContent).toBe('Ops'); // shown, not changeable
    expect(dialog.querySelector('select#qa-project')).toBeNull();
    expect(dialog.querySelector('#qa-column').value).toBe('c2');
    expect(dialog.querySelector('#qa-priority').value).toBe('NORMAL'); // the fields show what will be sent
    expect(document.activeElement).toBe(dialog.querySelector('#qa-title'));
    expect(byText(dialog, 'button', 'Add this page')).toBeUndefined();
    expect(byText(dialog, 'button', 'Open MICO360 Tasks')).toBeUndefined();
    expect(root.closest('[inert]')).toBeTruthy(); // the board behind can't be reached meanwhile
    typeTitle('Check the pressure gauge');
    byText(dialog, 'button', 'Create task').click();
    await settle();
    expect(ctx.write).toHaveBeenCalledWith('task.create',
      { title: 'Check the pressure gauge', projectId: 'p1', columnId: 'c2', priority: 'NORMAL', boardDate: '2026-11-02' },
      { idempotencyKey: expect.any(String), hold: false });
    expect(openDialog()).toBeNull();
    const col = [...root.querySelectorAll('.column')].find((c) => c.querySelector('.cname').textContent === 'In progress');
    expect(col.textContent).toContain('Check the pressure gauge');
    expect(document.activeElement).toBe(byLabel(root, 'Add a task to In progress')); // back where it was opened
    expect(root.querySelector('.sr-only[role="status"]').textContent).toBe('Created OPS-9 “Check the pressure gauge”.');
    expect(root.closest('[inert]')).toBeFalsy();
  });

  it('“New task” starts in the first column; an empty column’s box starts in that column', async () => {
    const root = await openBoard(boardCtx({ tasks: [{ id: 't1', key: 'OPS-1', title: 'A', priority: 'NORMAL', columnId: 'c1' }] }));
    byText(root, 'button', 'New task').click();
    await settle();
    expect(document.querySelector('#qa-column').value).toBe('c1');
    key(document.querySelector('#qa-title'), 'Escape');
    await settle();
    expect(openDialog()).toBeNull();
    const done = [...root.querySelectorAll('.column')].find((c) => c.querySelector('.cname').textContent === 'Done');
    const empty = done.querySelector('.column-empty');
    expect(empty.textContent).toContain('No tasks');
    empty.click();
    await settle();
    expect(document.querySelector('#qa-column').value).toBe('c4');
  });

  it('kept on this device offline: the card shows in its column, and the board says it will sync', async () => {
    const ctx = boardCtx({ write: vi.fn(async () => ({ queued: true, item: { id: 'q1', idempotencyKey: 'k1' } })) });
    const root = await openBoard(ctx);
    byLabel(root, 'Add a task to To do').click();
    await settle();
    typeTitle('Offline idea');
    byText(openDialog(), 'button', 'Create task').click();
    await settle();
    expect(openDialog()).toBeNull();
    const added = [...root.querySelectorAll('.tcard')].find((c) => c.textContent.includes('Offline idea'));
    expect(added.dataset.taskId).toBe('tmp-q1');
    expect(root.querySelector('.infobar').textContent).toBe('Saved on this device — the task will be created when the connection is back.');
  });

  it('closing it: at once when nothing is typed; with a title typed it asks first, with “Keep editing” focused', async () => {
    const ctx = boardCtx();
    const root = await openBoard(ctx);
    const opener = byLabel(root, 'Add a task to To do');
    opener.focus();
    opener.click();
    await settle();
    key(document.querySelector('#qa-title'), 'Escape');
    await settle();
    expect(openDialog()).toBeNull();
    expect(document.activeElement).toBe(byLabel(root, 'Add a task to To do'));

    byLabel(root, 'Add a task to To do').click();
    await settle();
    const title = typeTitle('Half typed');
    key(title, 'Escape');
    await settle();
    const dialog = openDialog();
    expect(dialog.textContent).toContain('Discard this task? What you entered hasn’t been saved.');
    expect(document.activeElement).toBe(byText(dialog, 'button', 'Keep editing'));
    byText(dialog, 'button', 'Keep editing').click();
    expect(document.activeElement).toBe(document.querySelector('#qa-title'));
    byLabel(dialog, 'Close').click();
    byText(dialog, 'button', 'Discard').click();
    await settle();
    expect(openDialog()).toBeNull();
    expect(ctx.write).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(byLabel(root, 'Add a task to To do'));
  });

  it('a file dragged over a column isn’t taken for a card', async () => {
    const root = await openBoard(boardCtx({ tasks: [{ id: 't1', key: 'OPS-1', title: 'A', priority: 'NORMAL', columnId: 'c1' }] }));
    const col = root.querySelectorAll('.column')[1];
    const over = new Event('dragover', { bubbles: true, cancelable: true });
    Object.defineProperty(over, 'dataTransfer', { value: { types: ['Files'], dropEffect: 'none' } });
    col.dispatchEvent(over);
    expect(over.defaultPrevented).toBe(false);
    expect(col.classList.contains('drop')).toBe(false);
  });
});

const MINE = [
  { id: 'm1', key: 'RIG-1', title: 'Valve check', priority: 'LOW', projectId: 'p1', columnId: 'r1', columnCategory: 'TODO', dueDate: null, progress: 10 },
  { id: 'm2', key: 'OPS-4', title: 'Approve invoices', priority: 'URGENT', projectId: 'p2', columnId: 'o1', columnCategory: 'IN_PROGRESS', dueDate: null, progress: 60 },
  { id: 'm3', key: 'RIG-2', title: 'Book the crane', priority: 'HIGH', projectId: 'p1', columnId: 'r1', columnCategory: 'TODO', dueDate: null, progress: 0 },
];
const RIG_COLUMNS = [
  { id: 'r1', name: 'To do', category: 'TODO', enabled: true, position: 0 },
  { id: 'r8', name: 'Signed off', category: 'DONE', enabled: true, position: 9 },
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
        list: vi.fn(async () => ({ data: PROJECTS })),
        columns: vi.fn(async (pid) => ({ data: pid === 'p1' ? RIG_COLUMNS : over.otherColumns ?? [] })),
      },
    },
    openTask: vi.fn(),
    write: over.write ?? vi.fn(async (kind, p) => ({ queued: false, data: { ...MINE.find((t) => t.id === p.id), columnId: p.columnId, columnCategory: 'DONE', completedAt: '2026-10-21T08:00:00Z', progress: 100, version: 2 } })),
    afterMutation: vi.fn(),
  };
}

async function openMine(ctx) {
  const root = MyTasksScreen(ctx);
  document.body.append(root);
  await settle();
  return root;
}
const rowTitles = (root) => [...root.querySelectorAll('.task-row .tt')].map((n) => n.textContent);
const section = (root, name) => [...root.querySelectorAll('.mt-section')].find((s) => s.querySelector('.section-title').textContent.startsWith(name));

describe('My Tasks: filter by project, sort, and mark a task done', () => {
  it('“Filter by project” lists the projects my tasks are in; picking one shows only its tasks; Reset shows all', async () => {
    const root = await openMine(mineCtx());
    const filter = byLabel(root, 'Filter by project');
    expect([...filter.options].map((o) => o.textContent)).toEqual(['All projects', 'Office Ops', 'Rig Inspection']);
    filter.value = 'p1';
    filter.dispatchEvent(new Event('change', { bubbles: true }));
    expect(rowTitles(root).sort()).toEqual(['Book the crane', 'Valve check']);
    byText(root, 'button', 'Reset').click();
    expect(rowTitles(root)).toHaveLength(3);
    expect(byLabel(root, 'Filter by project').value).toBe('');
  });

  it('“Sort tasks”: due date first by default, or priority, progress, title — within each group', async () => {
    const root = await openMine(mineCtx());
    const sort = byLabel(root, 'Sort tasks');
    expect([...sort.options].map((o) => o.textContent)).toEqual(['Due date', 'Priority', 'Progress', 'Title (A–Z)']);
    expect(sort.value).toBe('due');
    const pick = (v) => { sort.value = v; sort.dispatchEvent(new Event('change', { bubbles: true })); };
    pick('priority');
    expect(rowTitles(root)).toEqual(['Approve invoices', 'Book the crane', 'Valve check']);
    pick('progress');
    expect(rowTitles(root)).toEqual(['Approve invoices', 'Valve check', 'Book the crane']);
    pick('title');
    expect(rowTitles(root)).toEqual(['Approve invoices', 'Book the crane', 'Valve check']);
  });

  it('“Mark done” moves a task to its project’s Done column: it goes to Completed, focus stays on it, and it says so', async () => {
    const ctx = mineCtx();
    const root = await openMine(ctx);
    const btn = byLabel(root, 'Mark done: “Valve check”');
    expect(btn.tagName).toBe('BUTTON');
    btn.focus();
    btn.click();
    await settle();
    // The project's first Done column on its board (r9, position 5 — not r8 at 9).
    expect(ctx.api.projects.columns).toHaveBeenCalledWith('p1');
    expect(ctx.write).toHaveBeenCalledWith('task.move', { id: 'm1', columnId: 'r9', columnCategory: 'DONE' });
    expect(section(root, 'Completed').textContent).toContain('Valve check');
    expect(byLabel(root, 'Mark done: “Valve check”')).toBeNull(); // a finished task has no button
    expect(document.activeElement.dataset.taskId).toBe('m1');
    expect(root.querySelector('.sr-only[role="status"]').textContent).toBe('“Valve check” is done.');
    expect(ctx.afterMutation).toHaveBeenCalled();
  });

  it('kept on this device offline: shown done at once, saying it will sync', async () => {
    const ctx = mineCtx({ write: vi.fn(async () => ({ queued: true, item: { id: 'q1' } })) });
    const root = await openMine(ctx);
    byLabel(root, 'Mark done: “Book the crane”').click();
    await settle();
    expect(section(root, 'Completed').textContent).toContain('Book the crane');
    expect(root.querySelector('.infobar').textContent).toBe('Saved on this device — it will sync when the connection is back.');
  });

  it('a refusal puts it back with the server’s words; a project without a Done column says so; a task not synced yet waits', async () => {
    const ctx = mineCtx({ write: vi.fn(async () => { throw new ApiError(403, 'You do not have permission to do that.', 'FORBIDDEN'); }) });
    const root = await openMine(ctx);
    byLabel(root, 'Mark done: “Valve check”').click();
    await settle();
    expect(root.querySelector('[role="alert"]').textContent).toBe('You do not have permission to do that.');
    expect(section(root, 'Completed')).toBeUndefined();
    expect(byLabel(root, 'Mark done: “Valve check”')).toBeTruthy();

    byLabel(root, 'Mark done: “Approve invoices”').click(); // Office Ops has no Done column here
    await settle();
    expect(root.querySelector('[role="alert"]').textContent).toBe('This project has no Done column — open its board to move the task.');
    expect(ctx.write).toHaveBeenCalledTimes(1);

    const waiting = await openMine(mineCtx({ tasks: [{ ...MINE[0], id: 'tmp-q7' }] }));
    byLabel(waiting, 'Mark done: “Valve check”').click();
    await settle();
    expect(waiting.querySelector('[role="alert"]').textContent).toBe('This task is still waiting to sync — mark it done after it syncs.');
  });

  it('completing a repeating task reads the list again, so its next copy shows up', async () => {
    const ctx = mineCtx({ tasks: [{ ...MINE[0], recurrenceRule: { freq: 'DAILY', interval: 1 } }] });
    const root = await openMine(ctx);
    byLabel(root, 'Mark done: “Valve check”').click();
    await settle();
    expect(ctx.api.tasks.mine).toHaveBeenCalledTimes(2);
    expect(rowTitles(root)).toEqual(['Valve check']);
  });
});
