// @vitest-environment jsdom
/**
 * The toolbar popup's New task form (quick capture), rendered against a stub context: where the task
 * goes, who works on it, "Describe it", pasted and dropped files, "Add this page", offline, the
 * unsent form surviving the popup closing, recent tasks, and the keyboard.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QuickAddForm, SignedOutView } from '../popup/quick-add-form.js';
import { DRAFT_KEY, LAST_PROJECT_KEY, RECENT_KEY, QUEUED_MESSAGE, QUEUED_WITHOUT_FILES_MESSAGE, OFFLINE_FILES_MESSAGE, UNREACHABLE_FILES_MESSAGE } from './quick-add.js';
import { ApiError, QueueError } from './errors.js';
import { fakeStorage } from './test-helpers.js';

const settle = async () => {
  for (let i = 0; i < 12; i += 1) await new Promise((r) => setTimeout(r, 0));
};
const byText = (root, tag, text) => [...root.querySelectorAll(tag)].find((n) => n.textContent.trim() === text);
const $ = (id) => document.getElementById(id);
const type = (node, value) => {
  node.value = value;
  node.dispatchEvent(new Event('input', { bubbles: true }));
};
const choose = (node, value) => {
  node.value = value;
  node.dispatchEvent(new Event('change', { bubbles: true }));
};
const options = (select) => [...select.options].map((o) => o.value);

const PROJECTS = [
  { id: 'p1', name: 'Ops', code: 'OPS', status: 'ACTIVE', ownerId: 'u2' },
  { id: 'p2', name: 'Rig 1', code: 'RIG1', number: '2026-014', status: 'ACTIVE', ownerId: 'u3' },
  { id: 'p3', name: 'Old', code: 'OLD', status: 'ARCHIVED' },
  { id: 'p4', name: 'مشروع الصيانة', code: 'MNT', status: 'PLANNING' },
];
const COLUMNS = {
  p1: [{ id: 'c2', name: 'In progress', category: 'IN_PROGRESS', position: 1, enabled: true }, { id: 'c1', name: 'To do', category: 'TODO', position: 0, enabled: true }, { id: 'cx', name: 'Hidden', category: 'REVIEW', position: 2, enabled: false }],
  p2: [{ id: 'd1', name: 'Backlog', category: 'BACKLOG', position: 0, enabled: true }, { id: 'd2', name: 'Doing', category: 'IN_PROGRESS', position: 1, enabled: true }],
  p4: [{ id: 'e1', name: 'To do', category: 'TODO', position: 0, enabled: true }],
};
const person = (id, firstName, lastName, username) => ({ id, firstName, lastName, username });
const MEMBERS = {
  p1: [person('me', 'Khurram', 'Shah', 'khurram'), person('u2', 'Omar', 'Said', 'omar'), person('u5', 'Layla', 'Nasser', 'layla')],
  p2: [person('me', 'Khurram', 'Shah', 'khurram'), person('u3', 'Mariam', 'Al Hinai', 'mariam')],
  p4: [person('u2', 'Omar', 'Said', 'omar')],
};

let online = true;
function makeCtx(over = {}) {
  let n = 0;
  return {
    me: { id: 'me', name: 'Khurram Shah' },
    timeZone: 'Asia/Muscat',
    appBase: 'https://task.mico360.com',
    appPage: 'chrome-extension://abc/app/app.html',
    local: fakeStorage(over.local || {}),
    session: fakeStorage(over.session || {}),
    isOnline: () => online,
    api: {
      projects: {
        list: vi.fn(async () => ({ data: PROJECTS })),
        columns: vi.fn(async (id) => ({ data: COLUMNS[id] || [] })),
        members: vi.fn(async (id) => ({ data: MEMBERS[id] || [] })),
      },
      ai: { parseTask: vi.fn() },
      attachments: { upload: vi.fn(async (taskId, file) => ({ id: 'a1', taskId, filename: file.name })) },
    },
    newKey: () => `key-${(n += 1)}`,
    send: vi.fn(async (kind, payload) => ({ queued: false, data: { id: 't9', key: 'OPS-12', title: payload.title, projectId: payload.projectId } })),
    currentPage: vi.fn(async () => null),
    capture: null,
    openApp: vi.fn(),
    close: vi.fn(),
    shortcut: async () => 'Ctrl+Shift+K',
    ...over.ctx,
  };
}

async function open(ctx = makeCtx()) {
  const root = QuickAddForm(ctx);
  document.body.append(root);
  await settle();
  return { root, ctx };
}

function paste(target, files, text = '') {
  const e = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(e, 'clipboardData', { value: { files, items: [], getData: (t) => (t === 'text/plain' ? text : '') } });
  target.dispatchEvent(e);
  return e;
}

beforeEach(() => {
  online = true;
  document.body.innerHTML = '';
});
afterEach(() => {
  document.body.innerHTML = '';
});

describe('where the task goes', () => {
  it('starts in the project used last, offers no archived project, and shows its board’s columns in order', async () => {
    const { root } = await open(makeCtx({ local: { [LAST_PROJECT_KEY]: { userId: 'me', projectId: 'p2' } } }));
    expect($('qa-project').value).toBe('p2');
    expect(options($('qa-project'))).toEqual(['p1', 'p2', 'p4']);
    expect(options($('qa-column'))).toEqual(['d1', 'd2']);
    expect($('qa-column').value).toBe('d1');
    expect(document.activeElement).toBe($('qa-title'));
    expect(root.querySelector('form').getAttribute('aria-label')).toBe('New task');
  });

  it('the project the page shows (the web board, a dashboard, the extension’s board) comes first', async () => {
    const ctx = makeCtx({ local: { [LAST_PROJECT_KEY]: { userId: 'me', projectId: 'p2' } }, ctx: { currentPage: async () => ({ title: 'Board', url: 'https://task.mico360.com/board?project=p4' }) } });
    await open(ctx);
    expect($('qa-project').value).toBe('p4');
    // Someone else's last project is not used.
    const other = makeCtx({ local: { [LAST_PROJECT_KEY]: { userId: 'someone', projectId: 'p2' } } });
    document.body.innerHTML = '';
    await open(other);
    expect($('qa-project').value).toBe('p1');
  });

  it('Arabic project names and typed text follow their own direction', async () => {
    await open();
    const arabic = [...$('qa-project').options].find((o) => o.value === 'p4');
    expect(arabic.getAttribute('dir')).toBe('auto');
    expect($('qa-title').getAttribute('dir')).toBe('auto');
    expect($('qa-desc').getAttribute('dir')).toBe('auto');
    expect($('qa-describe').getAttribute('dir')).toBe('auto');
  });

  it('changing the project lands in the same kind of column, and takes off people who aren’t on its team', async () => {
    const { root } = await open();
    choose($('qa-column'), 'c2'); // in progress
    choose($('qa-people'), 'u2');
    choose($('qa-people'), 'u5');
    expect(root.textContent).toContain('Omar Said');
    choose($('qa-project'), 'p2');
    await settle();
    expect($('qa-column').value).toBe('d2'); // "Doing" is in progress too
    expect(root.querySelector('[aria-label="Remove Omar Said"]')).toBeNull();
    expect(root.textContent).toContain('Omar Said and Layla Nasser aren’t on Rig 1, so they were taken off this task.');
  });
});

describe('creating the task', () => {
  it('needs a title: says so, marks the field and puts focus on it; nothing is sent', async () => {
    const { root, ctx } = await open();
    byText(root, 'button', 'Create task').click();
    await settle();
    expect(ctx.send).not.toHaveBeenCalled();
    expect($('qa-title').getAttribute('aria-invalid')).toBe('true');
    const err = $($('qa-title').getAttribute('aria-describedby'));
    expect(err.textContent).toBe('Give the task a title.');
    expect(document.activeElement).toBe($('qa-title'));
  });

  it('the missing-title message is read out even when focus is already in the title (M5)', async () => {
    const { ctx } = await open();
    $('qa-title').focus();
    $('qa-title').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true, cancelable: true }));
    await settle();
    expect(ctx.send).not.toHaveBeenCalled();
    expect($('qa-title-err').textContent).toBe('Give the task a title.');
    expect($('qa-title-err').getAttribute('role')).toBe('alert');
  });

  it('sends the title, place, priority, due date, people and description, then is ready for the next one', async () => {
    const { root, ctx } = await open();
    type($('qa-title'), '  Replace the filter on RIG1  ');
    choose($('qa-priority'), 'HIGH');
    type($('qa-due'), '2026-10-26');
    byText(root, 'button', 'Assign me').click();
    choose($('qa-people'), 'u2');
    type($('qa-desc'), 'Use the spare from store 2.');
    expect(root.textContent).not.toContain('Nobody picked');
    byText(root, 'button', 'Create task').click();
    await settle();
    expect(ctx.send).toHaveBeenCalledWith('task.create', {
      title: 'Replace the filter on RIG1', projectId: 'p1', columnId: 'c1', priority: 'HIGH', dueDate: '2026-10-26',
      description: 'Use the spare from store 2.', assigneeIds: ['me', 'u2'],
    }, { idempotencyKey: 'key-1', hold: false });
    const status = root.querySelector('.qa-banner');
    expect(status.getAttribute('role')).toBe('status');
    expect(status.textContent).toContain('Created OPS-12 “Replace the filter on RIG1”.');
    byText(root, 'button', 'Open it').click();
    expect(ctx.openApp).toHaveBeenCalledWith('#/task/t9');
    // Ready for the next one, in the same place.
    expect($('qa-title').value).toBe('');
    expect($('qa-priority').value).toBe('NORMAL');
    expect($('qa-project').value).toBe('p1');
    expect(ctx.local.data[LAST_PROJECT_KEY]).toEqual({ userId: 'me', projectId: 'p1' });
    expect(ctx.session.data[DRAFT_KEY]).toBeUndefined();
    // …and the task is listed under "Recently added".
    expect(ctx.local.data[RECENT_KEY].userId).toBe('me');
    const recent = root.querySelector('.qa-recent');
    expect(recent.textContent).toContain('OPS-12');
    byText(recent, 'button', 'OPS-12 Replace the filter on RIG1').click();
    expect(ctx.openApp).toHaveBeenLastCalledWith('#/task/t9');
  });

  it('says who gets the task when nobody is picked (the project owner)', async () => {
    const { root } = await open();
    expect(root.textContent).toContain('Nobody picked — the task will go to Omar Said, the project owner.');
  });

  it('offers "Assign me" only on a project you are on', async () => {
    const { root } = await open();
    choose($('qa-project'), 'p4');
    await settle();
    expect(byText(root, 'button', 'Assign me')).toBeUndefined();
  });

  it('shows the server’s reason when it refuses the task (H2)', async () => {
    const ctx = makeCtx({ ctx: { send: vi.fn(async () => { throw new ApiError(400, 'Only active members of this project can be assigned.'); }) } });
    const { root } = await open(ctx);
    type($('qa-title'), 'X');
    byText(root, 'button', 'Create task').click();
    await settle();
    const alert = root.querySelector('[role="alert"]');
    expect(alert.textContent).toContain('Couldn’t create the task. Only active members of this project can be assigned.');
    expect($('qa-title').value).toBe('X'); // what was entered stays
  });

  it('Ctrl+Enter creates it from any field', async () => {
    const { ctx } = await open();
    type($('qa-title'), 'From the keyboard');
    $('qa-desc').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true, cancelable: true }));
    await settle();
    expect(ctx.send).toHaveBeenCalledTimes(1);
  });

  it('is never sent twice while it is being created', async () => {
    let release;
    const ctx = makeCtx({ ctx: { send: vi.fn(() => new Promise((r) => { release = r; })) } });
    const { root } = await open(ctx);
    type($('qa-title'), 'Once');
    const button = byText(root, 'button', 'Create task');
    button.click();
    await settle();
    expect(button.disabled).toBe(true);
    expect(button.textContent).toBe('Creating…');
    root.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    expect(ctx.send).toHaveBeenCalledTimes(1);
    release({ queued: false, data: { id: 't1', key: 'OPS-1', title: 'Once' } });
    await settle();
  });
});

describe('a task is never created twice (I1, I2)', () => {
  /** A newKey that hands out a different key on every call, so a thrown-away key shows. */
  const keys = (prefix) => {
    let n = 0;
    return () => `${prefix}-${(n += 1)}`;
  };
  const keyOf = (ctx, call) => ctx.send.mock.calls[call][2].idempotencyKey;
  const photo = () => new File(['jpg'], 'site.jpg', { type: 'image/jpeg' });

  it('the key is kept with the form before it is sent; reopened after the popup closed mid-send, the same task goes with the same key (I1 B)', async () => {
    let kept;
    const first = makeCtx({ ctx: { newKey: keys('first') } });
    first.send = vi.fn(() => {
      kept = first.session.data[DRAFT_KEY];
      return new Promise(() => {}); // the popup closes while it is on its way
    });
    const { root } = await open(first);
    type($('qa-title'), 'Sent as the popup closed');
    byText(root, 'button', 'Create task').click();
    await settle();
    expect(kept).toMatchObject({ pendingKey: 'first-1', payloadJSON: JSON.stringify(first.send.mock.calls[0][1]) });
    root.remove();

    const again = makeCtx({ session: first.session.data, ctx: { newKey: keys('again') } });
    await open(again);
    expect($('qa-title').value).toBe('Sent as the popup closed');
    byText(document.body, 'button', 'Create task').click();
    await settle();
    expect(keyOf(again, 0)).toBe('first-1');
    // …and the server's answer (its replay of the task) ends it as usual.
    expect(again.session.data[DRAFT_KEY]).toBeUndefined();
  });

  it('a changed task is a new one: it gets a new key', async () => {
    const ctx = makeCtx({ ctx: { newKey: keys('k') } });
    ctx.send = vi.fn(async () => { throw new QueueError(); }); // not sent, and not kept: try again
    const { root } = await open(ctx);
    type($('qa-title'), 'Same');
    byText(root, 'button', 'Create task').click();
    await settle();
    byText(root, 'button', 'Create task').click();
    await settle();
    expect([keyOf(ctx, 0), keyOf(ctx, 1)]).toEqual(['k-1', 'k-1']); // the first may have reached the server
    type($('qa-title'), 'Changed');
    byText(root, 'button', 'Create task').click();
    await settle();
    expect(keyOf(ctx, 2)).toBe('k-2');
  });

  it('after the server refused it, trying again is a fresh attempt (the server keeps its answer for a key)', async () => {
    const ctx = makeCtx({ ctx: { newKey: keys('k') } });
    ctx.send = vi.fn(async () => { throw new ApiError(400, 'Only active members of this project can be assigned.'); });
    const { root } = await open(ctx);
    type($('qa-title'), 'Refused');
    byText(root, 'button', 'Create task').click();
    await settle();
    byText(root, 'button', 'Create task').click();
    await settle();
    expect([keyOf(ctx, 0), keyOf(ctx, 1)]).toEqual(['k-1', 'k-2']);
  });

  it('once the task exists the kept form becomes the task: reopened during the upload, the popup says so and never makes it again (I1 A)', async () => {
    let atUpload;
    const first = makeCtx({ ctx: { newKey: keys('first') } });
    first.api.attachments.upload = vi.fn(() => {
      atUpload = first.session.data[DRAFT_KEY];
      return new Promise(() => {}); // a 6 MB photo; a click on the page closes the popup
    });
    const { root } = await open(first);
    type($('qa-title'), 'With a big photo');
    paste($('qa-title'), [photo()]);
    byText(root, 'button', 'Create task').click();
    await settle();
    expect(atUpload).toMatchObject({ userId: 'me', createdTask: { id: 't9', key: 'OPS-12', title: 'With a big photo' } });
    expect(atUpload.fields).toBeUndefined();
    root.remove();

    const again = makeCtx({ session: first.session.data, local: first.local.data, ctx: { newKey: keys('again') } });
    const { root: reopened } = await open(again);
    expect($('qa-title').value).toBe('');
    const banner = reopened.querySelector('.qa-banner');
    expect(banner.textContent).toContain('OPS-12 “With a big photo” was created; add its files from the task.');
    expect(reopened.textContent).not.toContain('unsent');
    expect(reopened.querySelector('.qa-recent').textContent).toContain('OPS-12');
    byText(banner, 'button', 'Open it').click();
    await settle();
    expect(again.openApp).toHaveBeenCalledWith('#/task/t9');
    expect(again.send).not.toHaveBeenCalled();
    expect(again.session.data[DRAFT_KEY]).toBeUndefined(); // said once
  });

  it('a held task sent again keeps its key (I2 a)', async () => {
    const ctx = makeCtx({ ctx: { newKey: keys('k') } });
    ctx.send = vi.fn(async (kind, payload, opts) => ({ queued: false, held: true, item: { idempotencyKey: opts.idempotencyKey } })); // timed out
    const { root } = await open(ctx);
    type($('qa-title'), 'Held');
    paste($('qa-title'), [photo()]);
    byText(root, 'button', 'Create task').click();
    await settle();
    byText(root, 'button', 'Create task').click();
    await settle();
    expect([keyOf(ctx, 0), keyOf(ctx, 1)]).toEqual(['k-1', 'k-1']);
  });

  it('a 409 "still being processed" after "Save without the files" keeps the key and the offer (I2 b)', async () => {
    const ctx = makeCtx({ ctx: { newKey: keys('k') } });
    ctx.send = vi.fn(async () => { throw new ApiError(409, 'The original request is still being processed. Retry shortly.', 'IDEMPOTENCY_IN_PROGRESS'); });
    online = false;
    const { root } = await open(ctx);
    type($('qa-title'), 'Held offline');
    paste($('qa-title'), [photo()]);
    byText(root, 'button', 'Create task').click();
    await settle();
    expect(ctx.send).not.toHaveBeenCalled();
    online = true;
    byText(root, 'button', 'Save without the files').click();
    await settle();
    expect(root.querySelector('[role="alert"]').textContent).toContain('still being processed');
    byText(root, 'button', 'Create task').click();
    await settle();
    expect([keyOf(ctx, 0), keyOf(ctx, 1)]).toEqual(['k-1', 'k-1']);
    expect(byText(root, 'button', 'Save without the files')).toBeTruthy();
  });
});

