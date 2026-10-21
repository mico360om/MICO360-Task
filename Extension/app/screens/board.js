import { el, mount, Loader, ErrorState, Empty, pill } from '../dom.js';
import { PRIORITY_LABEL, catVar, writeErrorMessage, SAVED_ON_DEVICE, ProjectAvatar, svgIcon } from '../components.js';
import { href } from '../../src/router.js';
import { todayKey, shiftDayKey, isDayKey, formatDayKey, relativeDayHint } from '../../src/due-date.js';
import { isRecurring } from '../../src/recurrence.js';
import { isTempId, tempId } from '../../src/pending-overlay.js';
import { cardFacts, cardLabel } from '../../src/task-cards.js';
import { hasFiles } from '../../src/file-drop-guard.js';
import { menuButton } from '../menu.js';
import { openNewTaskDialog } from '../new-task-dialog.js';

/** The web card's small icons (24×24 outlines). */
const ICON = {
  due: ['M3 6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z', 'M16 2v4M8 2v4M3 10h18'],
  checklist: ['M9 11l3 3L22 4', 'M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11'],
  comments: ['M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z'],
  attachments: ['M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48'],
  milestone: ['M5 21V4', 'M5 4h11l-2 4 2 4H5'],
  plus: ['M12 5v14M5 12h14'],
};

/** Shown when a new task is kept on this device until the connection is back. */
const NEW_TASK_SAVED = 'Saved on this device — the task will be created when the connection is back.';

/** What the board keeps from a move's reply: the task's new version and the status the server set. */
const MOVE_REPLY_FIELDS = ['version', 'columnId', 'columnCategory', 'completedAt', 'progress', 'columnHidden'];

