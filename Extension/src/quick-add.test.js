import { describe, it, expect } from 'vitest';
import {
  buildQuickAddPayload, parseTags, openProjects, startProjectId, projectFromUrl, boardColumns, pickColumn, personName, listNames,
  assigneeNote, removedNotice, withPage, isAddablePage, captureFromContext, mergeCapture, rememberRecent, recentStatus, ownedBy,
  fileFailure, createFailure, attachFailureMessage, createdMessage, formatSize, TITLE_MAX, DESCRIPTION_MAX,
} from './quick-add.js';

describe('buildQuickAddPayload', () => {
  const defaults = { projectId: 'p1', columnId: 'c1' };

  it('builds a minimal payload from defaults, trimming + defaulting priority', () => {
    expect(buildQuickAddPayload({ title: '  Ship it  ' }, defaults)).toEqual({
      title: 'Ship it',
      projectId: 'p1',
      columnId: 'c1',
      priority: 'NORMAL',
    });
  });

  it('includes description, a chosen column, priority, due date, estimate and tags', () => {
    const p = buildQuickAddPayload(
      { title: 'X', columnId: 'c2', priority: 'HIGH', description: ' do it ', dueDate: '2026-09-10', estimatedHours: '2.5', tags: 'urgent, Urgent , backend' },
      defaults,
    );
    expect(p).toEqual({
      title: 'X',
      projectId: 'p1',
      columnId: 'c2',
      priority: 'HIGH',
      description: 'do it',
      dueDate: '2026-09-10',
      estimatedHours: 2.5,
      tags: ['urgent', 'backend'],
    });
  });

  it('includes de-duplicated assigneeIds and omits the field when empty', () => {
    const p = buildQuickAddPayload({ title: 'X', assigneeIds: ['u1', 'u1', 'u2'] }, defaults);
    expect(p.assigneeIds).toEqual(['u1', 'u2']);
    expect(buildQuickAddPayload({ title: 'X', assigneeIds: [] }, defaults).assigneeIds).toBeUndefined();
    expect(buildQuickAddPayload({ title: 'X' }, defaults).assigneeIds).toBeUndefined();
  });

  it('drops a zero/blank/negative estimate', () => {
    expect(buildQuickAddPayload({ title: 'X', estimatedHours: '0' }, defaults).estimatedHours).toBeUndefined();
    expect(buildQuickAddPayload({ title: 'X', estimatedHours: '' }, defaults).estimatedHours).toBeUndefined();
    expect(buildQuickAddPayload({ title: 'X', estimatedHours: '-4' }, defaults).estimatedHours).toBeUndefined();
  });

  it('returns null when the title, project or column is missing', () => {
    expect(buildQuickAddPayload({ title: '   ' }, defaults)).toBeNull();
    expect(buildQuickAddPayload({ title: 'X' }, {})).toBeNull();
    expect(buildQuickAddPayload({ title: 'X', projectId: 'p1' }, {})).toBeNull();
  });
});

describe('parseTags', () => {
  it('splits on commas, trims, drops blanks and de-duplicates case-insensitively', () => {
    expect(parseTags('urgent, Backend ,urgent,, UX Review')).toEqual(['urgent', 'Backend', 'UX Review']);
  });
  it('returns an empty array for blank/undefined input', () => {
    expect(parseTags('')).toEqual([]);
    expect(parseTags(undefined)).toEqual([]);
  });
});

describe('buildQuickAddPayload — a repeat suggested by "Describe it"', () => {
  it('sends the repeat rule when there is one', () => {
    const rule = { freq: 'WEEKLY', interval: 1, weekdays: [1] };
    expect(buildQuickAddPayload({ title: 'X', rule }, { projectId: 'p1', columnId: 'c1' }).recurrenceRule).toEqual(rule);
    expect(buildQuickAddPayload({ title: 'X', rule: null }, { projectId: 'p1', columnId: 'c1' }).recurrenceRule).toBeUndefined();
  });
});

