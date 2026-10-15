import { fieldScrollDelta, type Span } from './field-scroll';

/**
 * Keeps what someone is typing into visible above a phone's on-screen keyboard.
 *
 * Browsers only nudge the focused box itself into view — flush against the keyboard, without its
 * label or hint, and with the form's buttons left underneath. Once the keyboard has opened, this
 * scrolls the field's area so the field, its label, hint or error, and (when they fit together)
 * the form's buttons sit above the keyboard. It also publishes, on <html>, `--keyboard-inset` (how
 * much of the window the keyboard covers) and `--visible-top` (how far the browser slid the page up
 * to show a field) where the browser doesn't shrink the page for the keyboard (iPhone Safari):
 * dialogs and the chat fit into what is left. Chrome on Android shrinks the page itself
 * (`interactive-widget=resizes-content` in index.html), so there both stay 0.
 */

const MARGIN = 16;
/** A visible area this much shorter than the tallest seen at this width means a keyboard is open. */
const KEYBOARD_MIN = 120;
/** Less than this visible above the keyboard (a phone held sideways) is "cramped": pinned bars let go. */
const CRAMPED_BELOW = 160;
/** For this long after the keyboard opens or a field is focused, a scroll is the browser's own nudge. */
const BROWSER_SETTLES_MS = 1000;
const NO_KEYBOARD_TYPES = new Set(['button', 'checkbox', 'color', 'date', 'datetime-local', 'file', 'hidden', 'image', 'month', 'radio', 'range', 'reset', 'submit', 'time', 'week']);

/** Whether focusing this element brings up an on-screen keyboard. */
export function isTypingField(el: Element | null): el is HTMLElement {
  if (!el) return false;
  if (el instanceof HTMLTextAreaElement) return !el.readOnly && !el.disabled;
  if (el instanceof HTMLInputElement) return !el.readOnly && !el.disabled && !NO_KEYBOARD_TYPES.has(el.type);
  if (!(el instanceof HTMLElement)) return false;
  const editable = el.getAttribute('contenteditable');
  return el.isContentEditable === true || editable === '' || editable === 'true' || editable === 'plaintext-only';
}

/** How much of the window bottom the keyboard covers when the browser doesn't shrink the page. */
export function keyboardInset(): number {
  const vv = window.visualViewport;
  if (!vv || vv.scale > 1.01) return 0; // pinch-zoomed: a smaller viewport, but no keyboard
  return Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
}

/** How far down the window the visible part starts: iPhone Safari slides the page up to show a field. */
export function visibleTop(): number {
  const vv = window.visualViewport;
  if (!vv || vv.scale > 1.01) return 0;
  return Math.max(0, Math.round(vv.offsetTop));
}

/** The visual viewport (what is on screen above the keyboard), in layout-viewport px. */
function screenSpan(): Span {
  const vv = window.visualViewport;
  return vv ? { top: vv.offsetTop, bottom: vv.offsetTop + vv.height } : { top: 0, bottom: window.innerHeight };
}

const spanOf = (el: Element): Span => {
  const r = el.getBoundingClientRect();
  return { top: r.top, bottom: r.bottom };
};
const union = (a: Span, b: Span): Span => ({ top: Math.min(a.top, b.top), bottom: Math.max(a.bottom, b.bottom) });

/** The field with its label and anything describing it (hint, error), when those sit close by. */
function fieldBlock(field: HTMLElement): Span {
  let block = spanOf(field);
  const near = (s: Span) => s.bottom - s.top > 0 && s.top > block.top - 120 && s.bottom < block.bottom + 120;
  const labels = field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement ? Array.from(field.labels ?? []) : [];
  const described = (field.getAttribute('aria-describedby') ?? '')
    .split(/\s+/)
    .map((id) => (id ? document.getElementById(id) : null))
    .filter((el): el is HTMLElement => !!el);
  for (const el of [...labels, ...described]) {
    const s = spanOf(el);
    if (near(s)) block = union(block, s);
  }
  return block;
}

/**
 * The form's buttons: the largest block around its submit button that doesn't hold the field
 * itself (the button row, or the button). Null when the field isn't in a form with one.
 */
function formActions(field: HTMLElement): HTMLElement | null {
  const form = (field as HTMLInputElement).form ?? field.closest('form');
  const submit = form?.querySelector<HTMLElement>('button[type="submit"], input[type="submit"]');
  if (!submit) return null;
  let block: HTMLElement = submit;
  while (block.parentElement && block.parentElement !== form && !block.parentElement.contains(field)) block = block.parentElement;
  return block;
}

const isPinned = (el: Element) => {
  const p = getComputedStyle(el).position;
  return p === 'fixed' || p === 'sticky';
};
/** The fixed or sticky bar (not holding the field) that sits at this point on screen, if any. */
function pinnedAt(x: number, y: number, field: HTMLElement): HTMLElement | null {
  if (typeof document.elementFromPoint !== 'function') return null;
  for (let el = document.elementFromPoint(x, y) as HTMLElement | null; el && el !== document.body; el = el.parentElement) {
    if (el.contains(field)) return null;
    if (isPinned(el)) return el;
  }
  return null;
}

