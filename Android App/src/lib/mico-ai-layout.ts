import { cellDisplay } from './mico-ai';
import type { MicoAiTable } from './mico-ai-api';

/**
 * MICO AI's widths on the phone (final review A10): a table's columns and the card's "before → after"
 * labels grow with the phone's font size, so large text wraps inside its column instead of being cut.
 */

/** Roughly how wide one letter of the body text is at the normal size (IBM Plex Sans, 14 dp). */
const LETTER = 7.5;
/** A cell's padding on both sides (it doesn't grow with the font). */
const PADDING = 28;

/**
 * A column's width from what it holds (the website lets the browser size its table): short phrases
 * stay on one line, longer text gets a readable width and wraps. A larger font widens it.
 */
export function answerColumnWidth(table: MicoAiTable, col: number, fontScale: number): number {
  const scale = Math.max(1, fontScale);
  const kind = table.columns[col]?.kind;
  const longest = Math.max(table.columns[col]?.label.length ?? 0, ...table.rows.map((r) => cellDisplay(kind, r.cells[col] ?? null).length));
  return Math.round(Math.min(Math.max(longest * LETTER * scale + PADDING, 72 * scale), 260 * scale));
}

/** The width of the labels' column in a change's "before → after" rows. */
export const changeLabelWidth = (fontScale: number): number => Math.round(64 * Math.max(1, fontScale));
