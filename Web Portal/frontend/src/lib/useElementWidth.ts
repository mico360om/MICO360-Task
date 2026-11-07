import { useEffect, useState, type RefObject } from 'react';

/**
 * 1.23.8 An element's width in pixels, followed as it changes (a folded menu, a turned tablet); null until it
 * has been measured (or where the browser can't measure: tests).
 */
export function useElementWidth(ref: RefObject<HTMLElement>): number | null {
  const [width, setWidth] = useState<number | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => {
      const w = el.getBoundingClientRect().width;
      setWidth(w > 0 ? Math.round(w) : null);
    };
    read();
    if (typeof ResizeObserver === 'undefined') return;
    const watch = new ResizeObserver(read);
    watch.observe(el);
    return () => watch.disconnect();
  }, [ref]);
  return width;
}

/** The window's height in pixels, followed as it changes (900 where there is no window). */
export function useWindowHeight(): number {
  const [h, setH] = useState(() => (typeof window !== 'undefined' && window.innerHeight > 0 ? window.innerHeight : 900));
  useEffect(() => {
    const on = () => setH(window.innerHeight);
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return h;
}
