import { el, mount, Loader } from '../dom.js';
import { writeErrorMessage, SAVED_ON_DEVICE } from '../components.js';
import { getQueue } from '../../src/queue.js';
import { VERSIONED_KINDS, taskIdOf, isVersionConflict, createWriteLane, CONFLICT_MESSAGE } from '../../src/task-writes.js';
import { FieldsSection } from '../task/fields.js';
import { ChecklistSection } from '../task/checklist.js';
import { PeopleSection } from '../task/people.js';
import { TagsSection } from '../task/tags.js';
import { AttachmentsSection } from '../task/attachments.js';
import { CommentsSection } from '../task/comments.js';
import { ActivitySection } from '../task/activity.js';
import { DeleteSection } from '../task/delete-task.js';
import { HeaderActions } from '../task/header.js';
import { redrawKeepingFocus } from '../task/kit.js';

/**
 * Task detail drawer. The sections live in app/task/*.js; this file holds the task's state, loads
 * it, and gives the sections one way to save (`d.updateTask` for the task's own fields, `d.send` for
 * everything else), to report a problem (`d.fail`) and to say what happened (`d.announce`).
 *
 * Each edit of the task's fields is sent against the task's version, one at a time (H1): the server
 * refuses an edit made over someone else's change, and the drawer then says so and reloads. Every
 * change is sent now or kept on this device and synced later ("Saved on this device").
 *
 * It is a modal dialog (role="dialog", aria-modal, named after the task); the app shows it with
 * showModal (app/dialog.js): focus moves in and stays in, and Escape closes it. A section draws only
 * itself again, keeping focus on the same control (kit.js `redrawKeepingFocus`). The messages are
 * live regions that stay on the page (never display:none), so a screen reader hears each one.
 */
