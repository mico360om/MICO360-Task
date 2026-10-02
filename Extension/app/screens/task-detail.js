import { el, mount, Loader, ErrorState, timeAgo, pill } from '../dom.js';
import { PRIORITY_LABEL, writeErrorMessage } from '../components.js';
import { dueDayKey, todayKey } from '../../src/due-date.js';
import { DEFAULT_TIME_ZONE } from '../../src/config.js';
import { taskExportPath, taskFileName } from '../../src/reports.js';
import {
  FREQS, FREQ_LABEL, UNIT_LABEL, DAY_NAMES, WEEKDAY_NAMES, WEEK_OF_MONTH, recurrenceSummary, withFreq, withInterval,
  toggleWeekday, withMonthlyMode, withNth, withDayOfMonth, withEnds, endsMode, withCreateNext, togglePaused, isEarlierCopy,
} from '../../src/recurrence.js';

const PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'URGENT'];

/** Task detail drawer — edit title/description/priority, due date and repeat, checklist, assignees and comments (offline-queued). */
export function TaskDetail(ctx, onClose) {
  const taskId = ctx.params.taskId;

  // State — declared before load()/return (see the TDZ pitfall in the screen contract).
  let task = null;
  let assignees = [];
  let checklist = { items: [], done: 0, total: 0 };
  let comments = [];
  let directory = [];
  let err = '';
  let exporting = null;

  const titleEl = el('h2', {}, 'Task');
  const exportBox = el('div', { class: 'export-box' });
  const body = el('div', { class: 'drawer-body' }, Loader());
  const root = el('div', {},
    el('div', { class: 'scrim', onClick: onClose }),
    el('div', { class: 'drawer' },
      el('div', { class: 'drawer-head' }, titleEl, exportBox, el('button', { class: 'iconbtn', 'aria-label': 'Close', onClick: onClose }, '✕')),
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
    renderExport();
    mount(body,
      err ? el('div', { class: 'errbar', role: 'alert' }, el('span', {}, err)) : null,
      titleField(),
      prioritySection(),
      scheduleSection(),
      descriptionSection(),
      checklistSection(),
      assigneesSection(),
      commentsSection(),
    );
  }

  // ---- Export (Excel / PDF) ---------------------------------------------
  function renderExport() {
    mount(exportBox, [['xlsx', 'Excel'], ['pdf', 'PDF']].map(([format, label]) => el('button', {
      class: 'btn sm', type: 'button', 'aria-label': `Export task as ${label}`, title: `Download this task as ${label}`,
      disabled: exporting !== null, onClick: () => exportTask(format),
    }, exporting === format ? '…' : `⬇ ${label}`)));
  }

  async function exportTask(format) {
    if (ctx.isOnline && !ctx.isOnline()) {
      err = 'Exports need a connection — you appear to be offline.';
      renderBody();
      return;
    }
    exporting = format;
    err = '';
    renderExport();
    try {
      const { blob, fileName } = await ctx.api.download(taskExportPath(taskId, format));
      ctx.saveFile(blob, fileName || taskFileName(task, format));
    } catch {
      err = 'Couldn’t export the task. Please try again.';
    } finally {
      exporting = null;
      renderBody();
    }
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

  // ---- Due date + repeat -------------------------------------------------
  function scheduleSection() {
    const timeZone = ctx.timeZone || DEFAULT_TIME_ZONE;
    const dueKey = dueDayKey(task.dueDate, timeZone) || '';
    const due = el('input', { class: 'field', type: 'date', value: dueKey, 'aria-label': 'Due date', style: { maxWidth: '190px' } });
    due.addEventListener('change', () => { if (due.value !== dueKey) updateTask({ dueDate: due.value || null }); });
    return el('div', {},
      section('Due date', due),
      section('Repeat', repeatEditor(dueKey || todayKey(timeZone))),
    );
  }

  /** The repeat rule editor; each change is saved (or queued) like any other edit. */
  function repeatEditor(dueKey) {
    const rule = task.recurrenceRule || null;
    if (isEarlierCopy(task)) {
      // Repeating an earlier copy would start a second, parallel series.
      return el('div', { class: 'muted', style: { fontSize: '13px' } }, '🔁 An earlier copy of a repeating series — change the repeat on its newest copy.');
    }
    const setRule = (next) => updateTask({ recurrenceRule: next });
    const rows = [row(select('Repeat', [['NONE', 'Does not repeat'], ...FREQS.map((f) => [f, FREQ_LABEL[f]])], rule ? rule.freq : 'NONE', (v) => setRule(withFreq(rule, v))))];
    if (!rule) return el('div', {}, rows);

    rows.unshift(el('div', { style: { fontSize: '13px', fontWeight: '600', color: 'var(--brand)', marginBottom: '6px' } }, `🔁 ${recurrenceSummary(rule)}`));
    const every = el('input', { class: 'field', type: 'number', min: '1', value: String(rule.interval), 'aria-label': 'Repeat every', style: { width: '76px' } });
    every.addEventListener('change', () => setRule(withInterval(rule, every.value)));
    rows.push(row(el('span', { class: 'muted' }, 'Every'), every, el('span', { class: 'muted' }, UNIT_LABEL[rule.freq])));

    if (rule.freq === 'WEEKLY') {
      rows.push(row(DAY_NAMES.map((name, day) => {
        const on = (rule.weekdays || []).includes(day);
        return el('button', { class: `chip${on ? ' on' : ''}`, type: 'button', 'aria-label': name, 'aria-pressed': String(on), onClick: () => setRule(toggleWeekday(rule, day)) }, name);
      })));
    }
    if (rule.freq === 'MONTHLY' || rule.freq === 'QUARTERLY') {
      const mode = rule.nthWeekday ? 'WEEKDAY' : 'DATE';
      const parts = [
        el('span', { class: 'muted' }, 'On'),
        select(rule.freq === 'MONTHLY' ? 'Monthly on' : 'Quarterly on', [['DATE', 'a day of the month'], ['WEEKDAY', 'a weekday of the month']], mode, (v) => setRule(withMonthlyMode(rule, v, dueKey))),
      ];
      if (mode === 'DATE') {
        const day = el('input', { class: 'field', type: 'number', min: '1', max: '31', value: rule.dayOfMonth ? String(rule.dayOfMonth) : '', placeholder: 'due day', title: '31 means the last day of every month', 'aria-label': 'Day of month', style: { width: '86px' } });
        day.addEventListener('change', () => setRule(withDayOfMonth(rule, day.value)));
        parts.push(day);
      } else {
        parts.push(
          el('span', { class: 'muted' }, 'the'),
          select('Week of the month', WEEK_OF_MONTH.map((w) => [String(w.week), w.label]), String(rule.nthWeekday.week), (v) => setRule(withNth(rule, { week: Number(v) }))),
          select('Weekday', WEEKDAY_NAMES.map((n, d) => [String(d), n]), String(rule.nthWeekday.day), (v) => setRule(withNth(rule, { day: Number(v) }))),
        );
      }
      rows.push(row(parts));
    }

    const ends = endsMode(rule);
    const endParts = [el('span', { class: 'muted' }, 'Ends'), select('Ends', [['NEVER', 'Never'], ['COUNT', 'After a number of copies'], ['UNTIL', 'On a date']], ends, (v) => setRule(withEnds(rule, v, dueKey)))];
    if (ends === 'COUNT') {
      const count = el('input', { class: 'field', type: 'number', min: '1', value: String(rule.count), 'aria-label': 'Number of occurrences', style: { width: '76px' } });
      count.addEventListener('change', () => { const n = Number(count.value); setRule({ ...rule, count: Number.isInteger(n) && n >= 1 ? n : 1, until: null }); });
      endParts.push(count);
    } else if (ends === 'UNTIL') {
      const until = el('input', { class: 'field', type: 'date', value: String(rule.until).slice(0, 10), 'aria-label': 'End date', style: { maxWidth: '190px' } });
      until.addEventListener('change', () => { if (until.value) setRule({ ...rule, until: until.value, count: null }); });
      endParts.push(until);
    }
    rows.push(row(endParts));
    rows.push(row(
      el('span', { class: 'muted' }, 'Create the next copy'),
      select('Create the next copy', [['ON_COMPLETE', 'when this one is done'], ['ON_SCHEDULE', 'on each date, even if not done']], rule.createNext || 'ON_COMPLETE', (v) => setRule(withCreateNext(rule, v))),
    ));
    rows.push(row(el('button', { class: 'btn sm', type: 'button', onClick: () => setRule(togglePaused(rule)) }, rule.paused ? '▶ Resume series' : '⏸ Pause series')));
    return el('div', {}, rows);
  }

  function select(label, options, value, onPick) {
    const node = el('select', { class: 'field', 'aria-label': label, style: { width: 'auto' } },
      options.map(([v, text]) => el('option', { value: v }, text)));
    node.value = value;
    node.addEventListener('change', () => onPick(node.value));
    return node;
  }

  function row(...children) {
    return el('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginTop: '8px' } }, ...children);
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
  // Each change is sent now, or saved on this device and synced later (ctx.write). A change that
  // can't even be saved locally shows an error and is rolled back — never silently lost.
  async function updateTask(patch) {
    const before = Object.fromEntries(Object.keys(patch).map((k) => [k, task[k]]));
    Object.assign(task, patch);
    err = '';
    try {
      await ctx.write('task.update', { id: taskId, patch });
    } catch (e) {
      Object.assign(task, before);
      err = writeErrorMessage(e, 'Could not save your change.');
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
      await ctx.write('checklist.update', { itemId: item.id, patch: { done } });
    } catch (e) {
      item.done = !done;
      checklist.done = checklist.items.filter((i) => i.done).length;
      err = writeErrorMessage(e, 'Could not update the checklist.');
      renderBody();
    } finally {
      ctx.afterMutation();
    }
  }

  async function addChecklistItem(text) {
    err = '';
    try {
      const r = await ctx.write('checklist.add', { id: taskId, text });
      checklist.items.push(!r.queued && r.data && r.data.id ? r.data : { id: `tmp-${Date.now()}`, text, done: false });
    } catch (e) {
      err = writeErrorMessage(e, 'Could not add the item.');
    } finally {
      checklist.total = checklist.items.length;
      checklist.done = checklist.items.filter((i) => i.done).length;
      renderBody();
      ctx.afterMutation();
    }
  }

  async function toggleAssignMe(mine) {
    err = '';
    const before = assignees;
    assignees = mine
      ? assignees.filter((a) => a.id !== ctx.me.id)
      : [...assignees, { id: ctx.me.id, name: ctx.me.name, email: ctx.me.email }];
    renderBody();
    try {
      if (mine) await ctx.write('task.unassign', { id: taskId, userId: ctx.me.id });
      else await ctx.write('task.assign', { id: taskId, userIds: [ctx.me.id] });
    } catch (e) {
      assignees = before;
      err = writeErrorMessage(e, mine ? 'Could not unassign you.' : 'Could not assign you.');
      renderBody();
    } finally {
      ctx.afterMutation();
    }
  }

  async function addComment(bodyText) {
    err = '';
    const optimistic = { id: `tmp-${Date.now()}`, userId: ctx.me.id, body: bodyText, createdAt: new Date().toISOString() };
    comments = [...comments, optimistic];
    renderBody();
    try {
      await ctx.write('comment.add', { id: taskId, body: bodyText });
    } catch (e) {
      comments = comments.filter((c) => c !== optimistic);
      err = writeErrorMessage(e, 'Could not post your comment.');
      renderBody();
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