describe('offline', () => {
  it('a task without files is saved on this device and says so; it is listed as waiting to sync', async () => {
    const ctx = makeCtx({ ctx: { send: vi.fn(async () => ({ queued: true, item: { idempotencyKey: 'key-1' } })) } });
    await ctx.local.set({ syncQueue: [{ id: 'q1', kind: 'task.create', userId: 'me', idempotencyKey: 'key-1', status: 'pending', payload: {} }] });
    online = false;
    const { root } = await open(ctx);
    expect(root.querySelector('.qa-offbar').classList.contains('hidden')).toBe(false);
    type($('qa-title'), 'Offline task');
    byText(root, 'button', 'Create task').click();
    await settle();
    expect(root.querySelector('.qa-banner').textContent).toContain(QUEUED_MESSAGE);
    expect(root.querySelector('.qa-recent').textContent).toContain('Waiting to sync');
  });

  it('files can’t wait offline: nothing is sent, and the task can be saved without them (with the same key)', async () => {
    const ctx = makeCtx({ ctx: { send: vi.fn(async () => ({ queued: true, item: { idempotencyKey: 'key-1' } })) } });
    online = false;
    const { root } = await open(ctx);
    type($('qa-title'), 'With a photo');
    paste($('qa-title'), [new File(['png'], 'image.png', { type: 'image/png' })]);
    byText(root, 'button', 'Create task').click();
    await settle();
    expect(ctx.send).not.toHaveBeenCalled();
    expect(root.querySelector('[role="alert"]').textContent).toContain(OFFLINE_FILES_MESSAGE);
    byText(root, 'button', 'Save without the files').click();
    await settle();
    expect(ctx.send).toHaveBeenCalledWith('task.create', expect.objectContaining({ title: 'With a photo' }), { idempotencyKey: 'key-1', hold: false });
    expect(root.querySelector('.qa-banner').textContent).toContain(QUEUED_WITHOUT_FILES_MESSAGE);
    expect(root.querySelector('.qa-files li')).toBeNull();
    // Ready for the next task: nothing is left switched off.
    expect(byText(root, 'button', 'Assign me').disabled).toBe(false);
    expect($('qa-people').disabled).toBe(false);
    expect($('qa-project').disabled).toBe(false);
    expect($('qa-column').disabled).toBe(false);
    expect(byText(root, 'button', 'Create task').disabled).toBe(false);
  });

  it('when the server turns out to be unreachable with files, the task is held the same way, never queued silently', async () => {
    const ctx = makeCtx({ ctx: { send: vi.fn(async (kind, payload, opts) => ({ queued: false, held: true, item: { kind, payload, idempotencyKey: opts.idempotencyKey } })) } });
    const { root } = await open(ctx);
    type($('qa-title'), 'With a file');
    paste(root.querySelector('form'), [new File(['%PDF'], 'spec.pdf', { type: 'application/pdf' })]);
    byText(root, 'button', 'Create task').click();
    await settle();
    expect(ctx.send).toHaveBeenCalledWith('task.create', expect.any(Object), { idempotencyKey: 'key-1', hold: true });
    expect(root.querySelector('.qa-files').textContent).toContain('spec.pdf');
  });

  it('online but the server can’t be reached: it says so (not "offline"), and "Try again" (focused) keeps the key (M6)', async () => {
    const ctx = makeCtx({ ctx: { send: vi.fn(async (kind, payload, opts) => ({ queued: false, held: true, item: { kind, payload, idempotencyKey: opts.idempotencyKey } })) } });
    const { root } = await open(ctx);
    type($('qa-title'), 'With a file');
    paste(root.querySelector('form'), [new File(['%PDF'], 'spec.pdf', { type: 'application/pdf' })]);
    byText(root, 'button', 'Create task').click();
    await settle();
    const alert = root.querySelector('.qa-banner[role="alert"]');
    expect(alert.textContent).toContain(UNREACHABLE_FILES_MESSAGE);
    expect(alert.textContent).not.toContain('offline');
    const again = byText(alert, 'button', 'Try again');
    expect(document.activeElement).toBe(again);
    expect(byText(alert, 'button', 'Save without the files')).toBeTruthy();
    again.click();
    await settle();
    expect(ctx.send).toHaveBeenCalledTimes(2);
    expect(ctx.send.mock.calls[1][2]).toEqual({ idempotencyKey: 'key-1', hold: true });
    // Offline it still says "offline".
    online = false;
    byText(root, 'button', 'Try again').click();
    await settle();
    expect(root.querySelector('.qa-banner[role="alert"]').textContent).toContain(OFFLINE_FILES_MESSAGE);
  });
});

