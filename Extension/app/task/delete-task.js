/**
 * Deleting the task, kept apart at the foot of the drawer and always asked first (as on the web).
 * Offered only to an admin or a manager of the task's project; of those, only its creator or the
 * one person it's assigned to may delete it (src/task-delete-rule.js, the server's rule) — anyone
 * else sees Delete task greyed out, saying why. A repeating task asks which: this copy (the series
 * carries on) or the whole series (only for the series' creator). The delete is sent now or kept
 * on this device, and the drawer closes either way.
 */
import { el, mount } from '../dom.js';
import { confirmBox, redrawKeepingFocus, whyId } from './kit.js';
import { inSeries } from './fields.js';
import { DELETE_NOT_ALLOWED, DELETE_SERIES_NOT_ALLOWED, mayDeleteSeries, mayDeleteTask } from '../../src/task-delete-rule.js';

export function DeleteSection(d) {
  const node = el('div', { class: 'drawer-foot' });
  let asking = false;
  let busy = false;
  let ask = null;

  /** May they delete tasks here at all: an admin, or a manager of the task's project. */
  function canDelete() {
    if (d.isAdmin()) return true;
    return Array.isArray(d.s.members) && d.s.members.some((m) => m.id === d.ctx.me.id && m.role === 'MANAGER');
  }

  /** Why they may not delete this task, and its whole series (null: they may). The server says; an older one doesn't: the same rule here. */
  function blocked(t) {
    const facts = { viewerId: d.ctx.me.id, mayManage: true, createdById: t.createdById || '' };
    const assigneeIds = (Array.isArray(d.s.assignees) ? d.s.assignees : []).map((a) => a.id);
    const one = typeof t.canDelete === 'boolean' ? t.canDelete : mayDeleteTask({ ...facts, assigneeIds });
    const all = typeof t.canDeleteSeries === 'boolean' ? t.canDeleteSeries : mayDeleteSeries({ ...facts, seriesCreatorId: facts.createdById });
    return { task: one ? null : DELETE_NOT_ALLOWED, series: all ? null : DELETE_SERIES_NOT_ALLOWED };
  }

  function render() {
    const t = d.s.task;
    redrawKeepingFocus(node, () => mount(node, t && !t.pendingDelete && canDelete() ? draw(t) : null), () => node.querySelector('button'));
  }

  /** Ask which (or whether) to delete, with focus on the safe answer — only when first asked. */
  function askNow() {
    asking = true;
    render();
    if (ask) ask.focusSafe();
  }

  function draw(t) {
    const why = blocked(t);
    if (!asking && why.task) {
      // Shown, unavailable, saying why — under it and read with it.
      const id = whyId();
      return el('div', { class: 'td-delete' },
        el('button', { class: 'btn sm ghost danger', type: 'button', 'aria-disabled': 'true', 'aria-describedby': id, title: why.task }, 'Delete task'),
        el('p', { class: 'muted td-delete-why', id }, why.task));
    }
    if (!asking) {
      return el('button', { class: 'btn sm ghost danger', type: 'button', disabled: busy, onClick: askNow }, 'Delete task');
    }
    const series = inSeries(t);
    const box = confirmBox(
      series ? 'This is a repeating task — delete which?' : 'Delete this task? This can’t be undone.',
      series
        ? [{ text: 'This copy', aria: 'Delete this copy', onClick: () => remove(false) }, { text: 'The whole series', aria: 'Delete the whole series', onClick: () => remove(true), why: why.series }]
        : [{ text: 'Delete', aria: 'Delete the task', onClick: () => remove(false) }],
      () => {
        asking = false;
        render();
        const again = node.querySelector('button');
        if (again) again.focus();
      },
      { keepLabel: 'Cancel' },
    );
    ask = box;
    return box.node;
  }

  async function remove(series) {
    const t = d.s.task;
    d.clearError();
    busy = true;
    asking = false;
    render();
    try {
      await d.send('task.delete', series ? { id: d.taskId, scope: 'series', seriesId: t.recurrenceParentId || t.id } : { id: d.taskId });
      d.close();
    } catch (e) {
      busy = false;
      d.fail(e, 'Couldn’t delete the task.');
      render();
    }
  }

  return { node, render };
}
