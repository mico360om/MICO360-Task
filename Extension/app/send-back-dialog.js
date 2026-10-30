/**
 * Send back (task approvals), as on the website: a modal dialog that asks why — the reason is
 * required, becomes the approver's comment on the task and goes to the people on it, and the task
 * returns to In progress. Focus starts in the box and stays inside (app/dialog.js); Escape and Cancel
 * keep things as they are; Ctrl+Enter (⌘+Enter) sends. Sending with nothing written says so and puts
 * focus back in the box. A send that fails keeps the dialog open with the reason, saying why. When it
 * closes, focus goes back to what opened it.
 */
import { el } from './dom.js';
import { showModal } from './dialog.js';
import { DECISION_WORDS, REASON_MAX, sendBackNote, sendBackTitle } from '../src/approvals.js';

let seq = 0;

/**
 * `onSend(reason)` sends it (the trimmed reason) and returns a promise: resolved, the dialog closes;
 * rejected, its message is shown in the dialog. `focusBack()` returns what to focus once it closes.
 */
export function openSendBackDialog({ taskKey, taskTitle, onSend, focusBack, errorText = (e) => (e && e.message) || 'Couldn’t send it back. Please try again.' }) {
  const id = `send-back-${++seq}`;
  let closed = false;
  let busy = false;
  let release = () => {};

  const need = el('p', { id: `${id}-need`, class: 'sb-need hidden' }, DECISION_WORDS.reasonMissing);
  const problem = el('p', { class: 'errbar sb-problem hidden', role: 'alert' });
  const box = el('textarea', {
    id: `${id}-reason`, class: 'field sb-reason', rows: '4', maxlength: String(REASON_MAX), placeholder: DECISION_WORDS.reasonPlaceholder,
    onInput: () => { if (box.value.trim()) markMissing(false); },
    onKeydown: (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        void send();
      }
    },
  });
  const sendBtn = el('button', { class: 'btn primary', type: 'submit' }, DECISION_WORDS.sendBack);
  const cancelBtn = el('button', { class: 'btn', type: 'button', onClick: () => close() }, DECISION_WORDS.cancel);
  const form = el('form', { onSubmit: (e) => { e.preventDefault(); void send(); } },
    el('h2', { id: `${id}-title`, class: 'sb-title' }, sendBackTitle(taskKey)),
    el('p', { id: `${id}-note`, class: 'sb-note' }, sendBackNote(taskTitle)),
    el('label', { for: box.id, class: 'sb-label' }, DECISION_WORDS.reasonLabel),
    box,
    need,
    problem,
    el('div', { class: 'sb-actions' }, cancelBtn, sendBtn),
  );
  const panel = el('div', { class: 'modal sb-modal', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': `${id}-title`, 'aria-describedby': `${id}-note` }, form);
  const layer = el('div', { class: 'modal-layer' },
    el('div', { class: 'scrim', 'aria-hidden': 'true', onClick: () => { if (!busy) close(); } }),
    panel);
  document.body.append(layer);
  release = showModal(layer, { onEscape: () => { if (!busy) close(); } });
  box.focus();

  function markMissing(on) {
    need.classList.toggle('hidden', !on);
    if (on) {
      box.setAttribute('aria-invalid', 'true');
      box.setAttribute('aria-describedby', need.id);
    } else {
      box.removeAttribute('aria-invalid');
      box.removeAttribute('aria-describedby');
    }
  }

  async function send() {
    if (busy) return;
    const reason = box.value.trim();
    if (!reason) {
      markMissing(true);
      box.focus();
      return;
    }
    busy = true;
    sendBtn.setAttribute('aria-disabled', 'true');
    cancelBtn.disabled = true;
    problem.classList.add('hidden');
    try {
      await onSend(reason);
      close();
    } catch (e) {
      problem.textContent = errorText(e);
      problem.classList.remove('hidden');
      busy = false;
      sendBtn.removeAttribute('aria-disabled');
      cancelBtn.disabled = false;
      box.focus();
    }
  }

  function close() {
    if (closed) return;
    closed = true;
    release();
    layer.remove();
    const back = focusBack ? focusBack() : null;
    if (back && back.isConnected) back.focus();
  }

  return { close };
}
