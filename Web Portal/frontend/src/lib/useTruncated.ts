import { useLayoutEffect, useRef, useState } from 'react';

/**
 * Is this one-line text cut short (an ellipsis)? For a tooltip with the whole text only when it
 * is needed. Measured after each change of `text` and whenever the element is resized.
 */
export function useTruncated<T extends HTMLElement>(text: unknown): [React.RefObject<T>, boolean] {
  const ref = useRef<T>(null);
  const [cut, setCut] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setCut(el.scrollWidth > el.clientWidth + 1);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const watch = new ResizeObserver(measure);
    watch.observe(el);
    return () => watch.disconnect();
  }, [text]);
  return [ref, cut];
}
