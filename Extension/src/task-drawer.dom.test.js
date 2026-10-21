// @vitest-environment jsdom
/**
 * The task drawer at the web's level (Stage 3): milestone and start date, the meeting a task came
 * from, editing a whole series, tags, people, watching, files, threaded comments with @mentions,
 * the timeline, and deleting. Each change goes through ctx.write (sent now or kept on this device).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TaskDetail } from '../app/screens/task-detail.js';
import { showModal } from '../app/dialog.js';
import { ApiError } from './errors.js';
import { formatDayKey } from './due-date.js';

const TZ = 'Asia/Muscat';
const settle = async () => {
  for (let i = 0; i < 10; i += 1) await new Promise((r) => setTimeout(r, 0));
};
const byText = (root, sel, text) => [...root.querySelectorAll(sel)].find((n) => n.textContent.trim() === text);
const byLabel = (root, label) => root.querySelector(`[aria-label="${label}"]`);
const change = (node, value) => { node.value = value; node.dispatchEvent(new Event('change', { bubbles: true })); };
const type = (node, value) => { node.value = value; node.setSelectionRange(value.length, value.length); node.dispatchEvent(new Event('input', { bubbles: true })); };
const key = (node, k, opts = {}) => {
  const e = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...opts });
  node.dispatchEvent(e);
  return e;
};
const active = () => document.activeElement;

const ME = { id: 'u1', name: 'Mariam Al Hinai', email: 'mariam', roles: [] };
const PEOPLE = [
  { id: 'u1', username: 'mariam', firstName: 'Mariam', lastName: 'Al Hinai', role: 'MEMBER' },
  { id: 'u2', username: 'omar', firstName: 'Omar', lastName: 'Ahmed', role: 'MEMBER' },
  { id: 'u3', username: 'aisha', firstName: 'Aisha', lastName: 'Khan', role: 'MANAGER' },
  { id: 'u4', username: 'layla', firstName: 'Layla', lastName: 'Old', role: 'MEMBER' }, // switched off: not in /mentionable
];

/** A drawer's context with every read the drawer makes; `over` replaces any part. */
function drawerCtx(over = {}) {
  const task = { id: 't1', key: 'OPS-7', title: 'Inspect the rig', priority: 'NORMAL', projectId: 'p1', dueDate: '2026-10-30T00:00:00.000Z', startDate: null, isMilestone: false, recurrenceRule: null, version: 3, tags: [], ...over.task };
  const read = (data) => vi.fn(async () => ({ data }));
  const ctx = {
    params: { taskId: 't1' },
    me: { ...ME, ...over.me },
    timeZone: TZ,
    apiBase: 'http://localhost:4000/api/v1',
    appBase: 'http://localhost:5173',
    isOnline: () => over.online !== false,
    api: {
      tasks: {
        get: vi.fn(async () => ({ data: { ...task } })),
        assignees: read(over.assignees ?? []),
        checklist: read({ items: [], done: 0, total: 0 }),
        comments: read(over.comments ?? []),
        attachments: read(over.attachments ?? []),
        activity: read(over.activity ?? []),
        watch: read({ watching: over.watching ?? false }),
        watchers: read(over.watchers ?? []),
        mentionable: read(over.mentionable ?? PEOPLE.slice(0, 3).map(({ role, ...p }) => ({ ...p, avatarUrl: null }))),
      },
      projects: { members: read(over.members ?? PEOPLE) },
      tags: read(over.tags ?? [{ id: 'g1', name: 'Urgent', color: '#8B1E1E' }, { id: 'g2', name: 'Client', color: '#3A6EA5' }]),
      directory: read(PEOPLE.map(({ role, ...p }) => p)),
      attachments: { upload: over.upload ?? vi.fn(async (_id, file) => ({ id: `f-${file.name}`, taskId: 't1', uploadedById: 'u1', filename: file.name, mimeType: file.type, sizeBytes: file.size, url: `/uploads/${file.name}` })) },
      download: vi.fn(),
    },
    write: over.write ?? vi.fn(async (kind) => ({ queued: false, data: kind === 'task.update' ? { id: 't1', version: 4 } : undefined })),
    afterMutation: vi.fn(),
    saveFile: vi.fn(),
  };
  return ctx;
}

async function open(ctx = drawerCtx(), onClose = () => {}) {
  const root = TaskDetail(ctx, onClose);
  document.body.append(root);
  await settle();
  return root;
}

let releases = [];
beforeEach(() => {
  document.body.innerHTML = '';
  releases = [];
});
afterEach(() => {
  for (const r of releases) r();
  vi.useRealTimers();
});