describe('where a new task goes', () => {
  const projects = [
    { id: 'p1', name: 'Ops', status: 'ACTIVE' },
    { id: 'p2', name: 'Old', status: 'ARCHIVED' },
    { id: 'p3', name: 'Site', status: 'PLANNING' },
  ];

  it('offers only projects that are not archived', () => {
    expect(openProjects(projects).map((p) => p.id)).toEqual(['p1', 'p3']);
    expect(openProjects(null)).toEqual([]);
  });

  it('starts in the current project, then the last one used, then the first', () => {
    const open = openProjects(projects);
    expect(startProjectId(open, { currentId: 'p3', lastId: 'p1' })).toBe('p3');
    expect(startProjectId(open, { currentId: 'p2', lastId: 'p3' })).toBe('p3'); // archived: not offered
    expect(startProjectId(open, { currentId: null, lastId: 'gone' })).toBe('p1');
    expect(startProjectId([], {})).toBe('');
  });

  it('reads the current project from the page: the web board or dashboard, or the extension’s board', () => {
    const opts = { appBase: 'https://task.mico360.com', appPage: 'chrome-extension://abc/app/app.html' };
    expect(projectFromUrl('https://task.mico360.com/board?project=p1&date=2026-10-21', opts)).toBe('p1');
    expect(projectFromUrl('https://task.mico360.com/projects/p3', opts)).toBe('p3');
    expect(projectFromUrl('https://task.mico360.com/projects/p3/', opts)).toBe('p3');
    expect(projectFromUrl('chrome-extension://abc/app/app.html#/board/p9?date=2026-10-20', opts)).toBe('p9');
    expect(projectFromUrl('https://task.mico360.com/projects', opts)).toBeNull();
    expect(projectFromUrl('https://task.mico360.com/my-tasks?task=t1', opts)).toBeNull();
    expect(projectFromUrl('https://evil.example/board?project=p1', opts)).toBeNull();
    expect(projectFromUrl('chrome-extension://other/app/app.html#/board/p9', opts)).toBeNull();
    expect(projectFromUrl('not a url', opts)).toBeNull();
    expect(projectFromUrl('https://office.local/tasks/board?project=p5', { appBase: 'https://office.local/tasks' })).toBe('p5');
    expect(projectFromUrl('https://office.local/board?project=p5', { appBase: 'https://office.local/tasks' })).toBeNull();
  });

  it('columns as the board shows them, and which one to start in', () => {
    const cols = boardColumns([
      { id: 'c3', category: 'DONE', position: 2, enabled: true },
      { id: 'c1', category: 'TODO', position: 0, enabled: true },
      { id: 'cx', category: 'REVIEW', position: 1, enabled: false },
      { id: 'c2', category: 'IN_PROGRESS', position: 1 },
    ]);
    expect(cols.map((c) => c.id)).toEqual(['c1', 'c2', 'c3']);
    expect(pickColumn(cols, { currentId: 'c3' })).toBe('c3');
    expect(pickColumn(cols, { currentId: 'gone', preferCategory: 'IN_PROGRESS' })).toBe('c2'); // the same kind after a project change
    expect(pickColumn(cols, { preferCategory: 'BLOCKED' })).toBe('c1');
    expect(pickColumn([], {})).toBe('');
  });
});

