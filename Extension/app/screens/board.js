import { el, mount, Loader, ErrorState, Empty, pill } from '../dom.js';
import { PRIORITY_LABEL, catVar, writeErrorMessage, SAVED_ON_DEVICE } from '../components.js';
import { href } from '../../src/router.js';
import { todayKey, shiftDayKey, isDayKey, formatDayKey, relativeDayHint } from '../../src/due-date.js';
import { isRecurring } from '../../src/recurrence.js';
import { isTempId, tempId } from '../../src/pending-overlay.js';
import { menuButton } from '../menu.js';

/** What the board keeps from a move's reply: the task's new version and the status the server set. */
const MOVE_REPLY_FIELDS = ['version', 'columnId', 'columnCategory', 'completedAt', 'progress', 'columnHidden'];

/**
 * Kanban board for one project and ONE board day (EXT-03) — like the web and mobile boards, each day
 * has its own board. The day comes from `?date=YYYY-MM-DD` (default: today in the company time
 * zone). Columns of draggable task cards; moves and new tasks persist (offline-queued).
 *
 * From the keyboard: a card is a button (Enter or Space opens it), and its "Move to…" menu moves it
 * to another column; focus then follows the card and a screen reader hears where it went.
 */
export function BoardScreen(ctx) {
  const projectId = ctx.params.projectId;
  const view = el('div');
  const live = el('div', { class: 'sr-only', role: 'status', 'aria-live': 'polite' });
  const root = el('div', {}, view, live);

  // State — declared before load()/return (see the TDZ pitfall in the screen contract).
  const today = todayKey(ctx.timeZone);
  const boardDate = isDayKey(ctx.query.date) ? ctx.query.date : today;
  let project = null;
  let columns = [];
  let tasks = [];
  let progress = null;
  let stale = false;
  let err = '';
  let note = '';
  let draggingId = null;
  let focusTaskId = null; // the card to focus after the next render (moved from the keyboard)

  if (!projectId) {
    mount(view, Empty('Pick a project', 'Open a project to see its board.'),
      el('div', { style: { textAlign: 'center', marginTop: '-14px' } },
        el('button', { class: 'btn sm', onClick: () => ctx.navigate('#/projects') }, 'Browse projects')));
    return root;
  }

  load();
  return root;

  async function load() {
    const kept = focusedCard();
    if (kept && !focusTaskId) focusTaskId = kept.id; // a reload (e.g. a repeat's next copy) keeps focus on the card
    mount(view, Loader());
    err = '';
    try {
      const [p, cols, tks, prog] = await Promise.all([
        ctx.api.projects.get(projectId),
        ctx.api.projects.columns(projectId),
        ctx.api.tasks.list({ projectId, boardDate }),
        ctx.api.projects.progress(projectId),
      ]);
      project = p.data ?? null;
      columns = (cols.data ?? []).filter((c) => c.enabled).sort((a, b) => a.position - b.position);
      // M10: a task in a column switched off in Manage columns isn't on the board (as on the web).
      tasks = (tks.data ?? []).filter((t) => t.columnHidden !== true);
      progress = prog.data ?? null;
      stale = p.stale || cols.stale || tks.stale || prog.stale;
      // Moves and new tasks kept on this device are shown where they were put (H3): say so.
      note = tks.pending ? SAVED_ON_DEVICE : '';
      render();
    } catch (e) {
      mount(view, header(), ErrorState(writeErrorMessage(e, 'Could not load this board.'), () => load()));
    }
  }

  function goToDay(key) {
    ctx.navigate(href(`/board/${projectId}`, key && key !== today ? { date: key } : undefined));
  }

  function render() {
    if (columns.length === 0) {
      mount(view, header(), Empty('No columns', 'This project has no board columns yet.'));
      return;
    }
    const kept = focusedCard();
    mount(view,
      header(),
      stale ? el('div', { class: 'errbar', style: { background: 'var(--warning-soft)', color: 'var(--warning)', borderColor: 'transparent' } }, 'Showing saved data — you appear to be offline.') : null,
      err ? el('div', { class: 'errbar', role: 'alert' }, el('span', {}, err)) : null,
      note ? el('div', { class: 'infobar', role: 'status' }, note) : null,
      el('div', { class: 'board' }, columns.map(column)),
    );
    // Redrawing replaces every card: keep keyboard focus on the same one (or the one just moved).
    const want = focusTaskId ? { id: focusTaskId, part: 'card' } : kept;
    focusTaskId = null;
    const free = !document.activeElement || document.activeElement === document.body;
    if (want && free) {
      const wrap = [...view.querySelectorAll('.tcard-wrap')].find((w) => w.querySelector('.tcard')?.dataset.taskId === want.id);
      const target = wrap && (want.part === 'move' ? wrap.querySelector('.tcard-move') : wrap.querySelector('.tcard'));
      if (target) target.focus();
    }
  }

  /** The card (or its "Move to…" button) that has keyboard focus, to find again after a redraw. */
  function focusedCard() {
    const a = document.activeElement;
    const wrap = a && view.contains(a) ? a.closest('.tcard-wrap') : null;
    const id = wrap && wrap.querySelector('.tcard')?.dataset.taskId;
    return id ? { id, part: a.classList.contains('tcard-move') ? 'move' : 'card' } : null;
  }

  function dayNav() {
    const hint = relativeDayHint(boardDate, today);
    const picker = el('input', { class: 'field', type: 'date', value: boardDate, 'aria-label': 'Board day' });
    picker.addEventListener('change', () => { if (isDayKey(picker.value)) goToDay(picker.value); });
    return el('div', { class: 'daynav' },
      el('button', { class: 'btn sm', type: 'button', 'aria-label': 'Previous day', onClick: () => goToDay(shiftDayKey(boardDate, -1)) }, '‹'),
      el('span', { class: 'day' }, formatDayKey(boardDate, { year: true })),
      hint ? el('span', { class: 'hint' }, hint) : null,
      el('button', { class: 'btn sm', type: 'button', 'aria-label': 'Next day', onClick: () => goToDay(shiftDayKey(boardDate, 1)) }, '›'),
      boardDate !== today ? el('button', { class: 'btn sm ghost', type: 'button', onClick: () => goToDay(today) }, 'Today') : null,
      picker,
    );
  }

  function header() {
    const title = project ? (project.name || project.code || 'Board') : 'Board';
    const bar = progress
      ? el('div', { style: { marginTop: '10px' } },
          el('div', { class: 'progress-track' }, el('div', { class: 'progress-fill', style: { width: `${progress.completionPct ?? 0}%` } })),
          el('div', { class: 'muted', style: { fontSize: '12px', marginTop: '6px', display: 'flex', gap: '12px', flexWrap: 'wrap' } },
            el('span', {}, `${progress.completionPct ?? 0}% complete`),
            el('span', {}, `${progress.completed ?? 0}/${progress.total ?? 0} done`),
            (progress.overdue ? el('span', { style: { color: 'var(--danger)', fontWeight: '700' } }, `${progress.overdue} overdue`) : null),
          ))
      : null;
    return el('div', { class: 'card', style: { marginBottom: '16px' } },
      el('div', { style: { display: 'flex', alignItems: 'center', gap: '10px' } },
        el('div', { class: 'h2', style: { margin: 0, flex: 1 } }, title),
        el('button', { class: 'btn primary sm', onClick: addTask }, '+ Add task'),
      ),
      dayNav(),
      bar,
    );
  }

  function column(col) {
    const colTasks = tasks.filter((t) => t.columnId === col.id);
    const body = el('div', { class: 'column-body' }, colTasks.map(card));
    const node = el('div', { class: 'column' },
      el('div', { class: 'column-head' },
        el('span', { class: 'cdot', style: { background: `var(${catVar(col.category)})` } }),
        el('span', { class: 'cname' }, col.name),
        el('span', { class: 'count' }, String(colTasks.length)),
      ),
      body,
    );
    node.addEventListener('dragover', (e) => { e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'; node.classList.add('drop'); });
    node.addEventListener('dragleave', (e) => { if (!node.contains(e.relatedTarget)) node.classList.remove('drop'); });
    node.addEventListener('drop', (e) => { e.preventDefault(); node.classList.remove('drop'); moveTask(draggingId, col); });
    return node;
  }

  /** L13: a task added on this device has no server id yet, so it can't be opened until it has synced. */
  function openCard(task) {
    if (isTempId(task.id)) {
      err = '';
      note = 'This task is still waiting to sync — open it after it syncs.';
      render();
      return;
    }
    ctx.openTask(task.id);
  }

  /** What a screen reader says for a card: title, key, priority and whether it repeats. */
  function cardLabel(task) {
    const priority = PRIORITY_LABEL[task.priority] || task.priority;
    return [task.title, task.key, priority ? `${priority} priority` : null, isRecurring(task) ? 'repeats' : null].filter(Boolean).join(', ');
  }

  function card(task) {
    const node = el('div', {
      class: 'tcard', draggable: 'true', role: 'button', tabindex: '0', 'aria-label': cardLabel(task), dataset: { taskId: task.id },
      onClick: () => openCard(task),
      onKeydown: (e) => {
        if (e.target !== node || (e.key !== 'Enter' && e.key !== ' ')) return;
        e.preventDefault(); // Space would scroll the page
        openCard(task);
      },
    },
      el('div', { class: 'tt' }, task.title),
      el('div', { class: 'row' },
        el('span', { class: 'k' }, task.key || ''),
        el('span', { style: { flex: 1 } }),
        isRecurring(task) ? el('span', { class: 'muted', role: 'img', 'aria-label': 'Repeats', title: 'Repeats' }, '🔁') : null,
        pill(PRIORITY_LABEL[task.priority] || task.priority || '', task.priority),
      ),
    );
    node.addEventListener('dragstart', (e) => {
      draggingId = task.id;
      if (e.dataTransfer) { e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', task.id); } catch { /* some browsers */ } }
      node.classList.add('dragging');
    });
    node.addEventListener('dragend', () => { node.classList.remove('dragging'); draggingId = null; });
    const wrap = el('div', { class: 'tcard-wrap' }, node);
    // Moving without dragging: the other columns, in board order.
    if (columns.some((c) => c.id !== task.columnId)) {
      wrap.classList.add('has-move');
      wrap.append(menuButton({
        className: 'tcard-move',
        text: el('span', { 'aria-hidden': 'true' }, '⋯'),
        label: `Move “${task.title}” to another column`,
        menuLabel: `Move “${task.title}” to`,
        title: 'Move to…',
        host: wrap,
        items: () => columns.filter((c) => c.id !== task.columnId).map((c) => ({
          label: c.name,
          swatch: `var(${catVar(c.category)})`,
          onPick: () => moveTask(task.id, c, { fromKeyboard: true }),
        })),
      }));
    }
    return wrap;
  }

  /** Say something to screen readers (the board's polite live region). */
  function announce(text) {
    live.textContent = text;
  }

  async function moveTask(id, targetCol, { fromKeyboard = false } = {}) {
    draggingId = null;
    if (!id) return;
    const task = tasks.find((t) => t.id === id);
    if (!task || task.columnId === targetCol.id) return;
    if (fromKeyboard) focusTaskId = id; // focus follows the card to its new column
    if (isTempId(String(id))) { err = 'This task is still waiting to sync — move it after it syncs.'; render(); return; }
    if (fromKeyboard) announce(`Moved “${task.title}” to ${targetCol.name}.`);

    const before = { columnId: task.columnId, columnCategory: task.columnCategory, completedAt: task.completedAt, progress: task.progress };
    // Completing a repeating task makes its next copy on the server — reload to show it.
    const completesRepeat = isRecurring(task) && targetCol.category === 'DONE';
    // Optimistic move to the end of the target column.
    task.columnId = targetCol.id;
    task.columnCategory = targetCol.category;
    if (targetCol.category === 'DONE') { task.completedAt = task.completedAt || new Date().toISOString(); task.progress = 100; }
    else if (task.completedAt) task.completedAt = null;
    const position = tasks.filter((t) => t.columnId === targetCol.id).length - 1;
    err = ''; note = '';
    render();

    try {
      // The column's status travels with a move kept on this device, so other screens show it moved too.
      const r = await ctx.write('task.move', { id, columnId: targetCol.id, position, columnCategory: targetCol.category });
      if (r.queued) { note = SAVED_ON_DEVICE; render(); }
      else if (completesRepeat) await load();
      else if (r.data && r.data.id === id) {
        // H1: the move made a new version of the task.
        for (const f of MOVE_REPLY_FIELDS) if (r.data[f] !== undefined) task[f] = r.data[f];
      }
    } catch (e) {
      Object.assign(task, before);
      err = writeErrorMessage(e, 'Could not move the task — please try again.');
      render();
    } finally {
      ctx.afterMutation();
    }
  }

  async function addTask() {
    const firstCol = columns[0];
    if (!firstCol) return;
    const title = (window.prompt('New task title') || '').trim();
    if (!title) return;
    // Land on the day being viewed, like the web board.
    const payload = { projectId, columnId: firstCol.id, title, priority: 'NORMAL', boardDate };
    err = ''; note = '';
    try {
      const r = await ctx.write('task.create', payload);
      if (r.queued) note = 'Saved on this device — the task will be created when the connection is back.';
      tasks.push(!r.queued && r.data && r.data.id ? r.data : optimisticTask(firstCol, title, r.item));
    } catch (e) {
      err = writeErrorMessage(e, 'Could not add the task — please try again.');
    } finally {
      render();
      ctx.afterMutation();
    }
  }

  /** A task kept on this device: the same temporary id it has after a reload (pending-overlay.js). */
  function optimisticTask(col, title, item) {
    return { id: item ? tempId(item) : `tmp-${Date.now()}`, key: '', title, priority: 'NORMAL', columnId: col.id, columnCategory: col.category, dueDate: null, progress: 0, completedAt: null, projectId, pending: true };
  }
}
