import { useMediaQuery } from '../../lib/useMediaQuery';

/**
 * The one size scale for windows (1.22, the owner's: "small windows stay narrow; normal forms ~720px;
 * big forms ~960px with two columns; one column on tablets; full screen on phones"). Pick by what the
 * window holds:
 *  - 'confirm': a question and its buttons ("Delete this task?") — 384px.
 *  - 'small':   a short prompt with one or two fields (rename, send back, add people to a company) — 448px.
 *  - 'form':    a normal form or list to work through — 720px.
 *  - 'wide':    a big form — 720px on a tablet (one column), 960px from 1024px with two columns
 *               (`useTwoColumns`): New/Edit task, project, meeting, user, company.
 * Under 640px 'form' and 'wide' fill the screen; 'confirm' and 'small' stay a centred card.
 * A window puts `dialogLayer(size)` on its full-window layer and `dialogPanel(size)` on itself, and
 * adds only its own inner layout (flex column, padding) — never a width.
 */
export type DialogSize = 'confirm' | 'small' | 'form' | 'wide';

/** Where a 'wide' window turns into two columns (Tailwind's `lg`, in em like every breakpoint here). */
export const TWO_COLUMNS_QUERY = '(min-width: 64em)';

/** Is the window wide enough for a big form's two columns? */
export function useTwoColumns(): boolean {
  return useMediaQuery(TWO_COLUMNS_QUERY);
}

const SHEETS: ReadonlySet<DialogSize> = new Set(['form', 'wide']);

const WIDTH: Record<DialogSize, string> = {
  confirm: 'max-w-sm',
  small: 'max-w-md',
  form: 'sm:max-w-[45rem]',
  wide: 'sm:max-w-[45rem] lg:max-w-[60rem]',
};

/**
 * The full-window layer the window sits in (it ends above a phone's on-screen keyboard). `onTop`: a
 * window opened over another window or the task panel (z-60).
 */
export function dialogLayer(size: DialogSize, { onTop = false }: { onTop?: boolean } = {}): string {
  const z = onTop ? 'z-[60]' : 'z-50';
  return SHEETS.has(size)
    ? `above-keyboard fixed inset-0 ${z} flex items-stretch justify-center sm:items-center sm:p-4`
    : `above-keyboard fixed inset-0 ${z} grid place-items-center p-4`;
}

/**
 * The window's own size: its width on the scale and never taller than the visible window. A form on
 * a phone fills the screen — no margin, no rounded corners, no border.
 */
export function dialogPanel(size: DialogSize): string {
  return SHEETS.has(size)
    ? `h-full w-full max-sm:rounded-none max-sm:border-0 sm:h-auto sm:max-h-[calc(var(--visible-height)-2rem)] ${WIDTH[size]}`
    : `w-full max-h-[calc(var(--visible-height)-2rem)] ${WIDTH[size]}`;
}