describe('who works on it', () => {
  it('names people as the web does', () => {
    expect(personName({ firstName: 'Mariam', lastName: 'Al Hinai', username: 'mariam' })).toBe('Mariam Al Hinai');
    expect(personName({ firstName: '', lastName: '', username: 'omar' })).toBe('omar');
    expect(personName(null)).toBe('Someone');
    expect(listNames(['A'])).toBe('A');
    expect(listNames(['A', 'B', 'C'])).toBe('A, B and C');
  });

  it('says who gets the task when nobody is picked', () => {
    expect(assigneeNote(['u1'], 'Omar')).toBeNull();
    expect(assigneeNote([], 'Omar')).toBe('Nobody picked — the task will go to Omar, the project owner.');
    expect(assigneeNote([], null)).toBe('Nobody picked — the task will be unassigned.');
  });

  it('says who was taken off when they are not on the newly chosen project', () => {
    expect(removedNotice(['Omar'], 'Site')).toBe('Omar isn’t on Site, so they were taken off this task.');
    expect(removedNotice(['Omar', 'Layla'], null)).toBe('Omar and Layla aren’t on that project, so they were taken off this task.');
  });
});

describe('"Add this page"', () => {
  const page = { title: 'Pump P-12 datasheet', url: 'https://vendor.example/p12.pdf' };

  it('puts the page’s title and address into the description, once', () => {
    expect(withPage('', page)).toEqual({ description: 'Pump P-12 datasheet\nhttps://vendor.example/p12.pdf', added: true });
    expect(withPage('Check the seals.\n', page)).toEqual({ description: 'Check the seals.\n\nPump P-12 datasheet\nhttps://vendor.example/p12.pdf', added: true });
    const once = withPage('x', page).description;
    expect(withPage(once, page)).toEqual({ description: once, added: false });
    expect(withPage('', { title: 'https://a.example/', url: 'https://a.example/' }).description).toBe('https://a.example/');
  });

  it('only web pages can be added', () => {
    expect(isAddablePage('https://a.example/x')).toBe(true);
    expect(isAddablePage('http://intranet.local/')).toBe(true);
    for (const url of ['chrome://extensions', 'chrome-extension://abc/popup/popup.html', 'file:///C:/x.txt', 'javascript:alert(1)', '', undefined]) {
      expect(isAddablePage(url), String(url)).toBe(false);
    }
    expect(withPage('keep', { title: 'Settings', url: 'chrome://settings' })).toEqual({ description: 'keep', added: false });
  });
});

