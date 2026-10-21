/**
 * The drawer's header actions: watch the task (a toggle — watchers hear about its changes) and
 * download it as Excel or PDF.
 */
import { el, mount } from '../dom.js';
import { taskExportPath, taskFileName } from '../../src/reports.js';
import { redrawKeepingFocus } from './kit.js';

export function HeaderActions(d) {
  const node = el('div', { class: 'export-box' });
  let exporting = null;

  function render() {
    redrawKeepingFocus(node, () => mount(node, watchButton(), [['xlsx', 'Excel'], ['pdf', 'PDF']].map(([format, label]) => el('button', {
      class: 'btn sm', type: 'button', 'aria-label': `Export task as ${label}`, title: `Download this task as ${label}`,
      disabled: exporting !== null, onClick: () => exportTask(format),
    }, exporting === format ? '…' : `⬇ ${label}`))));
  }

  /** Shown once whether you watch it is known (it is read with the task's other details). */
  function watchButton() {
    if (typeof d.s.watching !== 'boolean') return null;
    const on = d.s.watching;
    const count = Array.isArray(d.s.watchers) ? d.s.watchers.length : 0;
    return [
      el('button', {
        class: `btn sm td-watch${on ? ' on' : ''}`, type: 'button', 'aria-label': 'Watch this task', 'aria-pressed': String(on),
        title: on ? 'Stop watching this task' : 'Watch this task for updates', onClick: toggleWatch,
      }, el('span', { 'aria-hidden': 'true' }, '👁 '), 'Watch'),
      el('span', { class: 'td-watchers muted' }, count ? `${count} watching` : ''),
    ];
  }

  async function toggleWatch() {
    const me = d.ctx.me.id;
    const was = d.s.watching;
    const before = d.s.watchers;
    const others = (Array.isArray(before) ? before : []).filter((w) => w.id !== me);
    d.s.watching = !was;
    d.s.watchers = was ? others : [...others, { id: me }];
    d.clearError();
    render();
    try {
      const r = await d.send(was ? 'task.unwatch' : 'task.watch', { id: d.taskId });
      if (!r.queued && r.data && Array.isArray(r.data.watchers)) d.s.watchers = r.data.watchers;
      d.announce(was ? 'You stopped watching this task.' : 'You’re watching this task. You’ll hear about its changes.');
    } catch (e) {
      d.s.watching = was;
      d.s.watchers = before;
      d.fail(e, 'Couldn’t change watching.');
    }
    render();
  }

  async function exportTask(format) {
    if (!d.online()) {
      d.fail(null, 'Exports need a connection — you appear to be offline.');
      return;
    }
    exporting = format;
    d.clearError();
    render();
    try {
      const { blob, fileName } = await d.ctx.api.download(taskExportPath(d.taskId, format));
      d.ctx.saveFile(blob, fileName || taskFileName(d.s.task, format));
    } catch (e) {
      d.fail(e, 'Couldn’t export the task. Please try again.');
    } finally {
      exporting = null;
      render();
    }
  }

  return { node, render };
}