export function TaskDetail(ctx, onClose) {
  const taskId = ctx.params.taskId;

  // State — declared before load()/return (see the TDZ pitfall in the screen contract).
  // Read with the task, after it (see EXTRAS): undefined while loading, null when it can't be had.
  const s = {
    task: null,
    assignees: [],
    checklist: { items: [], done: 0, total: 0 },
    comments: [],
    directory: [],
    members: undefined,
    mentionable: undefined,
    tagCatalog: undefined,
    watching: undefined,
    watchers: undefined,
    attachments: undefined,
    activity: undefined,
  };
  let loads = 0;           // each load's number: answers to an earlier one are dropped
  let layered = null;      // a layer over the drawer (a picture's preview)
  let rereading = null;    // the timeline being read again after a change ('again' when another is due)
  let err = '';
  let notice = '';         // "Saved on this device" while this task has changes waiting to sync
  let hadQueued = false;   // this drawer showed or kept changes saved on this device
  let generation = 0;      // bumped when a refused edit reloads the task: edits made before it are dropped
  const lane = createWriteLane(); // one edit of this task at a time

  const titleEl = el('h2', {}, 'Task');
  const errRegion = el('div', { class: 'td-live', role: 'alert' });
  const noticeRegion = el('div', { class: 'td-live', role: 'status' });
  const announcer = el('div', { class: 'sr-only', role: 'status', 'aria-live': 'polite' });
  const content = el('div', { class: 'td-content' }, Loader());

  const d = {
    ctx, taskId, s,
    online: () => !ctx.isOnline || ctx.isOnline(),
    isAdmin: () => ((ctx.me && ctx.me.roles) || []).includes('ADMIN'),
    name: displayName,
    updateTask,
    send,
    changed,
    fail,
    clearError,
    announce,
    layer,
    close: onClose,
  };
  const header = HeaderActions(d);
  const fields = FieldsSection(d);
  const tags = TagsSection(d);
  const people = PeopleSection(d);
  const attachments = AttachmentsSection(d);
  const checklist = ChecklistSection(d);
  const comments = CommentsSection(d);
  const activity = ActivitySection(d);
  const footer = DeleteSection(d);
  const sections = [fields, tags, people, attachments, checklist, comments, activity];

  /**
   * The task's other details, read once it is shown — each on its own, so one that can't be had
   * (offline with no saved copy) leaves only its own part empty. `read(task)` returns the read (or
   * null when this server has none), `take` keeps its answer, `shows` are the parts drawn again.
   */
  const call = (fn, ...args) => (typeof fn === 'function' ? fn(...args) : null);
  const EXTRAS = [
    { read: (t) => (t.projectId ? call(ctx.api.projects && ctx.api.projects.members, t.projectId) : null), take: (v) => { s.members = list(v); }, shows: [people, footer] },
    { read: () => call(ctx.api.tasks.mentionable, taskId), take: (v) => { s.mentionable = list(v); }, shows: [people, comments] },
    { read: () => call(ctx.api.tags), take: (v) => { s.tagCatalog = list(v); }, shows: [tags] },
    { read: () => call(ctx.api.tasks.watch, taskId), take: (v) => { s.watching = v && typeof v.watching === 'boolean' ? v.watching : null; }, shows: [header] },
    { read: () => call(ctx.api.tasks.watchers, taskId), take: (v) => { s.watchers = list(v); }, shows: [header] },
    { read: () => call(ctx.api.tasks.attachments, taskId), take: (v) => { s.attachments = list(v); }, shows: [attachments] },
    { read: () => call(ctx.api.tasks.activity, taskId), take: (v) => { s.activity = list(v); }, shows: [activity] },
  ];
  const list = (v) => (Array.isArray(v) ? v : null);

  const panel = el('div', { class: 'drawer', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Task details', tabindex: '-1' },
    el('div', { class: 'drawer-head' }, titleEl, header.node, el('button', { class: 'iconbtn', type: 'button', 'aria-label': 'Close', title: 'Close (Esc)', onClick: onClose }, '✕')),
    el('div', { class: 'drawer-body' }, errRegion, noticeRegion, announcer, content),
    footer.node,
  );
  const root = el('div', {},
    el('div', { class: 'scrim', 'aria-hidden': 'true', onClick: onClose }),
    panel,
  );
  // A picture pasted anywhere in the open task is attached to it (text pasted into a box stays text).
  panel.addEventListener('paste', (e) => {
    if (s.task && !s.task.pendingDelete && !layered) attachments.onPaste(e);
  });

  load();
  return root;

  /** Load (or reload) the task. `message` is shown above it, e.g. why it was reloaded. */
  async function load(message) {
    const id = (loads += 1);
    mount(content, Loader());
    err = typeof message === 'string' ? message : '';
    renderMessages();
    try {
      const reads = await Promise.all([
        ctx.api.tasks.get(taskId),
        ctx.api.tasks.assignees(taskId),
        ctx.api.tasks.checklist(taskId),
        ctx.api.tasks.comments(taskId),
      ]);
      const [t, asg, chk, cm] = reads;
      s.task = t.data ?? null;
      s.assignees = asg.data ?? [];
      const c = chk.data ?? {};
      s.checklist = { items: c.items ?? [], done: c.done ?? 0, total: c.total ?? 0 };
      s.comments = cm.data ?? [];
      // Changes kept on this device are shown on top of the server's copy (H3): say so.
      const waiting = reads.reduce((n, r) => n + ((r && r.pending) || 0), 0);
      if (waiting) hadQueued = true;
      notice = waiting ? SAVED_ON_DEVICE : '';
      try { s.directory = (await ctx.api.directory()).data ?? []; } catch { s.directory = []; }
      if (id !== loads) return;
      renderAll();
      if (s.task && !s.task.pendingDelete) loadExtras(id);
    } catch (e) {
      if (id !== loads) return;
      err = writeErrorMessage(e, 'Could not load this task.');
      renderMessages();
      mount(content, el('div', { class: 'state' }, el('button', { class: 'btn sm', type: 'button', onClick: () => load() }, 'Retry')));
    }
  }

  function loadExtras(id) {
    const task = s.task;
    for (const extra of EXTRAS) {
      let reading;
      try {
        reading = extra.read(task);
      } catch {
        reading = null;
      }
      Promise.resolve(reading).then((r) => {
        if (id !== loads) return;
        extra.take(r ? r.data : null);
        if (r && r.pending) {
          hadQueued = true;
          notice = SAVED_ON_DEVICE;
          renderMessages();
        }
      }, () => {
        if (id === loads) extra.take(null);
      }).then(() => {
        if (id === loads) for (const x of extra.shows) x.render();
      });
    }
  }

  function renderAll() {
    if (!s.task) return;
    renderHead();
    if (s.task.pendingDelete) {
      // Deleted on this device and not synced yet: there is nothing left to change.
      notice = 'You deleted this task on this device. It will be removed when the connection is back.';
      renderMessages();
      mount(header.node);
      mount(content);
      footer.render();
      return;
    }
    renderMessages();
    header.render();
    mount(content, sections.map((x) => x.node));
    for (const x of sections) x.render();
    footer.render();
  }

  function renderHead() {
    const t = s.task;
    titleEl.textContent = t.key || 'Task';
    panel.setAttribute('aria-label', `Task ${t.key ? `${t.key}: ` : ''}${t.title || ''}`.trim());
  }

  function renderMessages() {
    redrawKeepingFocus(errRegion, () => mount(errRegion, err ? el('div', { class: 'errbar' }, el('span', {}, err)) : null));
    mount(noticeRegion, notice ? el('div', { class: 'infobar' }, notice) : null);
  }

  // ---- What sections use ------------------------------------------------------------------

  /** A problem to show (the server's own words for a 4xx answer, H2), or `fallback`. */
  function fail(e, fallback) {
    err = writeErrorMessage(e, fallback);
    renderMessages();
  }

  function clearError() {
    if (!err) return;
    err = '';
    renderMessages();
  }

  /** Said to screen readers only (what a click did), e.g. "Attached site.png." */
  function announce(text) {
    announcer.textContent = '';
    announcer.textContent = text;
  }

  /** A change kept on this device: say so until it has synced. */
  function noteSaved(r) {
    if (r && r.queued) {
      hadQueued = true;
      notice = SAVED_ON_DEVICE;
      renderMessages();
    }
  }

  /**
   * Send a change now, or keep it on this device (ctx.write). Resolves the write's result; rejects
   * when it can't be saved at all (the section rolls its change back and calls `fail`).
   */
  async function send(kind, payload) {
    const r = await ctx.write(kind, payload);
    noteSaved(r);
    changed(r);
    return r;
  }

  /**
   * Something about the task changed (a write, a file attached): the app's counts follow, and — when
   * it reached the server — the timeline is read again, so the change shows in it.
   */
  function changed(r) {
    ctx.afterMutation();
    if (!r || !r.queued) rereadActivity();
  }

  /** Read the timeline again (one read at a time; a change made meanwhile reads it once more). */
  async function rereadActivity() {
    if (typeof ctx.api.tasks.activity !== 'function' || !s.task || s.task.pendingDelete) return;
    if (rereading) {
      rereading = 'again';
      return;
    }
    const id = loads;
    rereading = 'reading';
    try {
      const r = await ctx.api.tasks.activity(taskId);
      if (id === loads) {
        s.activity = list(r && r.data);
        activity.render();
      }
    } catch {
      /* offline: the timeline shows what it had */
    }
    const again = rereading === 'again';
    rereading = null;
    if (again) rereadActivity();
  }

  /**
   * Show `node` over the drawer (a picture's preview): the drawer's own parts can't be reached
   * (inert) until `release()`, so Tab and screen readers stay in it — and it stays inside the dialog.
   */
  function layer(node) {
    const under = [...panel.children];
    for (const n of under) n.setAttribute('inert', '');
    panel.append(node);
    layered = node;
    return function release() {
      node.remove();
      for (const n of under) n.removeAttribute('inert');
      if (layered === node) layered = null;
    };
  }

  /** "First Last" for a person: you, someone in the people directory, else what the row itself says. */
  function displayName(userId, row) {
    if (userId === ctx.me.id && ctx.me.name) return ctx.me.name;
    const u = s.directory.find((x) => x.id === userId) || row;
    if (!u) return 'Someone';
    return `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim() || u.name || u.username || u.email || 'Someone';
  }

  // ---- The task's own fields (H1) ---------------------------------------------------------

  /**
   * Show an edit at once, then send it after this task's earlier edits have been answered (H1).
   * `scope: 'series'` sends it for every open copy of a repeating series (the server copies the
   * title, description and priority to them).
   */
  function updateTask(patch, { scope } = {}) {
    const task = s.task;
    const before = Object.fromEntries(Object.keys(patch).map((k) => [k, task[k]]));
    Object.assign(task, patch);
    clearError();
    showEdit(patch);
    const made = generation;
    const sent = scope === 'series' ? { ...patch, scope } : patch;
    return lane.run(() => saveEdit(sent, before, made));
  }

  function showEdit(patch) {
    if ('title' in patch) renderHead();
    fields.renderFor(patch);
  }

  async function saveEdit(patch, before, made) {
    if (made !== generation) return; // made on a copy that a refused edit has since replaced
    try {
      const expectedVersion = await nextVersion();
      const r = await ctx.write('task.update', { id: taskId, patch, ...(typeof expectedVersion === 'number' ? { expectedVersion } : {}) });
      noteSaved(r);
      // The next edit is made against the version this one made.
      if (!r.queued && r.data && typeof r.data.version === 'number') s.task.version = r.data.version;
      changed(r);
    } catch (e) {
      if (isVersionConflict(e)) {
        // Someone else changed the task: say so, show their version, and drop this edit.
        generation += 1;
        await load(CONFLICT_MESSAGE);
        ctx.afterMutation();
        return;
      }
      Object.assign(s.task, before);
      fail(e, 'Could not save your change.');
      showEdit(before);
      ctx.afterMutation();
    }
  }

  /**
   * The version an edit is made against (H1): the one shown — or, once the changes this drawer kept on
   * this device have synced, the version they made (the sync keeps it in the task's offline copy).
   */
  async function nextVersion() {
    let v = s.task.version;
    if (!hadQueued || !ctx.storage || !ctx.cache) return v;
    try {
      const mine = (await getQueue(ctx.storage)).filter((i) => i.userId === ctx.me.id && VERSIONED_KINDS.has(i.kind) && taskIdOf(i) === taskId);
      // Still waiting: this edit goes in line behind them (they carry the versions). One refused: the server decides.
      if (mine.length) return v;
      const saved = await ctx.cache.peek(`task:${taskId}`);
      if (saved && typeof saved.version === 'number' && !(typeof v === 'number' && v >= saved.version)) v = saved.version;
    } catch {
      return v;
    }
    s.task.version = v;
    return v;
  }
}