describe('pictures and files', () => {
  it('a pasted screenshot is named by when it was pasted; text pasted into a field stays text', async () => {
    const { root } = await open();
    const e = paste($('qa-title'), [new File(['png'], 'image.png', { type: 'image/png' })]);
    expect(e.defaultPrevented).toBe(true);
    expect(root.querySelector('.qa-files').textContent).toMatch(/Pasted image \d{4}-\d{2}-\d{2} \d{2}\.\d{2}\.\d{2}\.png/);
    const textPaste = paste($('qa-desc'), [new File(['png'], 'image.png', { type: 'image/png' })], 'Qty\tPrice');
    expect(textPaste.defaultPrevented).toBe(false);
    expect(root.querySelectorAll('.qa-files li')).toHaveLength(1);
  });

  it('dropped and chosen files are listed and can be taken off again', async () => {
    const { root } = await open();
    const drop = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(drop, 'dataTransfer', { value: { files: [new File(['a'], 'site photo.jpg', { type: 'image/jpeg' })], types: ['Files'] } });
    root.querySelector('form').dispatchEvent(drop);
    const input = root.querySelector('input[type="file"]');
    expect(input.getAttribute('aria-label')).toBe('Attach files');
    Object.defineProperty(input, 'files', { value: [new File(['b'], 'report.pdf', { type: 'application/pdf' })], configurable: true });
    input.dispatchEvent(new Event('change', { bubbles: true }));
    expect([...root.querySelectorAll('.qa-files li')].map((li) => li.querySelector('.qa-file-name').textContent)).toEqual(['site photo.jpg', 'report.pdf']);
    root.querySelector('[aria-label="Remove site photo.jpg"]').click();
    expect(root.querySelectorAll('.qa-files li')).toHaveLength(1);
  });

  it('the toolbar popup says "Choose files or paste a picture" (a drag closes it); a window of its own says "Drop files here" (M1)', async () => {
    const { root } = await open();
    expect(root.querySelector('.qa-drop-main').textContent).toBe('Choose files or paste a picture');
    expect(root.textContent).not.toContain('Drop files');
    document.body.innerHTML = '';
    const { root: win } = await open(makeCtx({ ctx: { inWindow: true } }));
    expect(win.querySelector('.qa-drop-main').textContent).toBe('Drop files here or browse');
  });

  it('go up after the task is created, one by one', async () => {
    const { root, ctx } = await open();
    type($('qa-title'), 'With files');
    paste($('qa-title'), [new File(['a'], 'a.png', { type: 'image/png' }), new File(['b'], 'b.pdf', { type: 'application/pdf' })]);
    byText(root, 'button', 'Create task').click();
    await settle();
    expect(ctx.send.mock.calls[0][2]).toEqual({ idempotencyKey: 'key-1', hold: true });
    expect(ctx.api.attachments.upload.mock.calls.map((c) => [c[0], c[1].name])).toEqual([['t9', 'a.png'], ['t9', 'b.pdf']]);
    expect(root.querySelector('.qa-banner').textContent).toContain('Created OPS-12 “With files”.');
  });

  it('a file that can’t go up is named with the reason; "Done" then starts the next task', async () => {
    const ctx = makeCtx();
    ctx.api.attachments.upload = vi.fn(async (taskId, file) => {
      if (file.name === 'big.zip') throw new ApiError(413, 'File too large');
      return { id: 'a1' };
    });
    const { root } = await open(ctx);
    type($('qa-title'), 'Two files');
    paste($('qa-title'), [new File(['a'], 'ok.png', { type: 'image/png' }), new File(['z'], 'big.zip', { type: 'application/zip' })]);
    byText(root, 'button', 'Create task').click();
    await settle();
    expect(root.querySelector('[role="alert"]').textContent).toContain('The task was created, but big.zip wasn’t attached: That file is too large to upload.');
    const done = byText(root, 'button', 'Done');
    expect(done).toBeTruthy();
    done.click();
    await settle();
    expect(ctx.send).toHaveBeenCalledTimes(1); // never a second task
    expect($('qa-title').value).toBe('');
  });
});

