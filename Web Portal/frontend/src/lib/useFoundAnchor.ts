import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

/** How long a found element stays marked. */
const MARK_MS = 2500;
/** How long the page is watched for the element to appear (its part may still be loading). */
const LOOK_MS = 5000;
const STEP_MS = 150;

/** Bring an element into view and mark it for a moment (data-found, styled in index.css). */
export function markFound(el: Element): void {
  el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  el.setAttribute('data-found', 'true');
  setTimeout(() => el.removeAttribute('data-found'), MARK_MS);
}

/**
 * 1.23 search's direct links: a result that opens a place on a page (a meeting's note, its final
 * minutes — "#note-…", "#final-minutes") is brought into view and marked once the page has it
 * (`ready`: the page's data has come; the part itself may come a moment later).
 */
export function useFoundAnchor(ready: boolean): void {
  const { hash } = useLocation();
  useEffect(() => {
    if (!ready || !hash || hash.length < 2) return;
    const id = decodeURIComponent(hash.slice(1));
    let waited = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const look = () => {
      const el = document.getElementById(id);
      if (el) return markFound(el);
      waited += STEP_MS;
      if (waited < LOOK_MS) timer = setTimeout(look, STEP_MS);
    };
    timer = setTimeout(look, 0);
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [ready, hash]);
}
