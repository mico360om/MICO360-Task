import { el, mount, Loader, ErrorState, Empty } from '../dom.js';
import { summarizeTasks } from '../../src/summary.js';
import { taskRow, isDone, PRIORITY_LABEL } from '../components.js';

/**
 * My Tasks — every task assigned to me, with a client-side keyword search and priority
 * filter, grouped into Overdue / Due today / Upcoming / No due date / Completed sections
 * (mirrors the web + Android apps). Reads work offline via the read-through cache.
 */
export function MyTasksScreen(ctx) {
  const PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'URGENT'];

  // ---- screen state (declared BEFORE load()/return to avoid a TDZ ReferenceError) ----
  let allTasks = [];
  let search = '';
  const activePriorities = new Set();

  const root = el('div');

  // Persistent toolbar (built once) so the search input keeps focus across re-renders;
  // only `resultsEl` is re-rendered as filters change.
  const searchInput = el('input', {
    class: 'field', type: 'search', placeholder: 'Search tasks…',
    style: { flex: '1', minWidth: '160px' },
    onInput: (e) => { search = e.currentTarget.value; syncReset(); renderResults(); },
  });
  const chipEls = PRIORITIES.map((p) =>
    el('button', { class: 'chip', type: 'button', onClick: (e) => togglePriority(p, e.currentTarget) }, PRIORITY_LABEL[p]),
  );
  const resetBtn = el('button', { class: 'btn sm hidden', type: 'button', onClick: reset }, 'Reset');
  const staleTag = el('span', { class: 'stale-tag hidden' }, 'offline · saved');
  const toolbar = el('div', { class: 'toolbar' }, searchInput, ...chipEls, resetBtn, staleTag);
  const resultsEl = el('div');

  load();
  return root;

  async function load() {
    mount(root, Loader());
    try {
      const { data, stale } = await ctx.api.tasks.mine();
      allTasks = data ?? [];
      staleTag.classList.toggle('hidden', !stale);
      mount(root, toolbar, resultsEl);
      syncReset();
      renderResults();
    } catch {
      mount(root, ErrorState('Could not load your tasks.', load));
    }
  }

  function togglePriority(p, btn) {
    if (activePriorities.has(p)) { activePriorities.delete(p); btn.classList.remove('on'); }
    else { activePriorities.add(p); btn.classList.add('on'); }
    syncReset();
    renderResults();
  }

  function reset() {
    search = '';
    searchInput.value = '';
    activePriorities.clear();
    for (const c of chipEls) c.classList.remove('on');
    syncReset();
    renderResults();
  }

  function syncReset() {
    const active = search.trim() !== '' || activePriorities.size > 0;
    resetBtn.classList.toggle('hidden', !active);
  }

  function filtered() {
    const q = search.trim().toLowerCase();
    return allTasks.filter((t) => {
      if (activePriorities.size && !activePriorities.has(t.priority)) return false;
      if (!q) return true;
      return `${t.title || ''} ${t.description || ''} ${t.key || ''}`.toLowerCase().includes(q);
    });
  }

  function renderResults() {
    if (allTasks.length === 0) {
      mount(resultsEl, Empty('No tasks assigned', 'Tasks assigned to you show up here.'));
      return;
    }
    const tasks = filtered();
    if (tasks.length === 0) {
      mount(resultsEl, Empty('No matching tasks', 'Try a different search or clear the filters.'));
      return;
    }

    // summarizeTasks gives the Overdue / Due today counts (mirroring the web dashboard);
    // the actual task arrays are computed here with the same date logic (like dashboard.js).
    const s = summarizeTasks(tasks);
    const now = Date.now();
    const startOfDay = new Date(now); startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(now); endOfDay.setHours(23, 59, 59, 999);
    const startMs = startOfDay.getTime();
    const endMs = endOfDay.getTime();
    const dueMs = (t) => new Date(t.dueDate).getTime();

    const overdue = tasks.filter((t) => !isDone(t) && t.dueDate && dueMs(t) < startMs);
    const dueToday = tasks.filter((t) => !isDone(t) && t.dueDate && dueMs(t) >= startMs && dueMs(t) <= endMs);
    const upcoming = tasks.filter((t) => !isDone(t) && t.dueDate && dueMs(t) > endMs).sort((a, b) => dueMs(a) - dueMs(b));
    const noDue = tasks.filter((t) => !isDone(t) && !t.dueDate);
    const completed = tasks.filter((t) => isDone(t));

    mount(resultsEl,
      section('Overdue', s.overdue, overdue),
      section('Due today', s.dueToday, dueToday),
      section('Upcoming', upcoming.length, upcoming),
      section('No due date', noDue.length, noDue),
      section('Completed', completed.length, completed),
    );
  }

  function section(label, n, tasks) {
    if (!tasks.length) return null;
    return el('div', { style: { marginTop: '20px' } },
      el('div', { class: 'section-title' }, `${label} · ${n}`),
      el('div', { class: 'list' }, tasks.map((t) => taskRow(t, () => ctx.openTask(t.id)))),
    );
  }
}
