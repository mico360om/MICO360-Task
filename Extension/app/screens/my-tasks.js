import { el, mount, Loader, ErrorState, Empty } from '../dom.js';
import { groupTasksByDue, isDone, isCompletedToday } from '../../src/summary.js';
import { formatDayKey, todayKey } from '../../src/due-date.js';
import { taskRow, PRIORITY_LABEL, writeErrorMessage, SAVED_ON_DEVICE } from '../components.js';
import { SORT_OPTIONS, sortTasks, projectFilterOptions, doneColumnOf } from '../../src/task-cards.js';
import { isRecurring } from '../../src/recurrence.js';
import { isTempId } from '../../src/pending-overlay.js';

/**
 * My Tasks — every task assigned to me, with a keyword search, priority chips, a project filter
 * and a sort (the web's: due date, priority, progress, title), grouped into Overdue / Due today /
 * Upcoming / No due date / Completed sections (mirrors the web + Android apps). "Mark done" on an
 * open task moves it to its project's Done column (src/task-cards.js doneColumnOf — the server
 * completes a task moved there), sent now or kept on this device like a move on the board. Reads
 * work offline via the read-through cache.
 *
 * `root.refresh()` reads the list again in place (coming back to the tab, and every minute in the
 * side panel — Stage 7): the search, filters and focus stay. `view: 'today'` is the side panel's
 * Today (app/screens/today.js): only Overdue, Due today and Done today, with no search or filters.
 */
