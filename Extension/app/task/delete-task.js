/**
 * Deleting the task, kept apart at the foot of the drawer and always asked first (as on the web).
 * Offered only to an admin or a manager of the task's project (the server's rule). A repeating
 * task asks which: this copy (the series carries on) or the whole series. The delete is sent now or
 * kept on this device, and the drawer closes either way.
 */
import { el, mount } from '../dom.js';
import { confirmBox, redrawKeepingFocus } from './kit.js';
import { inSeries } from './fields.js';

export function DeleteSection(d) {
  const node = el('div', { class: 'drawer-foot' });
  let asking = false;
  let busy = false;
  let ask = null;

  function canDelete() {
    if (d.isAdmin()) return true;
    return Array.isArray(d.s.members) && d.s.members.some((m) => m.id === d.ctx.me.id && m.role === 'MANAGER');
  }

  function render() {
    const t = d.s.task;
    redrawKeepingFocus(node, () => mount(node, t && !t.pendingDelete && canDelete() ? draw(t) : null), () => node.querySelector('button'));
    if (ask) {
      ask.focusSafe();
      ask = null;
    }
  }

  function draw(t) {
    if (!asking) {
      return el('button', { class: 'btn sm ghost danger', type: 'button', disabled: busy, onClick: () => { asking = true; render(); } }, 'Delete task');
    }
    const series = inSeries(t);
    const box = confirmBox(
      series ? 'This is a repeating task — delete which?' : 'Delete this task? This can’t be undone.',
      series
        ? [{ text: 'This copy', aria: 'Delete this copy', onClick: () => remove(false) }, { text: 'The whole series', aria: 'Delete the whole series', onClick: () => remove(true) }]
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
