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

/** The dialogs open on each page, oldest first, with what each one made inert. */
const openDialogs = new WeakMap();

function dialogsOn(doc) {
  if (!openDialogs.has(doc)) openDialogs.set(doc, []);
  return openDialogs.get(doc);
}

/**
 * Show `node` — already in the page — as a modal dialog. The element inside it with role="dialog"
 * takes focus; everything else on the page becomes inert (no focus, hidden from screen readers);
 * Tab and Shift+Tab wrap around inside it; Escape blurs the field being typed in (so it saves) and
 * calls `onEscape`. When part of the dialog is redrawn under the focused control, focus goes to the
 * same control again (or the dialog itself), so it never falls out — unless a click or Tab was
 * already taking it somewhere else in the dialog. Returns `release()`.
 *
 * Dialogs can be closed out of order: one closed under another leaves the page out of reach until
 * the one on top closes too. A dialog taken off the page without `release()` lets go by itself.
 */
export function showModal(node, { onEscape } = {}) {
  const doc = node.ownerDocument;
  const panel = node.matches('[role="dialog"]') ? node : node.querySelector('[role="dialog"]') || node;
  if (!panel.hasAttribute('tabindex')) panel.setAttribute('tabindex', '-1');
  const inerted = new Set([...doc.body.children].filter((n) => n !== node && !n.contains(node) && !n.hasAttribute('inert')));
  for (const n of inerted) n.setAttribute('inert', '');
  const me = { node, inerted };
  const stack = dialogsOn(doc);
  stack.push(me);

  let last = null; // the control that had focus
  let heading = null; // where a Tab press is taking focus (a blur-save may redraw it away first)
  // Another dialog opened over this one (search over the task panel) makes this one inert: until it
  // closes, the dialog on top has the keys and the focus.
  const covered = () => !!node.closest('[inert]');

  function onFocusIn(e) {
    if (gone()) return;
    if (covered()) return;
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
    if (gone()) return;
    if (covered()) return;
    if (e.key === 'Tab') {
      trap(e);
    } else if (e.key === 'Escape' && !e.defaultPrevented) {
      e.preventDefault();
      const a = doc.activeElement;
      if (a && a !== panel && panel.contains(a) && typeof a.blur === 'function') a.blur(); // a typed title saves on blur
      if (onEscape) onEscape();
    }
  }

  const inPlace = () => {
    const a = doc.activeElement;
    return !!a && a !== doc.body && a.isConnected;
  };
  let looking = false; // a check of where focus went is due
  let released = false;

  // Focus fell out with a redraw. What caused it — a click into another field, or Tab — may still be
  // moving focus on (the browser finishes that after the field that lost focus has saved and drawn
  // itself again), so look once it has; only then, if focus is still nowhere, put it back.
  const observer = new MutationObserver(() => {
    if (looking || inPlace()) return; // focus is where it should be
    looking = true;
    setTimeout(() => {
      looking = false;
      if (released || inPlace() || covered()) return;
      const again = findAgain(panel, heading) || findAgain(panel, last);
      heading = null;
      (again || panel).focus();
    }, 0);
  });

  /** Taken off the page without being released: let go now (the keys, focus and the page behind). */
  function gone() {
    if (node.isConnected) return false;
    release();
    return true;
  }
  const removal = new MutationObserver(() => { gone(); });

  doc.addEventListener('keydown', onKeyDown);
  doc.addEventListener('focusin', onFocusIn);
  observer.observe(panel, { childList: true, subtree: true });
  removal.observe(doc.body, { childList: true, subtree: true });
  panel.focus();

  function release() {
    if (released) return;
    released = true;
    doc.removeEventListener('keydown', onKeyDown);
    doc.removeEventListener('focusin', onFocusIn);
    observer.disconnect();
    removal.disconnect();
    const i = stack.indexOf(me);
    const newer = i >= 0 ? stack.slice(i + 1).reverse() : [];
    if (i >= 0) stack.splice(i, 1);
    for (const n of inerted) {
      // A dialog opened after this one (over it) and still open needs `n` kept out of reach: it
      // takes it over, and lets go of it when it closes.
      const heir = newer.find((d) => d.node.isConnected && d.node !== n && !n.contains(d.node));
      if (heir) heir.inerted.add(n);
      else n.removeAttribute('inert');
    }
  }
  return release;
}

/**
 * Whether a modal dialog is open over the screen (a board's New task form): any `aria-modal` dialog
 * that isn't inside `except` — the task drawer, the app's own overlay, which a route change closes
 * together with what it shows (a picture's preview).
 */
export function modalOpen(doc, except = null) {
  return [...doc.querySelectorAll('[aria-modal="true"]')].some((n) => !(except && except.contains(n)));
}

/**
 * Screen refreshes and route changes, held back while a modal dialog is open over the screen: the
 * dialog reports back to the screen that opened it (a New task form puts its card on that board),
 * so drawing the screen again under it — coming back to the tab, a hash change — would lose what the
 * dialog did. `run(fn)` runs `fn` now (true), or once no dialog is open any more (false), after the
 * dialog's close has put focus back. Several held at once run as one: the last one asked for.
 * `except()`: the overlay whose dialogs don't count (see modalOpen).
 */
export function createRouteHold(doc, { except = () => null } = {}) {
  let held = null;
  let observer = null;
  let timer = null;
  const busy = () => modalOpen(doc, except());

  function check() {
    timer = null;
    if (!held || busy()) return;
    const fn = held;
    held = null;
    if (observer) { observer.disconnect(); observer = null; }
    fn();
  }

  return {
    busy,
    held: () => held !== null,
    run(fn) {
      if (!busy()) {
        fn();
        return true;
      }
      held = fn;
      if (!observer) {
        // A dialog closes by leaving the page (or losing aria-modal). Look once the close is over.
        observer = new MutationObserver(() => {
          if (!timer) timer = setTimeout(check, 0);
        });
        observer.observe(doc.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-modal'] });
      }
      return false;
    },
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
