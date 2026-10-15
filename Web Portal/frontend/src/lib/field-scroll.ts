/**
 * Where to scroll so the field someone is typing in stays in view above a phone's on-screen
 * keyboard — with its label, hint or error, and the form's buttons when they fit too.
 *
 * Shared by the web app and the Android app: `Android App/src/lib/field-scroll.ts` is a copy, and
 * `mentions-copies.test.ts` fails if the two differ.
 */

/** A vertical stretch, in px (or dp) from the top of the window or scroll area. */
export interface Span {
  top: number;
  bottom: number;
}

export interface FieldScrollInput {
  /** The part of the scroll area the user can see: above the keyboard, below any fixed header. */
  visible: Span;
  /** The field with its label, and any hint or error under it. */
  field: Span;
  /** The form's buttons (Save, Send, Cancel…): shown with the field whenever both fit. */
  actions?: Span | null;
  /** Room to keep between what is shown and the edges of the visible area. */
  margin?: number;
}

/**
 * How far to scroll: positive moves the content up (to reveal what is below), negative moves it
 * down, 0 leaves it. The field always wins: the buttons are only brought along when the field and
 * the buttons fit in the visible area together (with less room around them if need be). A field
 * taller than the area shows from its top.
 */
export function fieldScrollDelta({ visible, field, actions, margin = 12 }: FieldScrollInput): number {
  const room = visible.bottom - visible.top;
  if (room <= 0) return 0;
  const padded = (top: number, bottom: number, room = margin): Span => ({ top: top - room, bottom: bottom + room });

  // With the usual room around it if that fits, else with just a little.
  const fitting = (top: number, bottom: number) => [padded(top, bottom), padded(top, bottom, Math.min(margin, 4))].find((s) => s.bottom - s.top <= room);

  let target = fitting(field.top, field.bottom) ?? padded(field.top, field.bottom);
  if (actions) {
    const both = fitting(Math.min(field.top, actions.top), Math.max(field.bottom, actions.bottom));
    if (both) target = both;
  }

  let delta = 0;
  if (target.bottom - target.top > room || target.top < visible.top) delta = target.top - visible.top;
  else if (target.bottom > visible.bottom) delta = target.bottom - visible.bottom;
  return Math.round(delta) || 0; // no -0
}
