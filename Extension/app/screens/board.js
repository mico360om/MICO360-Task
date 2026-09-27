import { el, mount, Loader, ErrorState, Empty, pill } from '../dom.js';
import { PRIORITY_LABEL, catVar, writeErrorMessage } from '../components.js';
import { href } from '../../src/router.js';
import { todayKey, shiftDayKey, isDayKey, formatDayKey, relativeDayHint } from '../../src/due-date.js';

/**
 * Kanban board for one project and ONE board day (EXT-03) — like the web and mobile boards, each day
 * has its own board. The day comes from `?date=YYYY-MM-DD` (default: today in the company time
 * zone). Columns of draggable task cards; moves and new tasks persist (offline-queued).
 */
export function BoardScreen(ctx) {
  const projectId = ctx.params.projectId;
  const root = el('div');

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

  if (!projectId) {
    mount(root, Empty('Pick a project', 'Open a project to see its board.'),
      el('div', { style: { textAlign: 'center', marginTop: '-14px' } },
        el('button', { class: 'btn sm', onClick: () => ctx.navigate('#/projects') }, 'Browse projects')));
    return root;
  }

  load();
  return root;

  async function load() {
    mount(root, Loader());
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
      tasks = tks.data ?? [];
      progress = prog.data ?? null;
      stale = p.stale || cols.stale || tks.stale || prog.stale;
      render();
    } catch {
      mount(root, header(), ErrorState('Could not load this board.', load));
    }
  }

  function goToDay(key) {
    ctx.navigate(href(`/board/${projectId}`, key && key !== today ? { date: key } : undefined));
  }

  function render() {
    if (columns.length === 0) {
      mount(root, header(), Empty('No columns', 'This project has no board columns yet.'));
      return;
    }
    mount(root,
      header(),
      stale ? el('div', { class: 'errbar', style: { background: 'var(--warning-soft)', color: 'var(--warning)', borderColor: 'transparent' } }, 'Showing saved data — you appear to be offline.') : null,
      err ? el('div', { class: 'errbar', role: 'alert' }, el('span', {}, err)) : null,
      note ? el('div', { class: 'infobar', role: 'status' }, note) : null,
      el('div', { class: 'board' }, columns.map(column)),
    );
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

  function card(task) {
    const node = el('div', { class: 'tcard', draggable: 'true', role: 'button', tabindex: '0', 'aria-label': task.title, onClick: () => ctx.openTask(task.id) },
      el('div', { class: 'tt' }, task.title),
      el('div', { class: 'row' },
        el('span', { class: 'k' }, task.key || ''),
        el('span', { style: { flex: 1 } }),
        pill(PRIORITY_LABEL[task.priority] || task.priority || '', task.priority),
      ),
    );
    node.addEventListener('dragstart', (e) => {
      draggingId = task.id;
      if (e.dataTransfer) { e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', task.id); } catch { /* some browsers */ } }
      node.classList.add('dragging');
    });
    node.addEventListener('dragend', () => { node.classList.remove('dragging'); draggingId = null; });
    return node;
  }

  async function moveTask(id, targetCol) {
    draggingId = null;
    if (!id) return;
    const task = tasks.find((t) => t.id === id);
    if (!task || task.columnId === targetCol.id) return;
    if (String(id).startsWith('tmp-')) { err = 'This task is still waiting to sync — move it after it syncs.'; render(); return; }

    const before = { columnId: task.columnId, columnCategory: task.columnCategory, completedAt: task.completedAt, progress: task.progress };
    // Optimistic move to the end of the target column.
    task.columnId = targetCol.id;
    task.columnCategory = targetCol.category;
    if (targetCol.category === 'DONE') { task.completedAt = task.completedAt || new Date().toISOString(); task.progress = 100; }
    else if (task.completedAt) task.completedAt = null;
    const position = tasks.filter((t) => t.columnId === targetCol.id).length - 1;
    err = ''; note = '';
    render();

    try {
      const r = await ctx.write('task.move', { id, columnId: targetCol.id, position });
      if (r.queued) { note = 'Saved on this device — it will sync when the connection is back.'; render(); }
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
      tasks.push(!r.queued && r.data && r.data.id ? r.data : optimisticTask(firstCol, title));
    } catch (e) {
      err = writeErrorMessage(e, 'Could not add the task — please try again.');
    } finally {
      render();
      ctx.afterMutation();
    }
  }

  function optimisticTask(col, title) {
    return { id: `tmp-${Date.now()}`, key: '', title, priority: 'NORMAL', columnId: col.id, columnCategory: col.category, dueDate: null, progress: 0, completedAt: null, projectId };
  }
}
