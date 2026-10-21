/**
 * Modal dialogs (the task drawer) and putting focus back where it was when one closes.
 * Keyboard and screen-reader rules, as on the web app: focus moves into the dialog and stays there,
 * the page behind can't be reached (inert), Escape closes it, and closing returns focus to what
 * opened it.
 */

const FOCUSABLE = [
  'a[href]', 'button:not([disabled])', 'input:not([disabled]):not([type="hidden"])', 'select:not([disabled])',
  'textarea:not([disabled])', '[tabindex]:not([tabindex="-1"])',
].join(',');

/** The controls Tab can reach inside `container`, in order. */
export function focusables(container) {
  return [...container.querySelectorAll(FOCUSABLE)].filter((n) => !n.closest('[inert]')
    && (typeof n.checkVisibility !== 'function' || n.checkVisibility()));
}

/** Enough about a control to find "the same one" after its part of the dialog is redrawn. */
function describe(node) {
  return {
    tag: node.tagName,
    label: node.getAttribute('aria-label'),
    text: node.getAttribute('aria-label') ? null : node.textContent.trim(),
  };
}

function findAgain(panel, d) {
  if (!d) return null;
  return focusables(panel).find((n) => n.tagName === d.tag
    && (d.label ? n.getAttribute('aria-label') === d.label : !n.getAttribute('aria-label') && n.textContent.trim() === d.text)) || null;
}

/**
 * Show `node` — already in the page — as a modal dialog. The element inside it with role="dialog"
 * takes focus; everything else on the page becomes inert (no focus, hidden from screen readers);
 * Tab and Shift+Tab wrap around inside it; Escape blurs the field being typed in (so it saves) and
 * calls `onEscape`. When part of the dialog is redrawn under the focused control, focus goes to the
 * same control again (or the dialog itself), so it never falls out. Returns `release()`.
 */
export function showModal(node, { onEscape } = {}) {
  const doc = node.ownerDocument;
  const panel = node.matches('[role="dialog"]') ? node : node.querySelector('[role="dialog"]') || node;
  if (!panel.hasAttribute('tabindex')) panel.setAttribute('tabindex', '-1');
  const inerted = [...doc.body.children].filter((n) => n !== node && !n.contains(node) && !n.hasAttribute('inert'));
  for (const n of inerted) n.setAttribute('inert', '');

  let last = null; // the control that had focus
  let heading = null; // where a Tab press is taking focus (a blur-save may redraw it away first)

  function onFocusIn(e) {
    if (panel.contains(e.target)) {
      if (e.target !== panel) last = describe(e.target);
      heading = null;
    } else {
      panel.focus();
    }
  }

  function trap(e) {
    const items = focusables(panel);
    const a = doc.activeElement;
    const inside = !!a && a !== panel && panel.contains(a);
    if (!items.length) {
      e.preventDefault();
      panel.focus();
      return;
    }
    const first = items[0];
    const end = items[items.length - 1];
    let next;
    if (e.shiftKey && (!inside || a === first)) next = end;
    else if (!e.shiftKey && (!inside || a === end)) next = first;
    else {
      // The browser moves focus; leaving a field saves it, which can redraw the next control away.
      const i = items.indexOf(a);
      heading = i >= 0 ? describe(items[i + (e.shiftKey ? -1 : 1)]) : null;
      // Tab can also stay in the same control (a date's day, month and year): then it isn't heading on.
      setTimeout(() => {
        if (doc.activeElement === a) heading = null;
      }, 0);
      return;
    }
    e.preventDefault();
    heading = describe(next);
    next.focus();
  }

  function onKeyDown(e) {
    if (e.key === 'Tab') {
      trap(e);
    } else if (e.key === 'Escape' && !e.defaultPrevented) {
      e.preventDefault();
      const a = doc.activeElement;
      if (a && a !== panel && panel.contains(a) && typeof a.blur === 'function') a.blur(); // a typed title saves on blur
      if (onEscape) onEscape();
    }
  }

  const observer = new MutationObserver(() => {
    const a = doc.activeElement;
    if (a && a !== doc.body && a.isConnected) return; // focus is where it should be
    const again = findAgain(panel, heading) || findAgain(panel, last);
    heading = null;
    (again || panel).focus();
  });

  doc.addEventListener('keydown', onKeyDown);
  doc.addEventListener('focusin', onFocusIn);
  observer.observe(panel, { childList: true, subtree: true });
  panel.focus();

  return function release() {
    doc.removeEventListener('keydown', onKeyDown);
    doc.removeEventListener('focusin', onFocusIn);
    observer.disconnect();
    for (const n of inerted) n.removeAttribute('inert');
  };
}

/**
 * Give focus back to what opened a dialog, once the screen under it has been drawn again: the same
 * element if it is still in `container`, else the one with the same `data-task-id` when it appears
 * (screens reload their data first). Nothing happens if focus has moved on meanwhile; it gives up
 * after `timeoutMs`. Returns a function that stops waiting.
 */
export function returnFocus(container, { el, taskId } = {}, { timeoutMs = 5000 } = {}) {
  const doc = container.ownerDocument;
  const free = () => !doc.activeElement || doc.activeElement === doc.body;
  const target = () => {
    if (el && el.isConnected && container.contains(el)) return el;
    if (!taskId) return null;
    return [...container.querySelectorAll('[data-task-id]')].find((n) => n.dataset.taskId === String(taskId)) || null;
  };
  const settled = () => {
    if (!free()) return true;
    const t = target();
    if (!t) return false;
    t.focus();
    return true;
  };
  const noop = () => {};
  if (settled()) return noop;
  const observer = new MutationObserver(() => {
    if (settled()) stop();
  });
  const timer = setTimeout(stop, timeoutMs);
  function stop() {
    observer.disconnect();
    clearTimeout(timer);
  }
  observer.observe(container, { childList: true, subtree: true });
  return stop;
}
