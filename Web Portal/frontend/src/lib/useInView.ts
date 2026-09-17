import { useEffect, useRef, useState } from 'react';

/**
 * Reveal-on-scroll hook. Returns a ref + `inView` flag that flips true once the
 * element scrolls into view (then stops observing). Degrades gracefully: with no
 * IntersectionObserver (e.g. jsdom/tests) it reports visible immediately, so
 * content is never stuck hidden.
 */
export function useInView<T extends HTMLElement = HTMLDivElement>(options?: IntersectionObserverInit) {
  const ref = useRef<T | null>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === 'undefined') {
      setInView(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry?.isIntersecting) {
          setInView(true);
          observer.disconnect();
        }
      },
      { threshold: 0.12, rootMargin: '0px 0px -8% 0px', ...options },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return { ref, inView };
}