describe('"Describe it"', () => {
  const draft = { title: 'Send the site report', description: 'With the inspection photos.', dueDate: '2026-10-26', priority: 'HIGH', recurrence: { freq: 'WEEKLY', interval: 1, weekdays: [1] }, project: { id: 'p2', code: 'RIG1', number: '2026-014', name: 'Rig 1' } };

  it('suggests details to review; nothing changes until you choose, and your own title is not replaced unless you tick it', async () => {
    const ctx = makeCtx();
    ctx.api.ai.parseTask.mockResolvedValue(draft);
    const { root } = await open(ctx);
    type($('qa-title'), 'My own title');
    type($('qa-describe'), 'Send the RIG1 site report every Monday, high priority');
    byText(root, 'button', 'Fill task details').click();
    await settle();
    expect(ctx.api.ai.parseTask).toHaveBeenCalledWith('Send the RIG1 site report every Monday, high priority', expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/));
    const group = root.querySelector('[role="group"][aria-label="Suggested details"]');
    const box = (label) => [...group.querySelectorAll('input[type="checkbox"]')].find((b) => b.getAttribute('aria-label').startsWith(label));
    expect(box('Title').checked).toBe(false);
    expect(group.textContent).toContain('Replaces “My own title”');
    expect(box('Priority').checked).toBe(true);
    expect($('qa-title').value).toBe('My own title'); // nothing changed yet
    box('Due date').click(); // untick
    byText(group, 'button', 'Use selected details').click();
    await settle();
    expect($('qa-title').value).toBe('My own title');
    expect($('qa-priority').value).toBe('HIGH');
    expect($('qa-due').value).toBe('');
    expect($('qa-desc').value).toBe('With the inspection photos.');
    expect($('qa-project').value).toBe('p2'); // its columns and people follow
    expect(options($('qa-column'))).toEqual(['d1', 'd2']);
    expect(root.textContent).toContain('Repeats every week on Mon');
    expect(root.querySelector('[role="group"][aria-label="Suggested details"]')).toBeNull();
    byText(root, 'button', 'Create task').click();
    await settle();
    expect(ctx.send.mock.calls[0][1]).toMatchObject({ projectId: 'p2', priority: 'HIGH', recurrenceRule: draft.recurrence });
  });

  it('when AI isn’t set up, shows the server’s own message (as the web does)', async () => {
    const message = 'AI is not configured yet — an admin needs to add a provider and enable a chat model in AI Management.';
    const ctx = makeCtx();
    ctx.api.ai.parseTask.mockRejectedValue(new ApiError(400, message, 'VALIDATION_ERROR'));
    const { root } = await open(ctx);
    type($('qa-describe'), 'Anything');
    byText(root, 'button', 'Fill task details').click();
    await settle();
    expect(root.querySelector('.qa-describe [role="alert"]').textContent).toBe(message);
  });

  it('Ctrl+Enter in the description box reads it (and doesn’t create the task)', async () => {
    const ctx = makeCtx();
    ctx.api.ai.parseTask.mockResolvedValue({ title: 'X', dueDate: null, priority: null });
    const { root } = await open(ctx);
    type($('qa-describe'), 'Something');
    $('qa-describe').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true, cancelable: true }));
    await settle();
    expect(ctx.api.ai.parseTask).toHaveBeenCalledTimes(1);
    expect(ctx.send).not.toHaveBeenCalled();
    expect(root.querySelector('[role="group"][aria-label="Suggested details"]')).toBeTruthy();
  });
});

