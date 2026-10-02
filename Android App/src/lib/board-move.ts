import type { ApiColumn } from './types';

/**
 * Columns a card can be moved to from the board's "Move to…" sheet (long-press a card): the
 * enabled columns other than its own, in board order.
 */
export function moveTargets(columns: ApiColumn[], currentColumnId: string): ApiColumn[] {
  return columns.filter((c) => c.enabled && c.id !== currentColumnId).sort((a, b) => a.position - b.position);
}
