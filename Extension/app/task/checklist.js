/**
 * The task drawer's checklist: tick items and add new ones (each sent now or kept on this device).
 * An item added on this device has no server id yet: it can be ticked once it has synced (L13).
 */
import { el, mount } from '../dom.js';
import { isTempId, tempId } from '../../src/pending-overlay.js';
import { redrawKeepingFocus, section } from './kit.js';

export function ChecklistSection(d) {
  const node = el('div');
  const list = () => d.s.checklist;

  function recount() {
    const c = list();
    c.total = c.items.length;
    c.done = c.items.filter((i) => i.done).length;
  }

  function render() {
    redrawKeepingFocus(node, () => mount(node, draw()));
  }

  function draw() {
    const c = list();
    const rows = c.items.map((item) => {
      const waiting = isTempId(item.id);
      const cb = el('input', { type: 'checkbox', 'aria-label': item.text, disabled: waiting, title: waiting ? 'Waiting to sync' : null });
      cb.checked = !!item.done;
      cb.addEventListener('change', () => toggle(item, cb.checked));
      return el('label', { class: `td-check${waiting ? ' waiting' : ''}` },
        cb,
        el('span', { class: item.done ? 'td-done' : null }, item.text),
        waiting ? el('span', { class: 'muted td-small' }, '· waiting to sync') : null,
      );
    });

    const add = el('input', { class: 'field', placeholder: 'Add checklist item…', 'aria-label': 'New checklist item' });
    const submit = () => { const v = add.value.trim(); if (v) { add.value = ''; addItem(v); } };
    add.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });

    return section('checklist', `Checklist (${c.done}/${c.total})`,
      rows.length ? el('div', {}, rows) : el('div', { class: 'muted td-small' }, 'No checklist items yet.'),
      el('div', { class: 'td-add' }, add, el('button', { class: 'btn sm', type: 'button', onClick: submit }, 'Add')),
    );
  }

  async function toggle(item, done) {
    if (isTempId(item.id)) {
      d.fail(null, 'This item is still waiting to sync — tick it after it syncs.');
      return;
    }
    item.done = done;
    recount();
    d.clearError();
    render();
    try {
      await d.send('checklist.update', { itemId: item.id, patch: { done } });
    } catch (e) {
      item.done = !done;
      recount();
      d.fail(e, 'Could not update the checklist.');
    }
    render();
  }

  async function addItem(text) {
    d.clearError();
    try {
      const r = await d.send('checklist.add', { id: d.taskId, text });
      // Kept on this device: the same temporary id it has when the drawer opens again (pending-overlay.js).
      list().items.push(!r.queued && r.data && r.data.id ? r.data : { id: r.item ? tempId(r.item) : `tmp-${Date.now()}`, text, done: false });
    } catch (e) {
      d.fail(e, 'Could not add the item.');
    }
    recount();
    render();
  }

  return { node, render };
}
