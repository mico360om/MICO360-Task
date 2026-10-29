import { useCallback, useSyncExternalStore } from 'react';

/**
 * Does the window match a CSS media query right now (e.g. '(min-width: 40em)', the `sm` breakpoint)?
 * Follows changes live. Where the browser can't say (tests, server), `fallback`.
 */
export function useMediaQuery(query: string, fallback = false): boolean {
  const supported = typeof window !== 'undefined' && typeof window.matchMedia === 'function';
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (!supported) return () => {};
      const list = window.matchMedia(query);
      list.addEventListener?.('change', onChange);
      return () => list.removeEventListener?.('change', onChange);
    },
    [query, supported],
  );
  const read = () => (supported ? window.matchMedia(query).matches : fallback);
  return useSyncExternalStore(subscribe, read, () => fallback);
}