function canScroll(el: Element): boolean {
  const { overflowY } = getComputedStyle(el);
  return (overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay') && el.scrollHeight > el.clientHeight + 1;
}
/** The nearest area that scrolls the field: an inner scroll box, or else the page. */
function scrollerOf(field: HTMLElement): HTMLElement | null {
  for (let el = field.parentElement; el && el !== document.body && el !== document.documentElement; el = el.parentElement) {
    if (canScroll(el)) return el;
  }
  const page = (document.scrollingElement ?? document.documentElement) as HTMLElement;
  return page.scrollHeight > page.clientHeight + 1 ? page : null;
}

/**
 * Scroll so `field` (with its label and hint) — and its form's buttons when both fit — is visible
 * above the keyboard and clear of fixed bars. Returns how far it scrolled.
 */
export function revealField(field: HTMLElement, { smooth = false }: { smooth?: boolean } = {}): number {
  const scroller = scrollerOf(field);
  if (!scroller) return 0;
  const page = scroller === document.scrollingElement || scroller === document.documentElement;
  const screen = screenSpan();
  const visible: Span = page ? { ...screen } : (() => {
    const s = spanOf(scroller);
    return { top: Math.max(s.top, screen.top), bottom: Math.min(s.bottom, screen.bottom) };
  })();

  // Bars pinned over the top or bottom of the visible area (the app's top bar, a sticky footer).
  const x = (() => {
    const r = field.getBoundingClientRect();
    return r.left + Math.min(r.width / 2, 24);
  })();
  const header = pinnedAt(x, visible.top + 1, field);
  if (header) visible.top = Math.max(visible.top, header.getBoundingClientRect().bottom);
  const footer = pinnedAt(x, visible.bottom - 1, field);
  if (footer) visible.bottom = Math.min(visible.bottom, footer.getBoundingClientRect().top);

  // Buttons are only brought along when they scroll with the field: a footer pinned outside the
  // scroll area (or a sticky one) is already on screen.
  const actionsEl = formActions(field);
  const actions = actionsEl && scroller.contains(actionsEl) && !isPinned(actionsEl) && !(footer && footer.contains(actionsEl)) ? spanOf(actionsEl) : null;

  // The field with its label and hint — or just the box itself when those wouldn't fit with it.
  const block = fieldBlock(field);
  const target = block.bottom - block.top + 8 <= visible.bottom - visible.top ? block : spanOf(field);

  const delta = fieldScrollDelta({ visible, field: target, actions, margin: MARGIN });
  if (!delta) return 0;
  const behavior: ScrollBehavior = smooth ? 'smooth' : 'auto';
  if (page) window.scrollBy({ top: delta, behavior });
  else scroller.scrollBy({ top: delta, behavior });
  return delta;
}

/**
 * Starts watching the keyboard for the whole app (call once). Returns a function that stops it.
 */
export function installKeyboardAwareness(): () => void {
  const vv = window.visualViewport;
  const root = document.documentElement;
  let width = window.innerWidth;
  let tallest = vv?.height ?? window.innerHeight;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let open = false;
  let browserMovesUntil = 0;

  const keyboardOpen = () => !!vv && tallest - vv.height >= KEYBOARD_MIN;
  /** Where the visible part of the window is, for dialogs and the chat to fit into (index.css). */
  const publish = () => {
    root.style.setProperty('--keyboard-inset', `${keyboardInset()}px`);
    root.style.setProperty('--visible-top', `${visibleTop()}px`);
  };
  const reducedMotion = () => typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  /** Reveal the focused field once sizes settle; `closing`: also when the keyboard has just gone. */
  const schedule = (closing = false) => {
    clearTimeout(timer);
    // After the keyboard's own animation and the browser's nudge, so the sizes are final.
    timer = setTimeout(() => {
      const el = document.activeElement;
      if (isTypingField(el) && (closing || keyboardOpen())) revealField(el, { smooth: !reducedMotion() });
    }, 150);
  };
  const onViewport = (e: Event) => {
    if (!vv) return;
    if (window.innerWidth !== width) {
      width = window.innerWidth; // rotated: what counts as "full height" changed
      tallest = vv.height;
    }
    tallest = Math.max(tallest, vv.height);
    publish();
    const nowOpen = keyboardOpen();
    const closing = open && !nowOpen;
    open = nowOpen;
    // Layouts that change while typing key off this (index.css): the task panel scrolls as one
    // while it is "open"; when "cramped", dialogs do too and the app's top bar stops sticking.
    const state = !open ? null : vv.height < CRAMPED_BELOW ? 'cramped' : 'open';
    if (state && root.dataset.keyboard !== state) root.dataset.keyboard = state;
    else if (!state && root.dataset.keyboard) delete root.dataset.keyboard;
    // When the keyboard opens, changes or closes — and while the browser slides the page to show
    // the field just after (iPhone) — but not when the person scrolls later (on iPhone that moves
    // the visible part too): they may want to look at something else while typing. When it closes,
    // the layout changes back: keep the field that was being typed in on screen.
    if (!isTypingField(document.activeElement)) return;
    if (e.type === 'resize') {
      browserMovesUntil = Date.now() + BROWSER_SETTLES_MS;
      schedule(closing);
    } else if (Date.now() < browserMovesUntil) schedule();
  };
  const onFocus = (e: FocusEvent) => {
    if (!isTypingField(e.target as Element)) return;
    browserMovesUntil = Date.now() + BROWSER_SETTLES_MS;
    if (keyboardOpen()) schedule(); // moving between fields
  };

  publish();
  vv?.addEventListener('resize', onViewport);
  vv?.addEventListener('scroll', onViewport);
  document.addEventListener('focusin', onFocus);
  return () => {
    clearTimeout(timer);
    delete root.dataset.keyboard;
    vv?.removeEventListener('resize', onViewport);
    vv?.removeEventListener('scroll', onViewport);
    document.removeEventListener('focusin', onFocus);
  };
}