describe('the task’s own fields', () => {
  it('a milestone: shown as such, and switched on or off like any edit', async () => {
    const ctx = drawerCtx();
    const root = await open(ctx);
    const box = byLabel(root, 'Milestone');
    expect(box.type).toBe('checkbox');
    expect(box.checked).toBe(false);
    box.click();
    await settle();
    expect(ctx.write).toHaveBeenCalledWith('task.update', { id: 't1', patch: { isMilestone: true }, expectedVersion: 3 });
    expect(root.querySelector('.td-badges').textContent).toContain('Milestone');
    expect(byLabel(root, 'Milestone').checked).toBe(true);
  });

  it('the start date: shown as its day, changed or cleared; a refused one (after the due date) is put back with the server’s reason', async () => {
    const ctx = drawerCtx({ task: { startDate: '2026-10-20T00:00:00.000Z' } });
    ctx.write = vi.fn(async (kind, p) => {
      if (p.patch.startDate === '2026-11-02') throw new ApiError(400, 'The start date must be on or before the due date.', 'VALIDATION');
      return { queued: false, data: { id: 't1', version: 4 } };
    });
    const root = await open(ctx);
    expect(byLabel(root, 'Start date').value).toBe('2026-10-20');
    change(byLabel(root, 'Start date'), '2026-10-22');
    await settle();
    expect(ctx.write).toHaveBeenLastCalledWith('task.update', { id: 't1', patch: { startDate: '2026-10-22' }, expectedVersion: 3 });
    change(byLabel(root, 'Start date'), '2026-11-02');
    await settle();
    expect(root.querySelector('[role="alert"]').textContent).toBe('The start date must be on or before the due date.');
    expect(byLabel(root, 'Start date').value).toBe('2026-10-22');
    change(byLabel(root, 'Start date'), '');
    await settle();
    expect(ctx.write).toHaveBeenLastCalledWith('task.update', { id: 't1', patch: { startDate: null }, expectedVersion: 4 });
  });

  it('“From meeting” opens that meeting on the website; a meeting you’re not part of is only mentioned', async () => {
    const root = await open(drawerCtx({ task: { meeting: { id: 'm1', title: 'Weekly review', startAt: '2026-10-19T05:00:00.000Z', canView: true } } }));
    const link = root.querySelector('a[href="http://localhost:5173/meetings/m1"]');
    expect(link.textContent).toBe(`📅 From meeting: Weekly review · ${formatDayKey('2026-10-19')} ↗`);
    expect(link.querySelector('[aria-hidden="true"]').textContent).toBe('📅 ');
    expect(link.target).toBe('_blank');
    expect(link.rel).toContain('noopener');
    expect(link.getAttribute('title')).toBe('Open the meeting this task was created from (on the website)');

    document.body.innerHTML = '';
    const other = await open(drawerCtx({ task: { meeting: { id: 'm2', title: null, startAt: null, canView: false } } }));
    expect(other.textContent).toContain('From a meeting you’re not part of');
    expect(other.querySelector('a[href*="/meetings/"]')).toBeNull();
  });

  it('a repeating task: edits go to this copy, or — chosen — to every open copy of the series; the repeat itself never does', async () => {
    const ctx = drawerCtx({ task: { recurrenceRule: { freq: 'WEEKLY', interval: 1 } } });
    const root = await open(ctx);
    const scope = root.querySelector('fieldset');
    expect(scope.querySelector('legend').textContent).toBe('Edits apply to');
    expect(byLabel(root, 'This task').checked).toBe(true);
    expect(root.textContent).toContain('🔁 Repeats every week');
    byLabel(root, 'Entire series').click();
    await settle();
    const title = byLabel(root, 'Task title');
    title.value = 'Inspect every rig';
    title.dispatchEvent(new Event('blur'));
    await settle();
    expect(ctx.write).toHaveBeenLastCalledWith('task.update', { id: 't1', patch: { title: 'Inspect every rig', scope: 'series' }, expectedVersion: 3 });
    byText(root, 'button', 'High').click();
    await settle();
    expect(ctx.write).toHaveBeenLastCalledWith('task.update', { id: 't1', patch: { priority: 'HIGH', scope: 'series' }, expectedVersion: 4 });
    change(byLabel(root, 'Repeat every'), '2');
    await settle();
    expect(ctx.write.mock.calls.at(-1)[1].patch).toEqual({ recurrenceRule: { freq: 'WEEKLY', interval: 2 } });
    // Dates stay each copy's own.
    change(byLabel(root, 'Due date'), '2026-11-06');
    await settle();
    expect(ctx.write.mock.calls.at(-1)[1].patch).toEqual({ dueDate: '2026-11-06' });
    expect(root.textContent).toContain('the title, description and priority');
  });

  it('a copy of a series says it is part of one; a one-off task has no choice to make', async () => {
    const copy = await open(drawerCtx({ task: { recurrenceParentId: 's1', recurrenceNextId: 't9' } }));
    expect(copy.textContent).toContain('🔁 Part of a repeating series');
    expect(copy.querySelector('fieldset')).toBeTruthy();
    document.body.innerHTML = '';
    const single = await open();
    expect(single.querySelector('fieldset')).toBeNull();
  });

  it('priority chips say which one is chosen', async () => {
    const root = await open(drawerCtx({ task: { priority: 'HIGH' } }));
    expect(byText(root, 'button', 'High').getAttribute('aria-pressed')).toBe('true');
    expect(byText(root, 'button', 'Low').getAttribute('aria-pressed')).toBe('false');
  });
});

describe('tags', () => {
  it('shows the task’s tags; adds one (Enter or Add) and takes one off, sending the new list with the one it started from', async () => {
    const ctx = drawerCtx({ task: { tags: [{ id: 'g1', name: 'Urgent', color: '#8B1E1E' }] } });
    ctx.write = vi.fn(async (kind, p) => ({ queued: false, data: kind === 'task.tags' ? p.tags.map((name, i) => ({ id: `g${i + 1}`, name, color: '#123456' })) : { id: 't1', version: 4 } }));
    const root = await open(ctx);
    expect(byLabel(root, 'Tags').textContent).toContain('Urgent');
    const input = byLabel(root, 'Add a tag');
    input.focus();
    input.value = '  client  visit ';
    key(input, 'Enter');
    await settle();
    // The list it started from goes too: the change is sent over the task's tags as they are then (review I1).
    expect(ctx.write).toHaveBeenLastCalledWith('task.tags', { id: 't1', base: ['Urgent'], tags: ['Urgent', 'client visit'] });
    expect(byLabel(root, 'Tags').textContent).toContain('client visit');
    expect(active()).toBe(byLabel(root, 'Add a tag')); // ready for the next one
    expect(byLabel(root, 'Add a tag').value).toBe('');
    byLabel(root, 'Remove tag Urgent').click();
    await settle();
    expect(ctx.write).toHaveBeenLastCalledWith('task.tags', { id: 't1', base: ['Urgent', 'client visit'], tags: ['client visit'] });
    expect(byLabel(root, 'Tags').textContent).not.toContain('Urgent');
  });

  it('suggests the workspace’s tags it doesn’t have yet', async () => {
    const root = await open(drawerCtx({ task: { tags: [{ id: 'g1', name: 'Urgent' }] } }));
    const list = root.querySelector(`#${byLabel(root, 'Add a tag').getAttribute('list')}`);
    expect([...list.querySelectorAll('option')].map((o) => o.value)).toEqual(['Client']);
  });

  it('says why a tag can’t be added — and sends nothing', async () => {
    const ten = Array.from({ length: 10 }, (_, i) => ({ id: `g${i}`, name: `t${i}` }));
    const ctx = drawerCtx({ task: { tags: ten } });
    const root = await open(ctx);
    const input = byLabel(root, 'Add a tag');
    input.value = 'eleven';
    byText(root, 'button', 'Add tag').click();
    await settle();
    expect(root.querySelector('[role="alert"]').textContent).toBe('A task can have at most 10 tags.');
    byLabel(root, 'Add a tag').value = 'T3';
    key(byLabel(root, 'Add a tag'), 'Enter');
    await settle();
    expect(ctx.write).not.toHaveBeenCalled();
  });

  it('a refused change is put back with the server’s reason; one kept on this device says so', async () => {
    const ctx = drawerCtx({ task: { tags: [] } });
    ctx.write = vi.fn(async () => { throw new ApiError(403, 'You do not have access to this task.', 'FORBIDDEN'); });
    const root = await open(ctx);
    byLabel(root, 'Add a tag').value = 'Audit';
    key(byLabel(root, 'Add a tag'), 'Enter');
    await settle();
    expect(root.querySelector('[role="alert"]').textContent).toBe('You do not have access to this task.');
    expect(byLabel(root, 'Tags').textContent).not.toContain('Audit');
    ctx.write = vi.fn(async () => ({ queued: true, item: { id: 'q1' } }));
    byLabel(root, 'Add a tag').value = 'Audit';
    key(byLabel(root, 'Add a tag'), 'Enter');
    await settle();
    expect(byLabel(root, 'Tags').textContent).toContain('Audit');
    expect(root.querySelector('[role="status"]').textContent).toContain('Saved on this device');
  });
});

