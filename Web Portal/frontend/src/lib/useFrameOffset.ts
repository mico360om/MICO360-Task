import { useLayoutEffect, useState, type RefObject } from 'react';

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
    const measure = () => {
      const wrapper = el.parentElement;
      const main = el.closest('main');
      const below = (main ? parseFloat(getComputedStyle(main).paddingBottom) || 0 : 0) + (wrapper ? parseFloat(getComputedStyle(wrapper).marginBottom) || 0 : 0);
      setOffset(Math.max(0, Math.round(el.getBoundingClientRect().top + window.scrollY + below)));
    };
    measure();
    void document.fonts?.ready.then(measure); // the top bar settles once its fonts are in
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [ref, enabled]);
  return offset;
}
