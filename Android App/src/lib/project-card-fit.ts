import { ARCHIVO_BOLD_ADVANCE, PLEX_SEMIBOLD_ADVANCE, textWidthEm } from './font-metrics';

/**
 * Whether a project card's three figures (Open, Overdue, Next due) sit side by side, as the website's
 * card, or one under another (fix pass B5: "Next due" was cut off on a 360 dp phone). Side by side
 * only while every value and every label fits its third of the card at the phone's width and font
 * scale, measured with the faces' real widths; otherwise each figure takes the card's whole width.
 * Pure, so the numbers are tested.
 */
export const PROJECT_CARD_FIT = {
  /** The Projects list's side padding (spacing.lg). */
  pagePadding: 16,
  /** The card's 1 dp border (components/ui/Card). */
  cardBorder: 1,
  /** The two 1 dp lines between the figures. */
  divider: 1,
  /** Each figure's side padding (the website's px-4 is 16; 8 lets "Tomorrow" fit at 360 dp). */
  figurePadding: 8,
  /** The value: Archivo Bold 18 (font-display text-lg font-bold). */
  valueSize: 18,
  /** The label: 11 (text-[11px]), measured in Plex SemiBold — wider than the Regular it is drawn in. */
  labelSize: 11,
} as const;

const LABELS = ['Open', 'Overdue', 'Next due'];

/** The room (dp) a figure's value has in one of the three columns across a screen `width` dp wide. */
export function figureRoom(width: number): number {
  const f = PROJECT_CARD_FIT;
  const column = (width - 2 * f.pagePadding - 2 * f.cardBorder - 2 * f.divider) / 3;
  return column - 2 * f.figurePadding;
}

/** True when every value (and every label) fits its column at this width (dp) and font scale. */
export function figuresFit(values: readonly string[], width: number, fontScale: number): boolean {
  const room = figureRoom(width);
  const valueFits = (v: string) => textWidthEm(v, ARCHIVO_BOLD_ADVANCE) * PROJECT_CARD_FIT.valueSize * fontScale <= room;
  const labelFits = (l: string) => textWidthEm(l, PLEX_SEMIBOLD_ADVANCE) * PROJECT_CARD_FIT.labelSize * fontScale <= room;
  return values.every(valueFits) && LABELS.every(labelFits);
}