describe('"Add this page", the right-click menu and the unsent form', () => {
  it('puts the page’s title and address into the description', async () => {
    const ctx = makeCtx({ ctx: { currentPage: vi.fn(async () => ({ title: 'Pump P-12 datasheet', url: 'https://vendor.example/p12.pdf' })) } });
    const { root } = await open(ctx);
    type($('qa-desc'), 'Check the seals.');
    byText(root, 'button', 'Add this page').click();
    await settle();
    expect($('qa-desc').value).toBe('Check the seals.\n\nPump P-12 datasheet\nhttps://vendor.example/p12.pdf');
    expect(root.querySelector('.qa-live').textContent).toBe('Added this page to the description.');
  });

  it('a browser page can’t be added', async () => {
    const ctx = makeCtx({ ctx: { currentPage: vi.fn(async () => ({ title: 'Extensions', url: 'chrome://extensions' })) } });
    const { root } = await open(ctx);
    byText(root, 'button', 'Add this page').click();
    await settle();
    expect($('qa-desc').value).toBe('');
    expect(root.querySelector('.qa-live').textContent).toBe('This page can’t be added — only web pages (http or https) can.');
  });

  it('what the right-click menu captured fills the form', async () => {
    const capture = { title: 'Order spares', text: 'Order spares\nqty 4', link: '', page: { title: 'Stores', url: 'https://intranet.example/stores' } };
    await open(makeCtx({ ctx: { capture } }));
    expect($('qa-title').value).toBe('Order spares');
    expect($('qa-desc').value).toBe('Order spares\nqty 4\n\nStores\nhttps://intranet.example/stores');
  });

  it('keeps the unsent form when the popup closes, and brings it back — only for the same person', async () => {
    const first = makeCtx();
    const { root } = await open(first);
    type($('qa-title'), 'Half typed');
    choose($('qa-priority'), 'URGENT');
    await settle();
    expect(first.session.data[DRAFT_KEY]).toMatchObject({ userId: 'me', fields: { title: 'Half typed', priority: 'URGENT', projectId: 'p1' } });
    root.remove();
    await open(makeCtx({ session: first.session.data }));
    expect($('qa-title').value).toBe('Half typed');
    expect($('qa-priority').value).toBe('URGENT');
    byText(document.body, 'button', 'Clear').click();
    await settle();
    expect($('qa-title').value).toBe('');
    document.body.innerHTML = '';
    const someoneElse = makeCtx({ session: { [DRAFT_KEY]: { userId: 'other', fields: { title: 'Not yours' } } } });
    await open(someoneElse);
    expect($('qa-title').value).toBe('');
  });

  it('a form brought back says its attached files weren’t kept (M8)', async () => {
    const first = makeCtx();
    const { root } = await open(first);
    type($('qa-title'), 'With two photos');
    paste($('qa-title'), [new File(['a'], 'a.png', { type: 'image/png' }), new File(['b'], 'b.png', { type: 'image/png' })]);
    await settle();
    root.remove();
    const { root: again } = await open(makeCtx({ session: first.session.data }));
    expect($('qa-title').value).toBe('With two photos');
    expect(again.textContent).toContain('Your unsent task is back. Its 2 attached files weren’t kept — add them again.');
    expect(again.querySelector('.qa-files li')).toBeNull();
  });

  it('a form brought back takes off people who are no longer on its project’s team (M3)', async () => {
    const session = { [DRAFT_KEY]: { userId: 'me', fields: { title: 'Kept', projectId: 'p1', columnId: 'c1', assigneeIds: ['u2', 'u3'] }, placeChosen: true, names: { u3: 'Mariam Al Hinai' } } };
    const { root, ctx } = await open(makeCtx({ session }));
    expect(root.querySelector('[aria-label="Remove Omar Said"]')).toBeTruthy();
    expect(root.textContent).toContain('Mariam Al Hinai isn’t on Ops, so they were taken off this task.');
    byText(root, 'button', 'Create task').click();
    await settle();
    expect(ctx.send.mock.calls[0][1].assigneeIds).toEqual(['u2']);
  });
});