/**
 * Kanban board for one project and ONE board day (EXT-03) — like the web and mobile boards, each day
 * has its own board. The day comes from `?date=YYYY-MM-DD` (default: today in the company time
 * zone). Columns of draggable task cards; moves and new tasks persist (offline-queued).
 *
 * Cards show what the web's do (Stage 4): the due day ("Overdue" once it has passed, in company
 * time), subtasks, comments and files, the people on it, a milestone, a blocked column and a
 * repeat. Every column has "Add a task to …", which opens the new-task form in this project and
 * column, on the board's day (app/new-task-dialog.js).
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
        project ? ProjectAvatar(project, { size: 'md', apiBase: ctx.apiBase }) : null,
        el('div', { class: 'h2', style: { margin: 0, flex: 1 }, dir: 'auto' }, title),
        el('button', { class: 'btn primary sm', type: 'button', 'aria-haspopup': 'dialog', title: 'New task', onClick: (e) => addTask(columns[0], e.currentTarget) }, 'New task'),
      ),
      dayNav(),
      bar,
    );
  }

  function column(col) {
    const colTasks = tasks.filter((t) => t.columnId === col.id);
    const addLabel = `Add a task to ${col.name}`;
    const body = el('div', { class: 'column-body' },
      colTasks.map(card),
      // An empty column's box is itself the way to start its first task (as on the web).
      colTasks.length ? null : el('button', { class: 'column-empty', type: 'button', 'aria-haspopup': 'dialog', onClick: (e) => addTask(col, e.currentTarget) },
        el('span', { class: 'ce-title' }, 'No tasks'),
        el('span', { class: 'ce-hint' }, el('span', { class: 'ce-link' }, 'Add a task'), ' or drop a card here')),
    );
    const node = el('section', { class: 'column', 'aria-label': col.name },
      el('div', { class: 'column-head' },
        el('span', { class: 'cdot', style: { background: `var(${catVar(col.category)})` } }),
        el('span', { class: 'cname', dir: 'auto' }, col.name),
        el('span', { class: 'count' }, String(colTasks.length)),
        el('button', { class: 'iconbtn sm col-add', type: 'button', 'aria-label': addLabel, title: addLabel, 'aria-haspopup': 'dialog', onClick: (e) => addTask(col, e.currentTarget) }, svgIcon(ICON.plus, 15, 2.2)),
      ),
      body,
    );
    // Only a card being dragged lands here: a file isn't a card (the page keeps it from opening).
    const takes = (e) => !!draggingId && !hasFiles(e);
    node.addEventListener('dragover', (e) => {
      if (!takes(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
      node.classList.add('drop');
    });
    node.addEventListener('dragleave', (e) => { if (!node.contains(e.relatedTarget)) node.classList.remove('drop'); });
    node.addEventListener('drop', (e) => {
      node.classList.remove('drop');
      if (!takes(e)) return;
      e.preventDefault();
      moveTask(draggingId, col);
    });
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

  /** A card's facts (as on the web): its column's status decides "done" and "blocked". */
  function factsOf(task) {
    const col = columns.find((c) => c.id === task.columnId);
    return cardFacts({ ...task, columnCategory: (col && col.category) || task.columnCategory }, { timeZone: ctx.timeZone });
  }

  function card(task) {
    const f = factsOf(task);
    const badge = (c) => el('span', { class: `tcount ${c.kind}`, 'aria-label': c.label, title: c.label }, svgIcon(ICON[c.kind], 13), c.value);
    const people = f.people;
    const node = el('div', {
      class: `tcard${f.overdue ? ' overdue' : f.blocked ? ' blocked' : ''}`, draggable: 'true', role: 'button', tabindex: '0',
      'aria-label': cardLabel(task, f), dataset: { taskId: task.id },
      onClick: () => openCard(task),
      onKeydown: (e) => {
        if (e.target !== node || (e.key !== 'Enter' && e.key !== ' ')) return;
        e.preventDefault(); // Space would scroll the page
        openCard(task);
      },
    },
      el('div', { class: 'row top' },
        el('span', { class: 'k' }, task.key || ''),
        el('span', { style: { flex: 1 } }),
        f.blocked ? el('span', { class: 'tblocked' }, 'Blocked') : null,
        f.milestone ? el('span', { class: 'tflag', role: 'img', 'aria-label': 'Milestone', title: 'Milestone' }, svgIcon(ICON.milestone, 13, 2)) : null,
        f.recurring ? el('span', { class: 'muted', role: 'img', 'aria-label': 'Repeats', title: 'Repeats' }, '🔁') : null,
        pill(PRIORITY_LABEL[task.priority] || task.priority || '', task.priority),
      ),
      el('div', { class: 'tt', dir: 'auto' }, task.title),
      f.dueText || f.counts.length
        ? el('div', { class: 'row meta' },
          f.dueText ? el('span', { class: `tdue${f.overdue ? ' overdue' : ''}` }, svgIcon(ICON.due, 13), f.dueText) : null,
          f.counts.map(badge))
        : null,
      el('div', { class: 'row foot' },
        el('span', { class: 'tprogress', 'aria-hidden': 'true' }, el('span', { style: { width: `${f.progress}%` } })),
        el('span', { class: 'tpct' }, `${f.progress}%`),
        people.shown.length
          ? el('span', { class: 'tpeople', 'aria-hidden': 'true' },
            people.single ? el('span', { class: 'tperson', dir: 'auto' }, people.single) : null,
            people.shown.map((p) => el('span', { class: 'tavatar', title: p.name }, p.initials)),
            people.extra > 0 ? el('span', { class: 'tmore' }, `+${people.extra}`) : null)
          : null,
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
          onPick: () => moveTask(task.id, c, { fromMenu: true }),
        })),
      }));
    }
    return wrap;
  }

  /** Say something to screen readers (the board's polite live region). */
  function announce(text) {
    live.textContent = text;
  }

  async function moveTask(id, targetCol, { fromMenu = false } = {}) {
    draggingId = null;
    if (!id) return;
    const task = tasks.find((t) => t.id === id);
    if (!task || task.columnId === targetCol.id) return;
    if (fromMenu) focusTaskId = id; // focus follows the card to its new column
    if (isTempId(String(id))) { err = 'This task is still waiting to sync — move it after it syncs.'; render(); return; }
    if (fromMenu) announce(`Moved “${task.title}” to ${targetCol.name}.`);

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

  /**
   * "Add a task to …": the new-task form in this project, starting in `col`, on the board's day.
   * The new card shows in the column it was put in (kept on this device offline, as a waiting card);
   * focus then goes back to the button that opened the form.
   */
  function addTask(col, opener) {
    if (!col || !project) return;
    // The board is drawn again meanwhile: find the same button again by its name.
    const back = opener && opener.getAttribute('aria-label');
    const backText = opener && !back ? opener.textContent : null;
    const again = () => [...view.querySelectorAll('button')]
      .find((b) => (back ? b.getAttribute('aria-label') === back : b.textContent === backText)) || null;
    openNewTaskDialog(ctx, { project: { ...project, id: project.id || projectId }, columnId: col.id, boardDate }, {
      onDone: (result) => created(result),
      focusBack: again,
    });
  }

  function created({ task, item, payload, message }) {
    err = '';
    if (task && task.id) {
      note = '';
      if (!tasks.some((t) => t.id === task.id)) tasks.push(task);
    } else if (item && payload) {
      note = NEW_TASK_SAVED;
      tasks.push(optimisticTask(payload, item));
    }
    render();
    announce(message || '');
    ctx.afterMutation();
  }

  /** A task kept on this device: the same temporary id it has after a reload (pending-overlay.js). */
  function optimisticTask(p, item) {
    const col = columns.find((c) => c.id === p.columnId);
    return {
      id: item ? tempId(item) : `tmp-${Date.now()}`, key: '', title: p.title, priority: p.priority || 'NORMAL', columnId: p.columnId,
      columnCategory: col ? col.category : null, dueDate: p.dueDate || null, progress: 0, completedAt: null, projectId, recurrenceRule: p.recurrenceRule || null, pending: true,
    };
  }
}
