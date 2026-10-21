/**
 * "Add a task" on a board (Stage 4): the quick-capture form (popup/quick-add-form.js) as a "New
 * task" dialog over the app, as on the web — in the board's project, starting in the chosen column,
 * on the board's day. It is a proper modal dialog (app/dialog.js): focus starts in the title and
 * stays inside, the board behind can't be reached, Escape or Close closes it (asking first when
 * something was typed), and focus goes back to what opened it.
 */
import { el } from './dom.js';
import { showModal } from './dialog.js';
import { QuickAddForm } from '../popup/quick-add-form.js';
import { newIdempotencyKey } from '../src/queue.js';

/**
 * `ctx`: the screen's context (api, me, storage, timeZone, apiBase, isOnline, write). `place`:
 * { project, columnId, boardDate }. `onDone(result)` hears `{ task, message }` (created) or
 * `{ item, payload, message }` (kept on this device), just before the dialog closes. `focusBack()`
 * returns what to focus when it closes (the screen may have been drawn again meanwhile).
 */
export function openNewTaskDialog(ctx, place, { onDone, focusBack } = {}) {
  let closed = false;
  let release = () => {};
  const form = QuickAddForm({
    api: ctx.api,
    me: ctx.me,
    local: ctx.storage,
    timeZone: ctx.timeZone,
    apiBase: ctx.apiBase,
    isOnline: () => (typeof ctx.isOnline === 'function' ? ctx.isOnline() : navigator.onLine),
    newKey: newIdempotencyKey,
    // The app's online-first write: sent now, or kept in the queue with this task's key. `hold`: a
    // task with files is never queued (the form offers to save it without them, as in the popup).
    send: (kind, payload, opts) => ctx.write(kind, payload, opts),
    place,
    // The board shows the new card first; then the dialog closes and focus goes back.
    onDone: (result) => {
      try {
        if (onDone) onDone(result);
      } finally {
        close();
      }
    },
    onCancel: () => close(),
  });
  const panel = el('div', { class: 'modal qa-modal', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'qa-dialog-title' }, form);
  const layer = el('div', { class: 'modal-layer' },
    el('div', { class: 'scrim', 'aria-hidden': 'true', onClick: () => form.requestClose() }),
    panel);
  document.body.append(layer);
  release = showModal(layer);
  const title = panel.querySelector('#qa-title');
  if (title) title.focus();

  function close() {
    if (closed) return;
    closed = true;
    release();
    layer.remove();
    const back = focusBack ? focusBack() : null;
    if (back && back.isConnected) back.focus();
  }

  return { close, requestClose: () => form.requestClose() };
}