export function MyTasksScreen(ctx, { view = 'all' } = {}) {
  const PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'URGENT'];
  const today = view === 'today';

  // ---- screen state (declared BEFORE load()/return to avoid a TDZ ReferenceError) ----
  let allTasks = [];
  let projects = [];
  let search = '';
  let project = '';
  let sort = 'due';
  let err = '';
  let note = '';
  let focusWant = null; // what to focus after the next render: { id, part: 'row' | 'mark' }
  let reads = 0; // each read's number: an older answer is dropped
  let marks = 0; // each "Mark done" pressed: a read made before one is dropped (it would undo it on screen)
  let owed = false; // a read is still owed (a repeating task's next copy): made once no task is being marked done
  let shown = null; // what the screen shows: 'list' or 'error' (null while the first read is on its way)
  let shownDay = ''; // the company's day the list was drawn for (Overdue and Due today change at midnight)
  let shownStale = false;
  let filterOptions = ''; // the project filter's options as drawn
  const activePriorities = new Set();
  const marking = new Set(); // tasks being marked done (their button waits)

  const root = el('div');

  // Persistent toolbar (built once) so the search input keeps focus across re-renders;
  // only `resultsEl` is re-rendered as filters change.
  const searchInput = el('input', {
    class: 'field', type: 'search', placeholder: 'Search tasks…', 'aria-label': 'Search my tasks',
    style: { flex: '1', minWidth: '160px' },
    onInput: (e) => { search = e.currentTarget.value; syncReset(); renderResults(); },
  });
  const chipEls = PRIORITIES.map((p) =>
    el('button', { class: 'chip', type: 'button', 'aria-pressed': 'false', onClick: (e) => togglePriority(p, e.currentTarget) }, PRIORITY_LABEL[p]),
  );
  const projectSel = el('select', { class: 'field mt-select', 'aria-label': 'Filter by project', onChange: (e) => { project = e.currentTarget.value; syncReset(); renderResults(); } });
  const sortSel = el('select', { class: 'field mt-select', 'aria-label': 'Sort tasks', onChange: (e) => { sort = e.currentTarget.value; renderResults(); } },
    SORT_OPTIONS.map((o) => el('option', { value: o.value }, o.label)));
  sortSel.value = sort;
  const resetBtn = el('button', { class: 'btn sm hidden', type: 'button', onClick: reset }, 'Reset');
  const staleTag = el('span', { class: 'stale-tag hidden' }, 'offline · saved');
  const toolbar = el('div', { class: 'toolbar' }, searchInput, ...chipEls, projectSel,
    el('span', { class: 'mt-sort' }, el('span', { 'aria-hidden': 'true' }, 'Sort'), sortSel), resetBtn, staleTag);
  const messages = el('div');
  const live = el('div', { class: 'sr-only', role: 'status', 'aria-live': 'polite' });
  const resultsEl = el('div');
  // Today: the company's day, and "offline · saved" beside it (there is no toolbar).
  const dateEl = el('p', { class: 'today-date' });
  const head = today ? el('div', { class: 'today-head' }, dateEl, staleTag) : toolbar;

  load();
  // Read again in place; not while a task is being marked done (the answer would undo it on screen).
  root.refresh = () => {
    if (!marking.size) void load({ quiet: true });
    return true;
  };
  return root;

  /**
   * Read my tasks. `quiet` (reading again): no spinner; a read that fails leaves what is on screen
   * (the list, or the error already shown — not put up and announced again); and the same tasks
   * and projects as shown aren't drawn again (a screen reader keeps its place, an open list stays
   * open). Any answer to a read made before a "Mark done" is dropped — it would undo it on screen.
   */
  async function load({ quiet = false } = {}) {
    const n = (reads += 1);
    const marked = marks;
    if (!quiet && !allTasks.length) mount(root, Loader());
    try {
      const [mine, list] = await Promise.all([
        ctx.api.tasks.mine(),
        ctx.api.projects && ctx.api.projects.list ? ctx.api.projects.list().catch(() => ({ data: [] })) : Promise.resolve({ data: [] }),
      ]);
      if (n !== reads || marked !== marks || marking.size) return; // a newer read, or a task marked done meanwhile
      owed = false;
      const found = mine.data ?? [];
      const foundProjects = Array.isArray(list && list.data) ? list.data : [];
      const day = todayKey(ctx.timeZone, new Date());
      const same = shown === 'list' && day === shownDay && !!mine.stale === shownStale
        && JSON.stringify(found) === JSON.stringify(allTasks) && JSON.stringify(foundProjects) === JSON.stringify(projects);
      if (same) return;
      allTasks = found;
      projects = foundProjects;
      shownDay = day;
      shownStale = !!mine.stale;
      staleTag.classList.toggle('hidden', !mine.stale);
      renderProjectFilter();
      if (!root.contains(resultsEl)) mount(root, head, messages, resultsEl, live);
      shown = 'list';
      syncReset();
      renderResults();
    } catch {
      if (n !== reads || (quiet && shown)) return; // keep what is on screen
      mount(root, ErrorState('Could not load your tasks.', () => load()));
      shown = 'error';
    }
  }

  /** The project filter's options; drawn again only when they change (drawing them closes an open list). */
  function renderProjectFilter() {
    const options = projectFilterOptions(allTasks, projects);
    if (project && !options.some((o) => o.value === project)) project = '';
    const drawn = JSON.stringify(options);
    if (drawn !== filterOptions) {
      mount(projectSel, options.map((o) => el('option', { value: o.value }, o.label)));
      filterOptions = drawn;
    }
    projectSel.value = project;
  }

  function togglePriority(p, btn) {
    if (activePriorities.has(p)) activePriorities.delete(p);
    else activePriorities.add(p);
    btn.classList.toggle('on', activePriorities.has(p));
    btn.setAttribute('aria-pressed', String(activePriorities.has(p)));
    syncReset();
    renderResults();
  }

  function reset() {
    search = '';
    searchInput.value = '';
    project = '';
    projectSel.value = '';
    activePriorities.clear();
    for (const c of chipEls) { c.classList.remove('on'); c.setAttribute('aria-pressed', 'false'); }
    syncReset();
    renderResults();
  }

  function syncReset() {
    const active = search.trim() !== '' || activePriorities.size > 0 || project !== '';
    resetBtn.classList.toggle('hidden', !active);
  }

  function filtered() {
    const q = search.trim().toLowerCase();
    return allTasks.filter((t) => {
      if (project && t.projectId !== project) return false;
      if (activePriorities.size && !activePriorities.has(t.priority)) return false;
      if (!q) return true;
      return `${t.title || ''} ${t.description || ''} ${t.key || ''}`.toLowerCase().includes(q);
    });
  }

  function renderMessages() {
    mount(messages,
      err ? el('div', { class: 'errbar', role: 'alert' }, el('span', {}, err)) : null,
      note ? el('div', { class: 'infobar', role: 'status' }, note) : null);
  }

  function renderResults() {
    renderMessages();
    // Calendar days in the company time zone; finished tasks are never overdue (XP-03).
    const now = Date.now();
    // Today (the side panel) says which day it is — with or without tasks.
    if (today) dateEl.textContent = formatDayKey(todayKey(ctx.timeZone, new Date(now)));
    if (allTasks.length === 0) {
      mount(resultsEl, Empty('No tasks assigned', 'Tasks assigned to you show up here.'));
      return;
    }
    const tasks = filtered();
    if (tasks.length === 0) {
      mount(resultsEl, Empty('No matching tasks', 'Try a different search or clear the filters.'));
      return;
    }

    const g = groupTasksByDue(tasks, { timeZone: ctx.timeZone, now });

    const kept = focusedPart();
    if (today) {
      // Today (the side panel): what is overdue or due today, and what was finished today.
      const doneToday = g.completed.filter((t) => isCompletedToday(t, ctx.timeZone, now));
      mount(resultsEl,
        g.overdue.length || g.dueToday.length ? null : Empty('Nothing due today', 'Tasks that are overdue or due today show up here.'),
        section('Overdue', g.overdue),
        section('Due today', g.dueToday),
        section('Done today', doneToday),
      );
    } else {
      mount(resultsEl,
        section('Overdue', g.overdue),
        section('Due today', g.dueToday),
        section('Upcoming', g.upcoming),
        section('No due date', g.noDue),
        section('Completed', g.completed),
      );
    }
    // Drawing the list again replaces every row: focus goes back to the same row or "Mark done"
    // (never taken from the search box or a filter).
    const want = focusWant || kept;
    focusWant = null;
    const a = document.activeElement;
    if (want && (!a || a === document.body || !a.isConnected)) focusPart(want);
  }

  /** The row or "Mark done" button that has keyboard focus, to find again after the list is redrawn. */
  function focusedPart() {
    const a = document.activeElement;
    if (!a || !resultsEl.contains(a)) return null;
    if (a.dataset.markDone) return { id: a.dataset.markDone, part: 'mark' };
    if (a.classList.contains('task-row') && a.dataset.taskId) return { id: a.dataset.taskId, part: 'row' };
    return null;
  }

  /** Focus a task's "Mark done" (or, once it is done and has none, its row). */
  function focusPart({ id, part }) {
    const mark = part === 'mark' ? [...resultsEl.querySelectorAll('.mark-done')].find((b) => b.dataset.markDone === id) : null;
    const target = mark || [...resultsEl.querySelectorAll('.task-row')].find((r) => r.dataset.taskId === id);
    if (target) target.focus();
  }

  function section(label, tasks) {
    if (!tasks.length) return null;
    // A heading under the page's own (a screen reader can move from group to group).
    return el('div', { class: 'mt-section', style: { marginTop: '20px' } },
      el('h2', { class: 'section-title' }, `${label} · ${tasks.length}`),
      el('div', { class: 'list' }, sortTasks(tasks, sort, ctx.timeZone).map(row)),
    );
  }

  /**
   * A task's row; an open one has "Mark done" beside it (two controls, not one inside the other). Its
   * name starts with what it says (WCAG 2.5.3). While it waits it says so (aria-disabled, not
   * disabled, so it keeps keyboard focus) and a second press does nothing.
   */
  function row(t) {
    const line = taskRow(t, () => ctx.openTask(t.id), { timeZone: ctx.timeZone });
    if (isDone(t)) return line;
    const busy = marking.has(t.id);
    return el('div', { class: 'task-row-wrap' }, line,
      el('button', {
        class: 'btn sm mark-done', type: 'button', 'aria-label': `Mark done: “${t.title}”`, title: 'Move it to its project’s Done column',
        'aria-disabled': busy ? 'true' : null, dataset: { markDone: t.id },
        onClick: () => { if (!marking.has(t.id)) markDone(t); },
      }, el('span', { 'aria-hidden': 'true' }, '✓ '), 'Mark done'));
  }

  /** Say what went wrong; focus stays on (or goes back to) the task's "Mark done". */
  function fail(text, t) {
    err = text;
    note = '';
    if (t) focusWant = { id: t.id, part: 'mark' };
    renderResults();
  }

  /**
   * Move the task to its project's Done column (the server then completes it). A repeating task's
   * next copy is made on the server, so the list is read again — once no task is being marked done
   * (a read made before another "Mark done" reached the server would undo it on screen).
   */
  async function markDone(t) {
    err = '';
    if (isTempId(String(t.id))) {
      fail('This task is still waiting to sync — mark it done after it syncs.', t);
      return;
    }
    marking.add(t.id);
    marks += 1;
    focusWant = { id: t.id, part: 'mark' }; // the button waits, with focus still on it
    renderResults();
    try {
      await moveToDone(t);
    } finally {
      if (!marking.size && owed) void load({ quiet: true });
    }
  }

  async function moveToDone(t) {
    let columnId = null;
    try {
      const cols = await ctx.api.projects.columns(t.projectId);
      columnId = doneColumnOf(cols && cols.data);
    } catch (e) {
      marking.delete(t.id);
      fail(writeErrorMessage(e, 'Couldn’t mark it done — its board couldn’t be read. Check the connection and try again.'), t);
      return;
    }
    if (!columnId) {
      marking.delete(t.id);
      fail('This project has no Done column — open its board to move the task.', t);
      return;
    }
    const before = { columnId: t.columnId, columnCategory: t.columnCategory, completedAt: t.completedAt, progress: t.progress };
    const repeats = isRecurring(t); // its next copy is made on the server (the reply may no longer say it repeats)
    Object.assign(t, { columnId, columnCategory: 'DONE', completedAt: t.completedAt || new Date().toISOString(), progress: 100 });
    try {
      const r = await ctx.write('task.move', { id: t.id, columnId, columnCategory: 'DONE' });
      marking.delete(t.id);
      focusWant = { id: t.id, part: 'row' }; // done: it has no "Mark done" any more, so its row
      if (r.queued) note = SAVED_ON_DEVICE;
      else {
        note = '';
        if (r.data && r.data.id === t.id) Object.assign(t, r.data);
      }
      live.textContent = `“${t.title}” is done.`;
      if (!r.queued && repeats) owed = true; // its next copy: read once no task is being marked done
      renderResults();
    } catch (e) {
      marking.delete(t.id);
      Object.assign(t, before);
      fail(writeErrorMessage(e, 'Couldn’t mark it done — please try again.'), t);
    } finally {
      ctx.afterMutation();
    }
  }
}
