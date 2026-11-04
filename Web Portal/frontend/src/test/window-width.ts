import { vi } from 'vitest';

/**
 * Pretends the window is `px` wide: matchMedia answers min-width / max-width queries in px or em
 * (16px each, as Tailwind's breakpoints here); anything else is false. Undo with vi.unstubAllGlobals().
 */
export function windowWidth(px: number): void {
  vi.stubGlobal('matchMedia', (query: string) => {
    const size = (m: RegExpExecArray | null) => (m ? Number(m[1]) * (m[2] === 'em' ? 16 : 1) : null);
    const min = size(/min-width:\s*([\d.]+)(px|em)/.exec(query));
    const max = size(/max-width:\s*([\d.]+)(px|em)/.exec(query));
    const matches = min !== null ? px >= min : max !== null ? px <= max : false;
    return { matches, media: query, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false };
  });
}
