import { useCallback, useEffect, useState } from 'react';

type Metrics = { scrollLeft: number; scrollWidth: number; clientWidth: number };

/** Where a row that scrolls sideways hides more: at its end, its start, both, or nowhere (it all fits). */
export type MoreSides = 'none' | 'start' | 'end' | 'both';

export function moreSides({ scrollLeft, scrollWidth, clientWidth }: Metrics): MoreSides {
  const start = scrollLeft > 1;
  const end = scrollLeft + clientWidth < scrollWidth - 1;
  return start && end ? 'both' : start ? 'start' : end ? 'end' : 'none';
}

/** Scrolls `el` into view within `row` (sideways only — never the page), `pad` clear of a faded edge. */
export function revealInRow(row: Metrics & { scrollTo?: (o: { left: number; behavior?: ScrollBehavior }) => void }, el: { offsetLeft: number; offsetWidth: number }, pad = 32): void {
  const start = el.offsetLeft - pad;
  const end = el.offsetLeft + el.offsetWidth + pad;
  let left: number | null = null;
  if (start < row.scrollLeft) left = Math.max(0, start);
  else if (end > row.scrollLeft + row.clientWidth) left = end - row.clientWidth;
  if (left === null) return;
  const smooth = typeof window !== 'undefined' && typeof window.matchMedia === 'function' && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (row.scrollTo) row.scrollTo({ left, behavior: smooth ? 'smooth' : 'auto' });
  else row.scrollLeft = left;
}

/**
 * A row of controls that scrolls sideways (the Projects page's status tabs on a phone): `more` says
 * on which side more is hidden (for the edge fade, index.css .scroll-row), kept up to date as it is
 * scrolled or it (or a control in it) changes size. `ref` is a callback ref, so a row shown later
 * (after loading) is followed too.
 */
export function useScrollRow<T extends HTMLElement>() {
  const [el, setEl] = useState<T | null>(null);
  const [more, setMore] = useState<MoreSides>('none');
  useEffect(() => {
    if (!el) return;
    const measure = () => setMore(moreSides(el));
    measure();
    el.addEventListener('scroll', measure, { passive: true });
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    if (ro) for (const node of [el, ...Array.from(el.children)]) ro.observe(node);
    return () => {
      el.removeEventListener('scroll', measure);
      ro?.disconnect();
    };
  }, [el]);
  const ref = useCallback((node: T | null) => setEl(node), []);
  return { ref, el, more };
}
