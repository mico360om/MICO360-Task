import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';

/**
 * A link to a page's section (`/settings#notifications`): once the page is `ready` (its content
 * loaded, so nothing moves after), bring the element with that id into view — once per visit.
 */
export function useScrollToHash(id: string, ready = true): void {
  const { hash } = useLocation();
  const done = useRef(false);
  useEffect(() => {
    if (!ready || done.current || hash !== `#${id}`) return;
    done.current = true;
    document.getElementById(id)?.scrollIntoView?.({ block: 'start' });
  }, [hash, id, ready]);
}
