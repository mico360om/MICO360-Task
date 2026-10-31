import { PLEX_SEMIBOLD_ADVANCE, textWidthEm } from './font-metrics';

/**
 * How many StatTiles a grid puts in a row (Dashboard, Reports, the administrators' totals; Stage 2's
 * DashboardTiles too): two only when every tile's label fits a half-width tile at the phone's width
 * and font scale — on the label's two lines, no word cut — else one per row, so a large font never
 * cuts a label. Pure, measured with Plex SemiBold's real widths at the eyebrow size.
 */
export const STAT_GRID = {
  /** The page's side padding (spacing.lg) and the gap between tiles (spacing.sm). */
  pagePadding: 16,
  gap: 8,
  /** Card: 1 dp border + 16 dp padding each side. */
  cardInset: 17,
  /** The icon bubble (40 dp) and its 12 dp gap. */
  bubble: 52,
  /** typeStyle('eyebrow'): 11 dp, letter spacing 0.55, upper case, at most 2 lines. */
  labelSize: 11,
  labelSpacing: 0.55,
  labelLines: 2,
} as const;

/** The room a label has in one of two tiles side by side across a screen `width` dp wide. */
export function statLabelRoom(width: number): number {
  const g = STAT_GRID;
  const tile = (width - 2 * g.pagePadding - g.gap) / 2;
  return tile - 2 * g.cardInset - g.bubble;
}

/** Width in dp of `text` as the eyebrow label draws it (both scale with the font scale on Android). */
function labelWidth(text: string, fontScale: number): number {
  const upper = text.toUpperCase();
  return (textWidthEm(upper, PLEX_SEMIBOLD_ADVANCE) * STAT_GRID.labelSize + [...upper].length * STAT_GRID.labelSpacing) * fontScale;
}

/** Whether `label` fits `room` dp in at most two lines, wrapping between words and cutting none. */
export function statLabelFits(label: string, room: number, fontScale: number): boolean {
  let lines = 1;
  let line = '';
  for (const word of label.trim().split(/\s+/)) {
    if (labelWidth(word, fontScale) > room) return false;
    const next = line ? `${line} ${word}` : word;
    if (labelWidth(next, fontScale) <= room) line = next;
    else {
      lines += 1;
      line = word;
    }
  }
  return lines <= STAT_GRID.labelLines;
}

/** 2 when every label fits a half-width tile at this width (dp) and font scale, else 1. */
export function statTileColumns(labels: readonly string[], width: number, fontScale: number): 1 | 2 {
  const room = statLabelRoom(width);
  return labels.every((l) => statLabelFits(l, room, fontScale)) ? 2 : 1;
}
