/**
 * The shared steps of compact rows (1.23.0) — the classes the lists, tables and boards use, so no
 * piece invents its own compact size. Only class names here (no imports): small UI pieces such as
 * the Avatar use them without pulling in the settings code. The whole design: lib/density.ts.
 */

/** The per-person name of the choice on this device (lib/user-storage; kept across sign-out). */
export const DENSITY_PREF = 'density';

/** Where compact can show: the `compact:` variant's media (tailwind.config.js). */
export const COMPACT_MEDIA = '(min-width: 48em) and (pointer: fine)';

/** A row's text, one step smaller in compact (14px → 13px, with an 18px line). */
export const DENSE_TEXT = 'compact:text-row';
/** A face in a row (and its "+2" bubble): 24px → 20px in compact. */
export const DENSE_FACE = 'compact:h-5 compact:w-5';
/** Overlapping faces in a row: 2px over each other in compact (6px hid the second letter of 20px faces). */
export const DENSE_STACK = 'compact:-space-x-0.5';
