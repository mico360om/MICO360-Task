/**
 * 1.23.8 Tooltips on every truncation: words cut short with an ellipsis (`truncate`) or clamped to a few
 * lines (`line-clamp-*`) — a task or project name, a person, a file — show in full in a small tooltip:
 *  - on hover, after a moment (unless the browser already shows a `title` there: never two at once);
 *  - at once on keyboard focus, of the cut words or of the control holding them;
 *  - on a long press on a touch screen.
 * Only when the words really are cut. One listener on the document, so every list, card and table has it
 * without writing its own. The tooltip repeats words already on the page (a screen reader reads them in
 * full), so it is hidden from screen readers. Escape, scrolling, moving away or the next touch put it away;
 * the pointer may move onto it to read it. Detailed rows (lib/density) wrap titles instead of cutting them.
 */

export const HOVER_DELAY_MS = 350;
export const LONG_PRESS_MS = 500;
/** How far a finger may move before a long press becomes a swipe. */
const PRESS_SLOP_PX = 10;
/** How many parents up from the pointer or focus to look for cut words. */
const MAX_DEPTH = 6;

const CUT_CLASS = /(^|\s)(truncate|line-clamp-\d|text-ellipsis)(\s|$)/;

function looksCuttable(el: Element): el is HTMLElement {
  if (!(el instanceof HTMLElement) || el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return false;
  if (CUT_CLASS.test(el.getAttribute('class') ?? '')) return true;
  const cs = el.ownerDocument.defaultView?.getComputedStyle(el);
  if (!cs) return false;
  return cs.textOverflow === 'ellipsis' || (cs.webkitLineClamp !== undefined && cs.webkitLineClamp !== '' && cs.webkitLineClamp !== 'none');
}

/** True when the element's words don't all show (cut at its end, or lines clamped below). */
export function isCut(el: HTMLElement): boolean {
  return el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1;
}

const wordsOf = (el: HTMLElement) => (el.textContent ?? '').replace(/\s+/g, ' ').trim();

/** The cut words at a point: the element itself or one of its parents. */
function cutAt(start: EventTarget | null): HTMLElement | null {
  let el = start instanceof Element ? start : null;
  for (let i = 0; el && i < MAX_DEPTH; i++, el = el.parentElement) {
    if (looksCuttable(el) && isCut(el) && wordsOf(el)) return el;
  }
  return null;
}

/** The cut words a focused control holds (itself, or the first inside it). */
function cutWithin(control: EventTarget | null): HTMLElement | null {
  if (!(control instanceof HTMLElement)) return null;
  const own = cutAt(control);
  if (own) return own;
  for (const el of control.querySelectorAll('*')) {
    if (looksCuttable(el) && isCut(el) && wordsOf(el)) return el;
  }
  return null;
}

/** Whether the browser will show its own tooltip there on hover (a `title` on it or a near parent). */
function hasNativeTitle(el: HTMLElement): boolean {
  let p: HTMLElement | null = el;
  for (let i = 0; p && i < MAX_DEPTH; i++, p = p.parentElement) if (p.getAttribute('title')) return true;
  return false;
}

/** Install once (main.tsx). Returns the undo (tests). */
export function installTruncationTips(doc: Document = document): () => void {
  const win = doc.defaultView ?? window;
  let box: HTMLDivElement | null = null;
  let shownFor: HTMLElement | null = null;
  let shownBy: 'pointer' | 'focus' | 'touch' | null = null;
  let hoverTimer: ReturnType<typeof setTimeout> | null = null;
  let pressTimer: ReturnType<typeof setTimeout> | null = null;
  let pressAt: { x: number; y: number } | null = null;

  const clearTimers = () => {
    if (hoverTimer) clearTimeout(hoverTimer);
    if (pressTimer) clearTimeout(pressTimer);
    hoverTimer = pressTimer = null;
  };
  const hide = () => {
    clearTimers();
    box?.remove();
    box = null;
    shownFor = null;
    shownBy = null;
  };
  const show = (el: HTMLElement, by: 'pointer' | 'focus' | 'touch') => {
    const text = wordsOf(el);
    if (!text) return;
    if (!box) {
      box = doc.createElement('div');
      box.setAttribute('data-truncation-tip', '');
      box.setAttribute('aria-hidden', 'true');
      box.className =
        'pointer-events-auto fixed z-[70] max-w-[min(28rem,calc(100vw-1rem))] whitespace-pre-wrap break-words rounded-md bg-ink px-2 py-1 text-xs font-medium leading-snug text-surface shadow-lift';
      box.addEventListener('pointerleave', (e) => {
        if (!(shownFor && e.relatedTarget instanceof Node && shownFor.contains(e.relatedTarget))) hide();
      });
      doc.body.appendChild(box);
    }
    box.textContent = text;
    shownFor = el;
    shownBy = by;
    // Under the words, or above them where there is no room below; inside the window's sides.
    const r = el.getBoundingClientRect();
    const vw = win.innerWidth || doc.documentElement.clientWidth;
    const vh = win.innerHeight || doc.documentElement.clientHeight;
    const w = box.offsetWidth || 0;
    const h = box.offsetHeight || 0;
    const left = Math.max(8, Math.min(r.left, vw - w - 8));
    const below = r.bottom + 6;
    const top = below + h > vh - 8 && r.top - h - 6 > 8 ? r.top - h - 6 : below;
    box.style.left = `${Math.round(left)}px`;
    box.style.top = `${Math.round(top)}px`;
  };

  const onOver = (e: PointerEvent) => {
    if (e.pointerType === 'touch') return;
    if (box && e.target instanceof Node && box.contains(e.target)) return;
    const el = cutAt(e.target);
    if (!el || el === shownFor) return;
    if (hoverTimer) clearTimeout(hoverTimer);
    if (hasNativeTitle(el)) return;
    hoverTimer = setTimeout(() => show(el, 'pointer'), HOVER_DELAY_MS);
  };
  const onOut = (e: PointerEvent) => {
    if (e.pointerType === 'touch') return;
    const to = e.relatedTarget;
    if (to instanceof Node && box?.contains(to)) return;
    if (shownFor && to instanceof Node && shownFor.contains(to)) return;
    if (hoverTimer) clearTimeout(hoverTimer);
    hoverTimer = null;
    // Only the pointer's own tooltip goes; one shown for keyboard focus stays with the focus.
    if (shownBy === 'pointer') hide();
  };
  const onFocus = (e: FocusEvent) => {
    const el = cutWithin(e.target);
    if (el) show(el, 'focus');
    else if (shownFor) hide();
  };
  const onBlur = (e: FocusEvent) => {
    if (shownBy !== 'focus') return;
    const to = e.relatedTarget;
    if (shownFor && to instanceof Node && (shownFor.contains(to) || (to instanceof HTMLElement && to.contains(shownFor)))) return;
    hide();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && box) hide();
  };
  const onTouchStart = (e: TouchEvent) => {
    if (box) hide();
    const el = cutAt(e.target);
    const t = e.touches[0];
    if (!el || !t) return;
    pressAt = { x: t.clientX, y: t.clientY };
    pressTimer = setTimeout(() => show(el, 'touch'), LONG_PRESS_MS);
  };
  const onTouchMove = (e: TouchEvent) => {
    const t = e.touches[0];
    if (!pressTimer || !pressAt || !t) return;
    if (Math.abs(t.clientX - pressAt.x) > PRESS_SLOP_PX || Math.abs(t.clientY - pressAt.y) > PRESS_SLOP_PX) {
      clearTimeout(pressTimer);
      pressTimer = null;
    }
  };
  const onTouchEnd = () => {
    if (pressTimer) clearTimeout(pressTimer);
    pressTimer = null;
  };
  const onScroll = () => {
    if (box) hide();
  };

  doc.addEventListener('pointerover', onOver);
  doc.addEventListener('pointerout', onOut);
  doc.addEventListener('focusin', onFocus);
  doc.addEventListener('focusout', onBlur);
  doc.addEventListener('keydown', onKey);
  doc.addEventListener('touchstart', onTouchStart, { passive: true });
  doc.addEventListener('touchmove', onTouchMove, { passive: true });
  doc.addEventListener('touchend', onTouchEnd);
  doc.addEventListener('touchcancel', onTouchEnd);
  win.addEventListener('scroll', onScroll, true);
  win.addEventListener('resize', onScroll);
  return () => {
    hide();
    doc.removeEventListener('pointerover', onOver);
    doc.removeEventListener('pointerout', onOut);
    doc.removeEventListener('focusin', onFocus);
    doc.removeEventListener('focusout', onBlur);
    doc.removeEventListener('keydown', onKey);
    doc.removeEventListener('touchstart', onTouchStart);
    doc.removeEventListener('touchmove', onTouchMove);
    doc.removeEventListener('touchend', onTouchEnd);
    doc.removeEventListener('touchcancel', onTouchEnd);
    win.removeEventListener('scroll', onScroll, true);
    win.removeEventListener('resize', onScroll);
  };
}