describe('people and watching', () => {
  it('picks anyone active on the project; takes someone off; the server’s reason when it refuses', async () => {
    const ctx = drawerCtx({ assignees: [{ id: 'u2', firstName: 'Omar', lastName: 'Ahmed' }] });
    ctx.write = vi.fn(async (kind, p) => {
      if (kind === 'task.assign' && p.userIds[0] === 'u1') throw new ApiError(400, 'Only active members of this project can be assigned.', 'VALIDATION');
      return { queued: false, data: kind === 'task.assign' ? [{ id: 'u2', firstName: 'Omar', lastName: 'Ahmed' }, { id: 'u3', firstName: 'Aisha', lastName: 'Khan' }] : undefined };
    });
    const root = await open(ctx);
    const picker = byLabel(root, 'Add an assignee');
    // Omar is on it already, and Layla's account is switched off: neither is offered.
    expect([...picker.options].map((o) => o.textContent)).toEqual(['Add someone…', 'Mariam Al Hinai (you)', 'Aisha Khan']);
    picker.focus();
    change(picker, 'u3');
    await settle();
    expect(ctx.write).toHaveBeenLastCalledWith('task.assign', { id: 't1', userIds: ['u3'] });
    expect(byLabel(root, 'Assignees').textContent).toContain('Aisha Khan');
    expect(active()).toBe(byLabel(root, 'Add an assignee'));
    byLabel(root, 'Remove Omar Ahmed').click();
    await settle();
    expect(ctx.write).toHaveBeenLastCalledWith('task.unassign', { id: 't1', userId: 'u2' });
    expect(byLabel(root, 'Assignees').textContent).not.toContain('Omar');
    change(byLabel(root, 'Add an assignee'), 'u1');
    await settle();
    expect(root.querySelector('[role="alert"]').textContent).toBe('Only active members of this project can be assigned.');
    expect(byLabel(root, 'Assignees').textContent).not.toContain('Mariam');
  });

  it('offline with no saved team: “Assign me” still works, and the picker says why it is empty', async () => {
    const ctx = drawerCtx();
    ctx.api.projects.members = vi.fn(async () => { throw new TypeError('Failed to fetch'); });
    const root = await open(ctx);
    const picker = byLabel(root, 'Add an assignee');
    expect(picker.disabled).toBe(true);
    expect(picker.options[0].textContent).toBe('The team shows when you’re online');
    byText(root, 'button', 'Assign me').click();
    await settle();
    expect(ctx.write).toHaveBeenLastCalledWith('task.assign', { id: 't1', userIds: ['u1'] });
  });

  it('watch and stop watching (a toggle), with how many watch it', async () => {
    const ctx = drawerCtx({ watchers: [{ id: 'u2' }] });
    ctx.write = vi.fn(async (kind) => ({ queued: false, data: kind === 'task.watch' ? { watching: true, watchers: [{ id: 'u2' }, { id: 'u1' }] } : undefined }));
    const root = await open(ctx);
    const watch = byLabel(root, 'Watch this task');
    expect(watch.getAttribute('aria-pressed')).toBe('false');
    expect(root.querySelector('.td-watchers').textContent).toBe('1 watching');
    watch.click();
    await settle();
    expect(ctx.write).toHaveBeenLastCalledWith('task.watch', { id: 't1' });
    expect(byLabel(root, 'Watch this task').getAttribute('aria-pressed')).toBe('true');
    expect(root.querySelector('.td-watchers').textContent).toBe('2 watching');
    expect(root.querySelector('.sr-only[role="status"]').textContent).toBe('You’re watching this task. You’ll hear about its changes.');
    byLabel(root, 'Watch this task').click();
    await settle();
    expect(ctx.write).toHaveBeenLastCalledWith('task.unwatch', { id: 't1' });
    expect(byLabel(root, 'Watch this task').getAttribute('aria-pressed')).toBe('false');
    expect(root.querySelector('.td-watchers').textContent).toBe('1 watching');
  });
});