describe('in a window of its own (the right-click menu before Chrome 127)', () => {
  it('closes the window once the task is created; the toolbar popup stays open (M2)', async () => {
    const { root, ctx } = await open(makeCtx({ ctx: { inWindow: true } }));
    type($('qa-title'), 'From the window');
    byText(root, 'button', 'Create task').click();
    await settle();
    expect(ctx.send).toHaveBeenCalledTimes(1);
    expect(ctx.close).toHaveBeenCalledTimes(1);
    document.body.innerHTML = '';
    const popup = await open();
    type($('qa-title'), 'From the popup');
    byText(popup.root, 'button', 'Create task').click();
    await settle();
    expect(popup.ctx.close).not.toHaveBeenCalled();
  });

  it('a new right-click while it is open fills the form already there (M2)', async () => {
    let deliver = null;
    const ctx = makeCtx({ ctx: { inWindow: true, onCapture: (fn) => { deliver = fn; } } });
    await open(ctx);
    type($('qa-desc'), 'My notes');
    deliver({ title: 'Check the pump', text: 'Check the pump', link: '', page: { title: 'Spec', url: 'https://a.example/spec' } });
    await settle();
    expect($('qa-title').value).toBe('Check the pump');
    expect($('qa-desc').value).toBe('My notes\n\nSpec\nhttps://a.example/spec');
    expect(ctx.session.data[DRAFT_KEY].fields.title).toBe('Check the pump');
  });
});

describe('the popup’s frame', () => {
  it('"Open MICO360 Tasks" opens the full app and closes the popup', async () => {
    const { root, ctx } = await open();
    byText(root, 'button', 'Open MICO360 Tasks').click();
    await settle();
    expect(ctx.openApp).toHaveBeenCalledWith('');
    expect(ctx.close).toHaveBeenCalled();
    expect(root.textContent).toContain('Ctrl+Shift+K');
  });

  it('signed out: says to sign in, with the button that opens the app', async () => {
    const ctx = makeCtx();
    const view = SignedOutView(ctx, 'Your session has ended.');
    document.body.append(view);
    expect(view.textContent).toContain('Your session has ended.');
    byText(view, 'button', 'Open MICO360 Tasks').click();
    await settle();
    expect(ctx.openApp).toHaveBeenCalledWith('');
  });
});