describe('the right-click menu: "Add to MICO360 Tasks"', () => {
  const tab = { title: 'Weekly report — Intranet', url: 'https://intranet.example/report' };

  it('a selection becomes the title (its first line); a longer one is kept whole in the description', () => {
    const one = captureFromContext({ selectionText: '  Replace the  filter on RIG1 ', pageUrl: tab.url }, tab);
    expect(one).toMatchObject({ title: 'Replace the filter on RIG1', text: 'Replace the  filter on RIG1', link: '', page: tab });
    const many = captureFromContext({ selectionText: 'Order spares\nqty 4, by Thursday', pageUrl: tab.url }, tab);
    expect(many.title).toBe('Order spares');
    const long = captureFromContext({ selectionText: 'x'.repeat(300), pageUrl: tab.url }, tab);
    expect(long.title).toHaveLength(TITLE_MAX);
    expect(long.title.endsWith('…')).toBe(true);
  });

  it('a link becomes the task (its text when selected, else its address); a page by its title', () => {
    expect(captureFromContext({ linkUrl: 'https://a.example/doc', selectionText: 'The spec', pageUrl: tab.url }, tab)).toMatchObject({ title: 'The spec', link: 'https://a.example/doc' });
    expect(captureFromContext({ linkUrl: 'https://a.example/doc', pageUrl: tab.url }, tab)).toMatchObject({ title: 'https://a.example/doc', link: 'https://a.example/doc' });
    expect(captureFromContext({ linkUrl: 'javascript:void(0)', pageUrl: tab.url }, tab)).toMatchObject({ title: tab.title, link: '' });
    expect(captureFromContext({ pageUrl: tab.url }, tab)).toMatchObject({ title: tab.title, page: tab });
    expect(captureFromContext({ pageUrl: 'chrome://newtab/' }, { title: 'New Tab' })).toMatchObject({ title: 'New Tab', page: null });
  });

  it('fills an empty form: the title, and the rest in the description (the page last)', () => {
    const empty = { title: '', description: '', priority: 'NORMAL' };
    const sel = captureFromContext({ selectionText: 'Order spares\nqty 4', pageUrl: tab.url }, tab);
    expect(mergeCapture(empty, sel)).toEqual({ title: 'Order spares', description: `Order spares\nqty 4\n\n${tab.title}\n${tab.url}`, priority: 'NORMAL' });
    const one = captureFromContext({ selectionText: 'Replace the filter', pageUrl: tab.url }, tab);
    expect(mergeCapture(empty, one).description).toBe(`${tab.title}\n${tab.url}`); // the title isn't repeated
    const link = captureFromContext({ linkUrl: 'https://a.example/doc', selectionText: 'The spec', pageUrl: tab.url }, tab);
    expect(mergeCapture(empty, link).description).toBe(`https://a.example/doc\n\n${tab.title}\n${tab.url}`);
    const page = captureFromContext({ pageUrl: tab.url }, tab);
    expect(mergeCapture(empty, page)).toMatchObject({ title: tab.title, description: tab.url });
  });

  it('a single-line selection longer than a title is kept whole in the description (I3)', () => {
    const empty = { title: '', description: '', priority: 'NORMAL' };
    const sentence = `${'Inspect the flange on the north manifold and record the torque values '.repeat(4)}before the shift ends.`;
    expect(sentence.length).toBeGreaterThan(TITLE_MAX);
    const long = captureFromContext({ selectionText: sentence, pageUrl: tab.url }, tab);
    const merged = mergeCapture(empty, long);
    expect(merged.title).toHaveLength(TITLE_MAX);
    expect(merged.description).toBe(`${sentence}\n\n${tab.title}\n${tab.url}`);
    expect(merged.description).toContain('before the shift ends.');
    // A page title too long for a task title is kept whole as well.
    const longPage = { title: `Report ${'x'.repeat(250)} end`, url: tab.url };
    expect(mergeCapture(empty, captureFromContext({ pageUrl: tab.url }, longPage)).description).toBe(`${longPage.title}\n${tab.url}`);
  });

  it('a capture never goes past the fields’ limits (M7): the selection is shortened, the page stays', () => {
    const empty = { title: '', description: '', priority: 'NORMAL' };
    const huge = `Start ${'word '.repeat(DESCRIPTION_MAX / 4)}`;
    const merged = mergeCapture(empty, captureFromContext({ selectionText: huge, pageUrl: tab.url }, tab));
    expect(merged.description.length).toBeLessThanOrEqual(DESCRIPTION_MAX);
    expect(merged.description.startsWith('Start word')).toBe(true);
    expect(merged.description.endsWith(`…\n\n${tab.title}\n${tab.url}`)).toBe(true);
    // A title kept in storage is clipped too, and typed text that is already long is never cut.
    expect(mergeCapture(empty, { title: 'y'.repeat(400), text: '', link: '', page: null }).title.length).toBeLessThanOrEqual(TITLE_MAX);
    const typed = { title: 'Mine', description: 'z'.repeat(DESCRIPTION_MAX - 5) };
    const next = mergeCapture(typed, { title: 'T', text: 'A selection that does not fit', link: '', page: null });
    expect(next.description.length).toBeLessThanOrEqual(DESCRIPTION_MAX);
    expect(next.description.startsWith(typed.description)).toBe(true);
  });

  it('never replaces what is already typed: it adds to the description instead', () => {
    const typed = { title: 'Mine', description: 'My notes' };
    const sel = captureFromContext({ selectionText: 'Replace the filter', pageUrl: tab.url }, tab);
    expect(mergeCapture(typed, sel)).toEqual({ title: 'Mine', description: `My notes\n\nReplace the filter\n\n${tab.title}\n${tab.url}` });
    expect(mergeCapture(typed, null)).toBe(typed);
  });
});

