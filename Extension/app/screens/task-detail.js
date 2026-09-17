import { el, mount, Loader, ErrorState, timeAgo, pill } from '../dom.js';
import { PRIORITY_LABEL } from '../components.js';

const PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'URGENT'];

/** Task detail drawer — edit title/description/priority, checklist, assignees and comments (offline-queued). */
export function TaskDetail(ctx, onClose) {
  const taskId = ctx.params.taskId;

  // State — declared before load()/return (see the TDZ pitfall in the screen contract).
  let task = null;
  let assignees = [];
  let checklist = { items: [], done: 0, total: 0 };
  let comments = [];
  let directory = [];
  let err = '';

  const titleEl = el('h2', {}, 'Task');
  const body = el('div', { class: 'drawer-body' }, Loader());
  const root = el('div', {},
    el('div', { class: 'scrim', onClick: onClose }),
    el('div', { class: 'drawer' },
      el('div', { class: 'drawer-head' }, titleEl, el('button', { class: 'iconbtn', 'aria-label': 'Close', onClick: onClose }, '✕')),
      body,
    ),
  );

  load();
  return root;

  async function load() {
    mount(body, Loader());
    err = '';
    try {
      const [t, asg, chk, cm] = await Promise.all([
        ctx.api.tasks.get(taskId),
        ctx.api.tasks.assignees(taskId),
        ctx.api.tasks.checklist(taskId),
        ctx.api.tasks.comments(taskId),
      ]);
      task = t.data ?? null;
      assignees = asg.data ?? [];
      const c = chk.data ?? {};
      checklist = { items: c.items ?? [], done: c.done ?? 0, total: c.total ?? 0 };
      comments = cm.data ?? [];
      try { directory = (await ctx.api.directory()).data ?? []; } catch { directory = []; }
      renderBody();
    } catch {
      mount(body, ErrorState('Could not load this task.', load));
    }
  }

  function renderBody() {
    if (!task) return;
    titleEl.textContent = task.key || 'Task';
    mount(body,
      err ? el('div', { class: 'errbar', role: 'alert' }, el('span', {}, err)) : null,
      titleField(),
      prioritySection(),
      descriptionSection(),
      checklistSection(),
      assigneesSection(),
      commentsSection(),
    );
  }

  // ---- Title -------------------------------------------------------------
  function titleField() {
    const input = el('input', { class: 'field', value: task.title || '', 'aria-label': 'Task title', style: { fontWeight: '700', fontSize: '15px' } });
    input.addEventListener('blur', () => {
      const v = input.value.trim();
      if (v && v !== task.title) updateTask({ title: v });
    });
    return el('div', {},
      el('label', { class: 'lbl' }, task.key || 'Task'),
      input,
    );
  }

  // ---- Priority ----------------------------------------------------------
  function prioritySection() {
    return section('Priority',
      el('div', { class: 'toolbar', style: { margin: 0 } },
        PRIORITIES.map((p) => el('button', {
          class: `chip${task.priority === p ? ' on' : ''}`, type: 'button',
          onClick: () => { if (task.priority !== p) updateTask({ priority: p }); },
        }, PRIORITY_LABEL[p])),
      ),
    );
  }

  // ---- Description -------------------------------------------------------
  function descriptionSection() {
    const ta = el('textarea', { class: 'field', rows: '3', placeholder: 'Add a description…', 'aria-label': 'Description' });
    ta.value = task.description || '';
    ta.addEventListener('blur', () => {
      const v = ta.value.trim();
      if (v !== (task.description || '')) updateTask({ description: v });
    });
    return section('Description', ta);
  }

  // ---- Checklist ---------------------------------------------------------
  function checklistSection() {
    const rows = checklist.items.map((item) => {
      const cb = el('input', { type: 'checkbox', 'aria-label': item.text });
      cb.checked = !!item.done;
      cb.addEventListener('change', () => toggleChecklist(item, cb.checked));
      return el('label', { style: { display: 'flex', alignItems: 'center', gap: '9px', padding: '4px 0', cursor: 'pointer' } },
        cb,
        el('span', { style: item.done ? { textDecoration: 'line-through', color: 'var(--ink2)' } : {} }, item.text),
      );
    });

    const add = el('input', { class: 'field', placeholder: 'Add checklist item…', 'aria-label': 'New checklist item' });
    const submit = () => { const v = add.value.trim(); if (v) { add.value = ''; addChecklistItem(v); } };
    add.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });

    return section(`Checklist (${checklist.done}/${checklist.total})`,
      rows.length ? el('div', {}, rows) : el('div', { class: 'muted', style: { fontSize: '13px' } }, 'No checklist items yet.'),
      el('div', { style: { display: 'flex', gap: '8px', marginTop: '8px' } }, add, el('button', { class: 'btn sm', onClick: submit }, 'Add')),
    );
  }

  // ---- Assignees ---------------------------------------------------------
  function assigneesSection() {
    const mine = assignees.some((a) => a.id === ctx.me.id);
    const names = assignees.length
      ? el('div', { class: 'toolbar', style: { margin: '0 0 8px' } }, assignees.map((a) => pill(displayName(a), 'NORMAL')))
      : el('div', { class: 'muted', style: { fontSize: '13px', marginBottom: '8px' } }, 'No one assigned yet.');
    return section('Assignees',
      names,
      el('button', { class: `btn sm${mine ? '' : ' primary'}`, onClick: () => toggleAssignMe(mine) }, mine ? 'Unassign me' : 'Assign me'),
    );
  }

  // ---- Comments ----------------------------------------------------------
  function commentsSection() {
    const list = comments.length
      ? el('div', { class: 'thread' }, comments.map((c) => el('div', { class: 'msg' },
          el('div', { class: 'mh' }, el('span', { class: 'author' }, displayNameById(c.userId)), el('span', { class: 'time' }, timeAgo(c.createdAt))),
          el('div', { class: 'txt' }, c.body || ''),
        )))
      : el('div', { class: 'muted', style: { fontSize: '13px' } }, 'No comments yet.');

    const ta = el('textarea', { class: 'field', rows: '2', placeholder: 'Write a comment…', 'aria-label': 'New comment' });
    const post = () => { const v = ta.value.trim(); if (v) { ta.value = ''; addComment(v); } };
    return section('Comments',
      list,
      el('div', { class: 'composer', style: { position: 'static', background: 'transparent', borderTop: 'none', paddingTop: '10px' } },
        ta,
        el('button', { class: 'btn primary sm', onClick: post }, 'Post'),
      ),
    );
  }

  // ---- Mutations ---------------------------------------------------------
  async function updateTask(patch) {
    Object.assign(task, patch);
    err = '';
    try {
      await ctx.api.tasks.update(taskId, patch);
    } catch (e) {
      if (e && e.name === 'ApiError') err = 'Could not save your change.';
      else await ctx.enqueue('task.update', { id: taskId, patch });
    } finally {
      renderBody();
      ctx.afterMutation();
    }
  }

  async function toggleChecklist(item, done) {
    item.done = done;
    checklist.done = checklist.items.filter((i) => i.done).length;
    err = '';
    renderBody();
    try {
      await ctx.api.tasks.updateChecklistItem(item.id, { done });
    } catch (e) {
      if (e && e.name === 'ApiError') { err = 'Could not update the checklist.'; renderBody(); }
      else await ctx.enqueue('checklist.update', { itemId: item.id, patch: { done } });
    } finally {
      ctx.afterMutation();
    }
  }

  async function addChecklistItem(text) {
    err = '';
    try {
      const created = await ctx.api.tasks.addChecklistItem(taskId, text);
      checklist.items.push(created && created.id ? created : { id: `tmp-${Date.now()}`, text, done: false });
    } catch (e) {
      if (e && e.name === 'ApiError') { err = 'Could not add the item.'; }
      else { await ctx.enqueue('checklist.add', { id: taskId, text }); checklist.items.push({ id: `tmp-${Date.now()}`, text, done: false }); }
    } finally {
      checklist.total = checklist.items.length;
      checklist.done = checklist.items.filter((i) => i.done).length;
      renderBody();
      ctx.afterMutation();
    }
  }

  async function toggleAssignMe(mine) {
    err = '';
    if (mine) {
      assignees = assignees.filter((a) => a.id !== ctx.me.id);
      renderBody();
      try {
        await ctx.api.tasks.unassign(taskId, ctx.me.id);
      } catch (e) {
        if (e && e.name === 'ApiError') { err = 'Could not unassign you.'; renderBody(); }
        else await ctx.enqueue('task.unassign', { id: taskId, userId: ctx.me.id });
      } finally {
        ctx.afterMutation();
      }
    } else {
      assignees = [...assignees, { id: ctx.me.id, name: ctx.me.name, email: ctx.me.email }];
      renderBody();
      try {
        await ctx.api.tasks.assign(taskId, [ctx.me.id]);
      } catch (e) {
        if (e && e.name === 'ApiError') { err = 'Could not assign you.'; renderBody(); }
        else await ctx.enqueue('task.assign', { id: taskId, userIds: [ctx.me.id] });
      } finally {
        ctx.afterMutation();
      }
    }
  }

  async function addComment(bodyText) {
    err = '';
    comments = [...comments, { id: `tmp-${Date.now()}`, userId: ctx.me.id, body: bodyText, createdAt: new Date().toISOString() }];
    renderBody();
    try {
      await ctx.api.tasks.addComment(taskId, bodyText);
    } catch (e) {
      if (e && e.name === 'ApiError') { err = 'Could not post your comment.'; renderBody(); }
      else await ctx.enqueue('comment.add', { id: taskId, body: bodyText });
    } finally {
      ctx.afterMutation();
    }
  }

  // ---- Helpers -----------------------------------------------------------
  function section(title, ...children) {
    return el('div', {}, el('div', { class: 'section-title' }, title), ...children);
  }
  function displayName(u) {
    if (!u) return 'Someone';
    if (u.id === ctx.me.id && ctx.me.name) return ctx.me.name;
    return `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim() || u.name || u.username || u.email || 'Someone';
  }
  function displayNameById(uid) {
    if (uid === ctx.me.id && ctx.me.name) return ctx.me.name;
    return displayName(directory.find((d) => d.id === uid));
  }
}