describe('attachments', () => {
  const FILES = [
    { id: 'f1', taskId: 't1', uploadedById: 'u1', filename: 'site photo.png', mimeType: 'image/png', sizeBytes: 2048, url: '/uploads/site-photo.png', createdAt: '2026-10-20T08:00:00.000Z' },
    { id: 'f2', taskId: 't1', uploadedById: 'u2', filename: 'report.pdf', mimeType: 'application/pdf', sizeBytes: 3 * 1024 * 1024, url: '/uploads/report.pdf', createdAt: '2026-10-20T09:00:00.000Z' },
  ];
  const pick = (root, files) => {
    const input = byLabel(root, 'Attach files');
    Object.defineProperty(input, 'files', { value: files, configurable: true });
    input.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const paste = (target, { files = [], text = '' } = {}) => {
    const e = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(e, 'clipboardData', { value: { files, items: [], getData: (t) => (t === 'text/plain' ? text : '') } });
    target.dispatchEvent(e);
    return e;
  };
  /** A drag event as Chrome sends it: files say so in their types ("Files"). */
  const drag = (type, target, { files, types } = {}) => {
    const e = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(e, 'dataTransfer', { value: { files: files || [], types: types || (files ? ['Files'] : []), dropEffect: 'none' } });
    target.dispatchEvent(e);
    return e;
  };

  it('lists the files: a picture as itself, others by kind, with their size; each opens from the server', async () => {
    const root = await open(drawerCtx({ attachments: FILES }));
    const list = byLabel(root, 'Attachments');
    expect(list.querySelectorAll('li')).toHaveLength(2);
    const img = list.querySelector('img');
    expect(img.src).toBe('http://localhost:4000/uploads/site-photo.png');
    expect(list.textContent).toContain('PDF');
    expect(list.textContent).toContain('2.0 KB');
    expect(list.textContent).toContain('3.0 MB');
    const link = byText(list, 'a', 'report.pdf');
    expect(link.href).toBe('http://localhost:4000/uploads/report.pdf');
    expect(link.target).toBe('_blank');
    expect(root.querySelector('section[aria-labelledby="td-files-h"] h3').textContent).toBe('Attachments (2)');
  });

  it('a picture opens in a preview inside the drawer; Escape closes only the preview, and focus goes back', async () => {
    const onClose = vi.fn();
    const root = await open(drawerCtx({ attachments: FILES }), onClose);
    releases.push(showModal(root, { onEscape: onClose }));
    const button = byLabel(root, 'Preview site photo.png');
    button.focus();
    button.click();
    await settle();
    const preview = root.querySelector('[role="dialog"][aria-label="Preview of site photo.png"]');
    expect(preview.querySelector('img').alt).toBe('site photo.png');
    expect(active()).toBe(byLabel(preview, 'Close preview'));
    expect(root.querySelector('.drawer-body').hasAttribute('inert')).toBe(true);
    key(active(), 'Escape');
    await settle();
    expect(onClose).not.toHaveBeenCalled();
    expect(root.querySelector('[aria-label="Preview of site photo.png"]')).toBeNull();
    expect(root.querySelector('.drawer-body').hasAttribute('inert')).toBe(false);
    expect(active()).toBe(byLabel(root, 'Preview site photo.png'));
    expect(byLabel(root, 'Preview report.pdf')).toBeNull(); // only pictures are previewed here
  });

  it('attaches chosen files one by one, online only, and says what happened to each', async () => {
    const ctx = drawerCtx();
    ctx.api.attachments.upload = vi.fn(async (_id, file) => {
      if (file.name === 'huge.zip') throw new ApiError(413, 'File too large', 'PAYLOAD_TOO_LARGE');
      return { id: `f-${file.name}`, uploadedById: 'u1', filename: file.name, mimeType: file.type, sizeBytes: file.size, url: `/uploads/${file.name}` };
    });
    const root = await open(ctx);
    pick(root, [new File(['a'], 'notes.txt', { type: 'text/plain' }), new File(['z'], 'huge.zip', { type: 'application/zip' })]);
    await settle();
    expect(ctx.api.attachments.upload.mock.calls.map((c) => [c[0], c[1].name])).toEqual([['t1', 'notes.txt'], ['t1', 'huge.zip']]);
    expect(byLabel(root, 'Attachments').textContent).toContain('notes.txt');
    expect(root.querySelector('.td-upload-err').textContent).toBe('huge.zip: That file is too large to upload.');
    expect(ctx.afterMutation).toHaveBeenCalled();
    byText(root, 'button', 'Dismiss').click();
    await settle();
    expect(root.querySelector('.td-upload-err')).toBeNull();

    ctx.isOnline = () => false;
    pick(root, [new File(['b'], 'later.txt', { type: 'text/plain' })]);
    await settle();
    expect(ctx.api.attachments.upload).toHaveBeenCalledTimes(2);
    expect(root.querySelector('[role="alert"]').textContent).toBe('Files can’t be attached offline. Attach them when you’re connected.');
  });

  it('a picture pasted anywhere in the drawer is attached; text pasted into a box stays text', async () => {
    const ctx = drawerCtx();
    const root = await open(ctx);
    const shot = new File(['png'], 'image.png', { type: 'image/png' });
    const e = paste(byLabel(root, 'Close'), { files: [shot] });
    await settle();
    expect(e.defaultPrevented).toBe(true);
    expect(ctx.api.attachments.upload).toHaveBeenCalledTimes(1);
    expect(ctx.api.attachments.upload.mock.calls[0][1].name).toMatch(/^Pasted image \d{4}-\d{2}-\d{2} \d{2}\.\d{2}\.\d{2}\.png$/);
    expect(root.querySelector('.sr-only[role="status"]').textContent).toMatch(/^Attached Pasted image/);
    const typed = paste(byLabel(root, 'New comment'), { files: [shot], text: 'Qty 4' });
    await settle();
    expect(typed.defaultPrevented).toBe(false);
    expect(ctx.api.attachments.upload).toHaveBeenCalledTimes(1);
  });

  it('a file dropped anywhere in the drawer is attached — Chrome never opens it in the tab, so nothing typed is lost (review M6)', async () => {
    const ctx = drawerCtx();
    const root = await open(ctx);
    const box = byLabel(root, 'New comment');
    box.value = 'Half-written comment';
    const over = drag('dragover', box, { files: [] });
    expect(over.defaultPrevented).toBe(true); // the drop lands here, not on the tab
    const dropped = drag('drop', box, { files: [new File(['a'], 'site photo.jpg', { type: 'image/jpeg' })] });
    await settle();
    expect(dropped.defaultPrevented).toBe(true);
    expect(ctx.api.attachments.upload.mock.calls.map((c) => c[1].name)).toEqual(['site photo.jpg']);
    expect(byLabel(root, 'New comment').value).toBe('Half-written comment');
    // On the files' own zone: attached once, not twice.
    drag('drop', root.querySelector('.td-drop'), { files: [new File(['b'], 'b.pdf', { type: 'application/pdf' })] });
    await settle();
    expect(ctx.api.attachments.upload.mock.calls.map((c) => c[1].name)).toEqual(['site photo.jpg', 'b.pdf']);
  });

  it('text dragged into a box stays a text drop; a file dropped while the task can’t take one is only kept from opening', async () => {
    const ctx = drawerCtx();
    const root = await open(ctx);
    const text = drag('drop', byLabel(root, 'New comment'), { types: ['text/plain'] });
    expect(text.defaultPrevented).toBe(false);
    expect(drag('dragover', byLabel(root, 'New comment'), { types: ['text/plain'] }).defaultPrevented).toBe(false);
    ctx.isOnline = () => false;
    const offline = drag('drop', byLabel(root, 'Close'), { files: [new File(['a'], 'a.txt', { type: 'text/plain' })] });
    await settle();
    expect(offline.defaultPrevented).toBe(true);
    expect(ctx.api.attachments.upload).not.toHaveBeenCalled();
    expect(root.querySelector('[role="alert"]').textContent).toBe('Files can’t be attached offline. Attach them when you’re connected.');
  });

  it('removes a file after asking (Keep is the safe answer, focused); only its uploader or an admin may', async () => {
    const ctx = drawerCtx({ attachments: FILES });
    const root = await open(ctx);
    expect(byLabel(root, 'Delete report.pdf')).toBeNull(); // Omar's file
    byLabel(root, 'Delete site photo.png').click();
    await settle();
    const ask = byLabel(root, 'Confirm delete');
    expect(ask.textContent).toContain('Delete this file?');
    expect(active()).toBe(byText(ask, 'button', 'Keep'));
    byText(ask, 'button', 'Keep').click();
    await settle();
    expect(byLabel(root, 'Confirm delete')).toBeNull();
    expect(ctx.write).not.toHaveBeenCalled();
    byLabel(root, 'Delete site photo.png').click();
    await settle();
    byText(root, 'button', 'Yes, delete').click();
    await settle();
    expect(ctx.write).toHaveBeenCalledWith('attachment.delete', { id: 't1', attachmentId: 'f1', filename: 'site photo.png' });
    expect(byLabel(root, 'Attachments').textContent).not.toContain('site photo.png');

    document.body.innerHTML = '';
    const admin = await open(drawerCtx({ attachments: FILES, me: { roles: ['ADMIN'] } }));
    expect(byLabel(admin, 'Delete report.pdf')).toBeTruthy();
  });

  it('a failed delete puts the file back and says why', async () => {
    const ctx = drawerCtx({ attachments: FILES });
    ctx.write = vi.fn(async () => { throw new ApiError(403, 'You can only delete your own attachments.', 'FORBIDDEN'); });
    const root = await open(ctx);
    byLabel(root, 'Delete site photo.png').click();
    await settle();
    byText(root, 'button', 'Yes, delete').click();
    await settle();
    expect(root.querySelector('[role="alert"]').textContent).toBe('You can only delete your own attachments.');
    expect(byLabel(root, 'Attachments').textContent).toContain('site photo.png');
  });
});

describe('comments: threads, replies, edits, deletes and @mentions', () => {
  const at = (m) => `2026-10-21T08:${String(m).padStart(2, '0')}:00.000Z`;
  const COMMENTS = [
    { id: 'c1', taskId: 't1', userId: 'u2', body: 'Can you check the valve, @mariam?', parentId: null, editedAt: null, createdAt: at(1) },
    { id: 'c2', taskId: 't1', userId: 'u1', body: 'On it', parentId: 'c1', editedAt: null, createdAt: at(2) },
    { id: 'c3', taskId: 't1', userId: 'u3', body: 'Photos attached', parentId: null, editedAt: at(9), createdAt: at(3) },
    { id: 'c4', taskId: 't1', userId: 'u2', body: 'Thanks', parentId: 'c2', editedAt: null, createdAt: at(4) },
  ];
  const thread = (root, id) => root.querySelector(`[data-comment-id="${id}"]`);
  /** The comment itself (a thread's first comment, without its replies). */
  const own = (root, id) => thread(root, id).querySelector('.td-comment');
  const posted = (kind, p) => ({ queued: false, data: kind === 'comment.add' ? { id: 'c9', taskId: 't1', userId: 'u1', body: p.body, parentId: p.parentId || null, editedAt: null, createdAt: at(30) } : kind === 'comment.update' ? { ...COMMENTS.find((c) => c.id === p.commentId), body: p.body, editedAt: at(31) } : undefined });

  it('replies sit under the comment they answer; a reply to a reply says whom it answers', async () => {
    const root = await open(drawerCtx({ comments: COMMENTS }));
    const first = thread(root, 'c1');
    expect(first.querySelector('ul[aria-label="Replies to Omar Ahmed"]').textContent).toContain('On it');
    expect(thread(root, 'c4').textContent).toContain('replying to Mariam Al Hinai');
    expect(thread(root, 'c3').textContent).toContain('(edited)');
    expect(byLabel(root, 'Comments').children).toHaveLength(2); // two threads
    // A real person's @name is marked.
    const mention = thread(root, 'c1').querySelector('.mention');
    expect(mention.textContent).toBe('@mariam');
    expect(mention.getAttribute('title')).toBe('Mariam Al Hinai');
  });

  it('a reply: written under the comment, sent with the comment it answers; the main box keeps its draft', async () => {
    const ctx = drawerCtx({ comments: COMMENTS });
    ctx.write = vi.fn(async (kind, p) => posted(kind, p));
    const root = await open(ctx);
    const main = byLabel(root, 'New comment');
    type(main, 'half-written note');
    byLabel(root, 'Reply to Aisha Khan').click();
    await settle();
    const box = byLabel(root, 'Your reply to Aisha Khan');
    expect(active()).toBe(box);
    type(box, 'Got them, thanks');
    key(box, 'Enter', { ctrlKey: true });
    await settle();
    expect(ctx.write).toHaveBeenCalledWith('comment.add', { id: 't1', body: 'Got them, thanks', parentId: 'c3' });
    expect(thread(root, 'c3').textContent).toContain('Got them, thanks');
    expect(byLabel(root, 'Your reply to Aisha Khan')).toBeNull();
    expect(byLabel(root, 'New comment').value).toBe('half-written note');
  });

  it('Escape closes a reply being written, not the drawer', async () => {
    const onClose = vi.fn();
    const root = await open(drawerCtx({ comments: COMMENTS }), onClose);
    releases.push(showModal(root, { onEscape: onClose }));
    byLabel(root, 'Reply to Omar Ahmed').click();
    await settle();
    key(byLabel(root, 'Your reply to Omar Ahmed'), 'Escape');
    await settle();
    expect(onClose).not.toHaveBeenCalled();
    expect(byLabel(root, 'Your reply to Omar Ahmed')).toBeNull();
    expect(active()).toBe(byLabel(root, 'Reply to Omar Ahmed'));
  });

  it('edits your own comment (only yours), and shows it was edited', async () => {
    const ctx = drawerCtx({ comments: COMMENTS });
    ctx.write = vi.fn(async (kind, p) => posted(kind, p));
    const root = await open(ctx);
    expect(own(root, 'c1').querySelector('[aria-label="Edit your comment"]')).toBeNull();
    thread(root, 'c2').querySelector('[aria-label="Edit your comment"]').click();
    await settle();
    const box = byLabel(root, 'Edit comment');
    expect(box.value).toBe('On it');
    expect(active()).toBe(box);
    type(box, 'On it — at 10');
    byLabel(root, 'Save comment').click();
    await settle();
    expect(ctx.write).toHaveBeenCalledWith('comment.update', { id: 't1', commentId: 'c2', body: 'On it — at 10' });
    expect(thread(root, 'c2').textContent).toContain('On it — at 10');
    expect(thread(root, 'c2').textContent).toContain('(edited)');
    expect(byLabel(root, 'Edit comment')).toBeNull();
  });

  it('deletes after asking — your own, or anyone’s as an admin', async () => {
    const ctx = drawerCtx({ comments: COMMENTS });
    const root = await open(ctx);
    expect(own(root, 'c1').querySelector('[aria-label^="Delete comment by"]')).toBeNull();
    thread(root, 'c2').querySelector('[aria-label="Delete your comment"]').click();
    await settle();
    const ask = byLabel(root, 'Confirm delete');
    expect(ask.textContent).toContain('Delete this comment?');
    expect(active()).toBe(byText(ask, 'button', 'Keep'));
    byText(ask, 'button', 'Yes, delete').click();
    await settle();
    expect(ctx.write).toHaveBeenCalledWith('comment.delete', { id: 't1', commentId: 'c2' });
    expect(thread(root, 'c2')).toBeNull();
    expect(thread(root, 'c4')).toBeTruthy(); // its reply stays

    document.body.innerHTML = '';
    const admin = await open(drawerCtx({ comments: COMMENTS, me: { roles: ['ADMIN'] } }));
    expect(own(admin, 'c1').querySelector('[aria-label="Delete comment by Omar Ahmed"]')).toBeTruthy();
    expect(own(admin, 'c1').querySelector('[aria-label="Edit your comment"]')).toBeNull();
  });

  it('a comment still waiting to sync can’t be answered, changed or deleted yet', async () => {
    const root = await open(drawerCtx({ comments: [{ id: 'tmp-q1', userId: 'u1', body: 'Offline note', parentId: null, createdAt: at(5), pending: true }] }));
    const row = thread(root, 'tmp-q1');
    expect(row.textContent).toContain('waiting to sync');
    expect(row.querySelectorAll('button')).toHaveLength(0);
  });

  it('@ suggests the people on the project; arrows choose, Enter puts the name in, Escape closes only the list', async () => {
    const onClose = vi.fn();
    const root = await open(drawerCtx(), onClose);
    releases.push(showModal(root, { onEscape: onClose }));
    const box = byLabel(root, 'New comment');
    box.focus();
    type(box, 'Thanks @a');
    const list = root.querySelector('[role="listbox"]');
    expect(list.getAttribute('aria-label')).toBe('Mention someone');
    expect([...list.querySelectorAll('[role="option"]')].map((o) => o.textContent)).toEqual(['Aisha Khan@aisha', 'Mariam Al Hinai@mariam', 'Omar Ahmed@omar']);
    expect(box.getAttribute('aria-autocomplete')).toBe('list');
    expect(box.getAttribute('aria-controls')).toBe(list.id);
    expect(box.getAttribute('aria-activedescendant')).toBe(list.querySelector('[aria-selected="true"]').id);
    key(box, 'ArrowDown');
    expect(root.querySelector('[role="listbox"] [aria-selected="true"]').textContent).toBe('Mariam Al Hinai@mariam');
    expect(key(box, 'Enter').defaultPrevented).toBe(true);
    expect(box.value).toBe('Thanks @mariam ');
    expect(box.selectionStart).toBe('Thanks @mariam '.length);
    expect(root.querySelector('[role="listbox"]')).toBeNull();
    expect(box.hasAttribute('aria-activedescendant')).toBe(false);
    type(box, 'Thanks @mariam and @zz');
    expect(root.querySelector('.td-mentions').textContent).toBe('No one on this project matches “@zz”.');
    type(box, 'Thanks @mariam and @o');
    key(box, 'Escape');
    expect(onClose).not.toHaveBeenCalled();
    expect(root.querySelector('[role="listbox"]')).toBeNull();
  });

  it('posts with the button or Ctrl+Enter; a failed post keeps the text and says why', async () => {
    const ctx = drawerCtx();
    ctx.write = vi.fn(async () => { throw new ApiError(400, 'A comment cannot be empty.', 'VALIDATION'); });
    const root = await open(ctx);
    const box = byLabel(root, 'New comment');
    type(box, 'Ready for review');
    key(box, 'Enter', { ctrlKey: true });
    await settle();
    expect(ctx.write).toHaveBeenCalledWith('comment.add', { id: 't1', body: 'Ready for review' });
    expect(root.querySelector('[role="alert"]').textContent).toBe('A comment cannot be empty.');
    expect(byLabel(root, 'New comment').value).toBe('Ready for review');
    expect(byLabel(root, 'Comments').textContent).not.toContain('Ready for review');
  });
});

describe('activity (read-only)', () => {
  const at = (m) => new Date(Date.UTC(2026, 9, 21, 9, 0) - m * 60_000).toISOString();
  const ROWS = [
    { id: 'a7', action: 'ATTACHED', userId: 'u2', actor: { id: 'u2', name: 'Omar Ahmed' }, createdAt: at(1), meta: { filename: 'valve.png' } },
    { id: 'a6', action: 'COMMENTED', userId: 'u3', actor: { id: 'u3', name: 'Aisha Khan' }, createdAt: at(50), meta: {} },
    { id: 'a5', action: 'MOVED', userId: 'u1', actor: { id: 'u1', name: 'Mariam Al Hinai' }, createdAt: at(100), meta: { from: 'To Do', to: 'In Progress' } },
    { id: 'a4', action: 'UPDATED', userId: 'u2', actor: null, createdAt: at(200), meta: { changes: [{ field: 'priority', from: 'NORMAL', to: 'HIGH' }] } },
    { id: 'a3', action: 'ASSIGNED', userId: 'u3', actor: { id: 'u3', name: 'Aisha Khan' }, createdAt: at(300), meta: { assignee: 'Omar Ahmed' } },
    { id: 'a2', action: 'CHECKLIST_ADDED', userId: 'u3', actor: { id: 'u3', name: 'Aisha Khan' }, createdAt: at(400), meta: { text: 'Check the seal' } },
    { id: 'a1', action: 'CREATED', userId: 'u3', actor: { id: 'u3', name: 'Aisha Khan' }, createdAt: at(500), meta: {} },
  ];

  it('says what happened, newest first, five lines at a time', async () => {
    const root = await open(drawerCtx({ activity: ROWS }));
    const list = byLabel(root, 'Activity');
    const lines = () => [...list.querySelectorAll('li')].map((li) => li.querySelector('.td-act-text').textContent);
    expect(lines()).toEqual([
      'Omar Ahmed attached valve.png',
      'Aisha Khan commented',
      'Mariam Al Hinai moved this task',
      'Omar Ahmed changed priority from Normal to High',
      'Aisha Khan assigned Omar Ahmed',
    ]);
    expect(list.querySelectorAll('li')[2].textContent).toContain('To Do, then In Progress');
    byText(root, 'button', 'Show more').click();
    await settle();
    expect(byLabel(root, 'Activity').querySelectorAll('li')).toHaveLength(7);
    expect(byText(root, 'button', 'Show more')).toBeUndefined();
  });

  it('is read again after a change, so the change shows in it', async () => {
    const ctx = drawerCtx({ activity: ROWS.slice(1) });
    const root = await open(ctx);
    expect(ctx.api.tasks.activity).toHaveBeenCalledTimes(1);
    ctx.api.tasks.activity.mockImplementation(async () => ({ data: ROWS }));
    byText(root, 'button', 'High').click();
    await settle();
    expect(ctx.api.tasks.activity).toHaveBeenCalledTimes(2);
    expect(byLabel(root, 'Activity').textContent).toContain('attached valve.png');
  });

  it('nothing to show (or no activity on this server): no section', async () => {
    const root = await open(drawerCtx({ activity: [] }));
    expect(byLabel(root, 'Activity')).toBeNull();
  });
});

describe('deleting the task', () => {
  const asManager = PEOPLE.map((p) => (p.id === 'u1' ? { ...p, role: 'MANAGER' } : p));

  it('only an admin or a manager of the project is offered it', async () => {
    const member = await open(drawerCtx());
    expect(byText(member, 'button', 'Delete task')).toBeUndefined();
    document.body.innerHTML = '';
    expect(byText(await open(drawerCtx({ members: asManager })), 'button', 'Delete task')).toBeTruthy();
    document.body.innerHTML = '';
    expect(byText(await open(drawerCtx({ me: { roles: ['ADMIN'] } })), 'button', 'Delete task')).toBeTruthy();
  });

  it('asks first (Cancel is focused); deleting closes the drawer', async () => {
    const onClose = vi.fn();
    const ctx = drawerCtx({ members: asManager });
    const root = await open(ctx, onClose);
    byText(root, 'button', 'Delete task').click();
    await settle();
    const ask = byLabel(root, 'Confirm delete');
    expect(ask.textContent).toContain('Delete this task? This can’t be undone.');
    expect(active()).toBe(byText(ask, 'button', 'Cancel'));
    byText(ask, 'button', 'Cancel').click();
    await settle();
    expect(byLabel(root, 'Confirm delete')).toBeNull();
    expect(active()).toBe(byText(root, 'button', 'Delete task'));
    byText(root, 'button', 'Delete task').click();
    await settle();
    byText(root, 'button', 'Delete').click();
    await settle();
    expect(ctx.write).toHaveBeenCalledWith('task.delete', { id: 't1' });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(ctx.afterMutation).toHaveBeenCalled();
  });

  it('a repeating task: this copy, or the whole series', async () => {
    const ctx = drawerCtx({ me: { roles: ['ADMIN'] }, task: { recurrenceRule: { freq: 'DAILY', interval: 1 }, recurrenceParentId: 's1' } });
    const onClose = vi.fn();
    const root = await open(ctx, onClose);
    byText(root, 'button', 'Delete task').click();
    await settle();
    expect(byLabel(root, 'Confirm delete').textContent).toContain('This is a repeating task — delete which?');
    byText(root, 'button', 'The whole series').click();
    await settle();
    expect(ctx.write).toHaveBeenCalledWith('task.delete', { id: 't1', scope: 'series', seriesId: 's1' });
    expect(onClose).toHaveBeenCalled();

    document.body.innerHTML = '';
    const first = drawerCtx({ me: { roles: ['ADMIN'] }, task: { recurrenceRule: { freq: 'DAILY', interval: 1 }, recurrenceParentId: null } });
    const root2 = await open(first);
    byText(root2, 'button', 'Delete task').click();
    await settle();
    byText(root2, 'button', 'This copy').click();
    await settle();
    expect(first.write).toHaveBeenCalledWith('task.delete', { id: 't1' });
  });

  it('a refused delete says why and keeps the drawer open', async () => {
    const onClose = vi.fn();
    const ctx = drawerCtx({ me: { roles: ['ADMIN'] } });
    ctx.write = vi.fn(async () => { throw new ApiError(403, 'You do not have permission to do that.', 'FORBIDDEN'); });
    const root = await open(ctx, onClose);
    byText(root, 'button', 'Delete task').click();
    await settle();
    byText(root, 'button', 'Delete').click();
    await settle();
    expect(root.querySelector('[role="alert"]').textContent).toBe('You do not have permission to do that.');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('a task deleted on this device (still to sync) opens as just that', async () => {
    const ctx = drawerCtx();
    ctx.api.tasks.get = vi.fn(async () => ({ data: { id: 't1', key: 'OPS-7', title: 'Inspect the rig', pendingDelete: true }, pending: 1 }));
    const root = await open(ctx);
    expect(root.querySelector('[role="status"]').textContent).toContain('You deleted this task on this device');
    expect(byLabel(root, 'Task title')).toBeNull();
    expect(root.querySelectorAll('.drawer-body button')).toHaveLength(0);
  });
});

describe('the drawer’s messages are live regions that stay on the page', () => {
  it('problems, “saved on this device” and what a click did are each announced', async () => {
    const root = await open();
    const regions = [...root.querySelectorAll('[role="alert"], [role="status"]')].slice(0, 3);
    expect(regions.map((r) => r.getAttribute('role'))).toEqual(['alert', 'status', 'status']);
    for (const r of regions) expect(r.classList.contains('hidden')).toBe(false);
    expect(regions[2].className).toBe('sr-only');
  });
});

describe('quick changes, late answers and redraws', () => {
  const gated = () => {
    let open;
    const gate = new Promise((r) => { open = r; });
    return { gate, open };
  };
  const at = (m) => `2026-10-21T08:${String(m).padStart(2, '0')}:00.000Z`;
  const mineToo = [
    { id: 'c1', userId: 'u1', body: 'First of mine', parentId: null, createdAt: at(1) },
    { id: 'c2', userId: 'u1', body: 'Second of mine', parentId: null, createdAt: at(2) },
  ];
  const row = (root, id) => root.querySelector(`[data-comment-id="${id}"]`);

  it('“Assign me” then “Unassign me” at once: sent in that order, and the newest shows', async () => {
    const g = gated();
    const ctx = drawerCtx();
    ctx.write = vi.fn()
      .mockImplementationOnce(async () => { await g.gate; return { queued: false, data: [{ id: 'u1', firstName: 'Mariam', lastName: 'Al Hinai' }] }; })
      .mockImplementationOnce(async () => ({ queued: false, data: undefined }));
    const root = await open(ctx);
    byText(root, 'button', 'Assign me').click();
    await settle();
    byText(root, 'button', 'Unassign me').click();
    await settle();
    expect(ctx.write).toHaveBeenCalledTimes(1); // the second waits for the first's answer
    g.open();
    await settle();
    expect(ctx.write.mock.calls.map((c) => c[0])).toEqual(['task.assign', 'task.unassign']);
    expect(byLabel(root, 'Assignees').textContent).not.toContain('Mariam');
    expect(byText(root, 'button', 'Assign me')).toBeTruthy();
  });

  it('a refused assignment takes back only itself', async () => {
    const g = gated();
    const ctx = drawerCtx();
    ctx.write = vi.fn()
      .mockImplementationOnce(async () => { await g.gate; throw new ApiError(400, 'Only active members of this project can be assigned.', 'VALIDATION'); })
      .mockImplementationOnce(async () => ({ queued: false, data: undefined }));
    const root = await open(ctx);
    change(byLabel(root, 'Add an assignee'), 'u2');
    await settle();
    change(byLabel(root, 'Add an assignee'), 'u3');
    await settle();
    g.open();
    await settle();
    const people = byLabel(root, 'Assignees').textContent;
    expect(people).toContain('Aisha Khan');
    expect(people).not.toContain('Omar Ahmed');
    expect(root.querySelector('[role="alert"]').textContent).toBe('Only active members of this project can be assigned.');
  });

  it('Watch then stop watching at once: the newest shows, and the count follows it', async () => {
    const g = gated();
    const ctx = drawerCtx({ watchers: [{ id: 'u2' }] });
    ctx.write = vi.fn()
      .mockImplementationOnce(async () => { await g.gate; return { queued: false, data: { watching: true, watchers: [{ id: 'u2' }, { id: 'u1' }] } }; })
      .mockImplementationOnce(async () => ({ queued: false, data: undefined }));
    const root = await open(ctx);
    byLabel(root, 'Watch this task').click();
    await settle();
    byLabel(root, 'Watch this task').click();
    await settle();
    expect(ctx.write).toHaveBeenCalledTimes(1);
    g.open();
    await settle();
    expect(ctx.write.mock.calls.map((c) => c[0])).toEqual(['task.watch', 'task.unwatch']);
    expect(byLabel(root, 'Watch this task').getAttribute('aria-pressed')).toBe('false');
    expect(root.querySelector('.td-watchers').textContent).toBe('1 watching');
  });

  it('a delete that fails late puts back only what it deleted (files and comments)', async () => {
    const g = gated();
    const files = [
      { id: 'f1', uploadedById: 'u1', filename: 'a.txt', mimeType: 'text/plain', sizeBytes: 1, url: '/uploads/a.txt' },
      { id: 'f2', uploadedById: 'u1', filename: 'b.txt', mimeType: 'text/plain', sizeBytes: 1, url: '/uploads/b.txt' },
    ];
    const ctx = drawerCtx({ attachments: files, comments: mineToo });
    ctx.write = vi.fn(async (kind, p) => {
      if ((kind === 'attachment.delete' && p.attachmentId === 'f1') || (kind === 'comment.delete' && p.commentId === 'c1')) {
        await g.gate;
        throw new ApiError(400, 'Not now.', 'VALIDATION');
      }
      return { queued: false, data: undefined };
    });
    const root = await open(ctx);
    for (const id of ['f1', 'f2']) {
      byLabel(root, `Delete ${id === 'f1' ? 'a.txt' : 'b.txt'}`).click();
      await settle();
      byText(root, 'button', 'Yes, delete').click();
      await settle();
    }
    for (const id of ['c1', 'c2']) {
      row(root, id).querySelector('[aria-label="Delete your comment"]').click();
      await settle();
      byText(root, 'button', 'Yes, delete').click();
      await settle();
    }
    g.open();
    await settle();
    const list = byLabel(root, 'Attachments').textContent;
    expect(list).toContain('a.txt');
    expect(list).not.toContain('b.txt');
    expect(row(root, 'c1')).toBeTruthy();
    expect(row(root, 'c2')).toBeNull();
  });

  it('an open “Delete this …?” doesn’t pull focus away when its section draws again', async () => {
    const ctx = drawerCtx({ comments: mineToo, attachments: [{ id: 'f1', uploadedById: 'u1', filename: 'a.txt', mimeType: 'text/plain', sizeBytes: 1, url: '/uploads/a.txt' }] });
    ctx.write = vi.fn(async (kind, p) => ({ queued: false, data: kind === 'comment.add' ? { id: 'c9', userId: 'u1', body: p.body, parentId: null, createdAt: at(9) } : undefined }));
    const root = await open(ctx);
    row(root, 'c1').querySelector('[aria-label="Delete your comment"]').click();
    byLabel(root, 'Delete a.txt').click();
    await settle();
    const box = byLabel(root, 'New comment');
    box.focus();
    type(box, 'Another note');
    key(box, 'Enter', { ctrlKey: true });
    await settle();
    expect(row(root, 'c9')).toBeTruthy();
    expect(active()).toBe(byLabel(root, 'New comment'));
    // A screenshot pasted while typing: the files section draws again as it goes up.
    const e = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(e, 'clipboardData', { value: { files: [new File(['p'], 'image.png', { type: 'image/png' })], items: [], getData: () => '' } });
    box.dispatchEvent(e);
    await settle();
    expect(ctx.api.attachments.upload).toHaveBeenCalledTimes(1);
    expect(active()).toBe(byLabel(root, 'New comment'));
  });

  it('a file attached while the list is still loading stays listed when the list comes', async () => {
    const g = gated();
    const ctx = drawerCtx();
    ctx.api.tasks.attachments = vi.fn(async () => { await g.gate; return { data: [{ id: 'old', filename: 'old.pdf', mimeType: 'application/pdf', sizeBytes: 5, url: '/uploads/old.pdf' }] }; });
    const root = await open(ctx);
    const input = byLabel(root, 'Attach files');
    Object.defineProperty(input, 'files', { value: [new File(['n'], 'new.txt', { type: 'text/plain' })], configurable: true });
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
    g.open();
    await settle();
    const list = byLabel(root, 'Attachments').textContent;
    expect(list).toContain('new.txt');
    expect(list).toContain('old.pdf');
  });

  it('focus stays on the very control it was on, though others in the list have the same name', async () => {
    const g = gated();
    const ctx = drawerCtx({ comments: mineToo });
    ctx.api.tasks.mentionable = vi.fn(async () => { await g.gate; return { data: [] }; });
    const root = await open(ctx);
    const second = row(root, 'c2').querySelector('[aria-label="Edit your comment"]');
    second.focus();
    g.open(); // the people to mention arrive: the comments draw again
    await settle();
    expect(second.isConnected).toBe(false);
    expect(active()).toBe(row(root, 'c2').querySelector('[aria-label="Edit your comment"]'));
  });
});