describe('recent tasks (this device)', () => {
  it('keeps the newest five, without repeats', () => {
    let list = [];
    for (let i = 1; i <= 7; i += 1) list = rememberRecent(list, { id: `t${i}`, title: `T${i}` });
    expect(list.map((e) => e.id)).toEqual(['t7', 't6', 't5', 't4', 't3']);
    list = rememberRecent(list, { id: 't4', title: 'T4 again' });
    expect(list.map((e) => e.id)).toEqual(['t4', 't7', 't6', 't5', 't3']);
    list = rememberRecent(list, { queuedKey: 'k1', title: 'Offline' });
    expect(list[0]).toEqual({ queuedKey: 'k1', title: 'Offline' });
  });

  it('a task saved on this device is waiting, failed, or synced (gone from the queue)', () => {
    const queue = [{ idempotencyKey: 'k1', kind: 'task.create', status: 'pending' }, { idempotencyKey: 'k2', kind: 'task.create', status: 'failed' }];
    expect(recentStatus({ id: 't1' }, queue)).toBe('created');
    expect(recentStatus({ queuedKey: 'k1' }, queue)).toBe('waiting');
    expect(recentStatus({ queuedKey: 'k2' }, queue)).toBe('failed');
    expect(recentStatus({ queuedKey: 'k3' }, queue)).toBe('synced');
  });

  it('a value kept for one person is not another’s', () => {
    expect(ownedBy({ userId: 'u1', projectId: 'p1' }, 'u1')).toEqual({ userId: 'u1', projectId: 'p1' });
    expect(ownedBy({ userId: 'u1', projectId: 'p1' }, 'u2')).toBeNull();
    expect(ownedBy(undefined, 'u1')).toBeNull();
  });
});

describe('what the person is told', () => {
  const api = (status, serverMessage = '') => Object.assign(new Error(serverMessage || `HTTP ${status}`), { status, serverMessage });

  it('why a file was not attached (as the web says it)', () => {
    expect(fileFailure(api(413))).toBe('That file is too large to upload.');
    expect(fileFailure(new TypeError('Failed to fetch'))).toBe('The server couldn’t be reached.');
    expect(fileFailure(api(400, 'This file type is not allowed.'))).toBe('This file type is not allowed.');
    expect(fileFailure(api(500))).toBe('It couldn’t be uploaded.');
  });

  it('why the task was not created', () => {
    expect(createFailure(api(403, 'You do not have access.'))).toBe('Couldn’t create the task. You don’t have permission to do that.');
    expect(createFailure(api(400, 'Only active members of this project can be assigned.'))).toBe('Couldn’t create the task. Only active members of this project can be assigned.');
    expect(createFailure(new TypeError('x'))).toBe('Couldn’t create the task. The server couldn’t be reached.');
    expect(createFailure(api(500))).toBe('Couldn’t create the task. Please try again.');
    expect(createFailure({ userMessage: 'Your change could not be saved on this device. Please try again.' })).toBe('Your change could not be saved on this device. Please try again.');
  });

  it('files that could not be attached after the task was created', () => {
    expect(attachFailureMessage([{ name: 'a.png', reason: 'That file is too large to upload.' }])).toBe('The task was created, but a.png wasn’t attached: That file is too large to upload.');
    expect(attachFailureMessage([{ name: 'a.png', reason: 'x' }, { name: 'b.pdf', reason: 'y' }])).toBe('The task was created, but these files weren’t attached: a.png (x); b.pdf (y). Add them from the task.');
  });

  it('a created task, and file sizes', () => {
    expect(createdMessage({ key: 'OPS-12', title: 'Fix it' })).toBe('Created OPS-12 “Fix it”.');
    expect(createdMessage({ title: 'Fix it' })).toBe('Created “Fix it”.');
    expect(formatSize(900)).toBe('900 B');
    expect(formatSize(2048)).toBe('2.0 KB');
    expect(formatSize(3 * 1024 * 1024)).toBe('3.0 MB');
  });
});
