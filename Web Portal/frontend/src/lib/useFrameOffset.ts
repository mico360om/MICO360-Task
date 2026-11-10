import { useLayoutEffect, useState, type RefObject } from 'react';

/** The page's bottom padding under a window-sized page: its <main>'s padding and its wrapper's margin. */
function spaceBelow(page: HTMLElement): number {
  const wrapper = page.parentElement;
  const main = page.closest('main');
  return (main ? parseFloat(getComputedStyle(main).paddingBottom) || 0 : 0) + (wrapper ? parseFloat(getComputedStyle(wrapper).marginBottom) || 0 : 0);
}

/**
 * How far down the page an element starts, plus the page's bottom padding: a page sized to the
 * window (the chat, the calendar) is the window's height less that, so it fills the screen without
 * the page itself scrolling. Measured, because the top bar's height depends on what it holds.
 * Null until measured, and while `enabled` is false.
 */
export function useFrameOffset(ref: RefObject<HTMLElement | null>, enabled = true): number | null {
  const [offset, setOffset] = useState<number | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !enabled) {
      setOffset(null);
      return;
    }
    const measure = () => setOffset(Math.max(0, Math.round(el.getBoundingClientRect().top + window.scrollY + spaceBelow(el))));
    measure();
    void document.fonts?.ready.then(measure); // the top bar settles once its fonts are in
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [ref, enabled]);
  return offset;
}

/**
 * 1.23.8 How much height a part of a window-sized page (`frame`) would get, from where it starts to the window's
 * bottom, less the page's bottom padding and the page footer (--app-footer-space). It does not depend on whether
 * the page fills the window (what is above the part is the same either way), so a page can use it to decide.
 * Measured again when the window changes or anything above the part changes height (summary cards wrapping onto
 * a second row). Null until measured, and while `enabled` is false.
 */
export function useRoomBelow(ref: RefObject<HTMLElement | null>, frame: RefObject<HTMLElement | null>, enabled = true): number | null {
  const [room, setRoom] = useState<number | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !enabled) {
      setRoom(null);
      return;
    }
    const measure = () => {
      const footer = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--app-footer-space')) || 0;
      const below = frame.current ? spaceBelow(frame.current) : 0;
      setRoom(Math.round(window.innerHeight - (el.getBoundingClientRect().top + window.scrollY) - below - footer));
    };
    measure();
    void document.fonts?.ready.then(measure);
    window.addEventListener('resize', measure);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => measure());
    for (let above = el.previousElementSibling; above; above = above.previousElementSibling) observer?.observe(above);
    return () => {
      window.removeEventListener('resize', measure);
      observer?.disconnect();
    };
  }, [ref, frame, enabled]);
  return room;
}
