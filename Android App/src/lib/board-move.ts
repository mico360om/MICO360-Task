import type { ApiColumn } from './types';

/**
 * Columns a card can be moved to from the board's "Move to…" sheet (long-press a card): the
 * shown columns other than its own, in board order.
 */
export function moveTargets(columns: ApiColumn[], currentColumnId: string): ApiColumn[] {
  return columns.filter((c) => c.enabled !== false && c.id !== currentColumnId).sort((a, b) => a.position - b.position);
}

// ── Where a card goes in a column (4b) ───────────────────────────────────────
//
// The phone has no drag and drop (no gesture library), so the board's long-press sheet says where
// a card goes: up or down one, to the top or the bottom of its column, or into another column at
// the top, after a chosen card, or at the bottom — the places a drop on the website's board gives.
// The new order is what the website sends after a drop (PUT /columns/:id/tasks/reorder).

/** Where in a column: the top, the bottom, or straight after one of its cards. */
export type Place = 'top' | 'bottom' | { after: string };

type Placed = { id: string };

/** The column's order with `taskId` put at `place` — null when it is there already (nothing to send). */
export function placeOrder(columnTasks: readonly Placed[], taskId: string, place: Place): string[] | null {
  const ids = columnTasks.map((t) => t.id);
  const rest = ids.filter((id) => id !== taskId);
  let at: number;
  if (place === 'top') at = 0;
  else if (place === 'bottom') at = rest.length;
  else {
    const i = rest.indexOf(place.after);
    at = i === -1 ? rest.length : i + 1;
  }
  const next = [...rest.slice(0, at), taskId, ...rest.slice(at)];
  return next.length === ids.length && next.every((id, i) => id === ids[i]) ? null : next;
}

/** One step up (-1) or down (+1) in its own column — null at the edge. */
export function stepOrder(columnTasks: readonly Placed[], taskId: string, step: -1 | 1): string[] | null {
  const ids = columnTasks.map((t) => t.id);
  const from = ids.indexOf(taskId);
  const to = from + step;
  if (from === -1 || to < 0 || to >= ids.length) return null;
  const next = [...ids];
  next.splice(from, 1);
  next.splice(to, 0, taskId);
  return next;
}

/**
 * A move into another column at `place`: the column's new order (sent after the move, as the
 * website does), the card's index in it (the move's own position, for a move kept offline that
 * goes without the order), and where it shows meanwhile (`at`: between its new neighbours).
 */
export function movePlan(destTasks: readonly (Placed & { position: number })[], taskId: string, place: Place): { index: number; orderedIds: string[]; at: number } {
  const orderedIds = placeOrder(destTasks, taskId, place) ?? destTasks.map((t) => t.id);
  const index = orderedIds.indexOf(taskId);
  const before = index > 0 ? destTasks.find((t) => t.id === orderedIds[index - 1]) : undefined;
  const after = index < orderedIds.length - 1 ? destTasks.find((t) => t.id === orderedIds[index + 1]) : undefined;
  const at = before && after ? (before.position + after.position) / 2 : before ? before.position + 1 : after ? after.position - 1 : 0;
  return { index, orderedIds, at };
}

/**
 * The places offered for a card in a column, in words: the top, after each card, the bottom. The
 * card itself, and a place that changes nothing (where it is now in its own column), are left out.
 */
export function placeChoices(columnTasks: readonly (Placed & { key: string; title: string })[], taskId: string): { place: Place; label: string }[] {
  const out: { place: Place; label: string }[] = [];
  const offer = (place: Place, label: string) => {
    if (columnTasks.some((t) => t.id === taskId) && !placeOrder(columnTasks, taskId, place)) return;
    out.push({ place, label });
  };
  offer('top', 'At the top');
  const others = columnTasks.filter((t) => t.id !== taskId);
  // After the last card is the bottom: said once.
  others.slice(0, -1).forEach((t) => offer({ after: t.id }, `After ${t.key} · ${t.title}`));
  if (others.length > 0) offer('bottom', 'At the bottom');
  return out;
}

/** The places whose words hold what was typed (a long column's "after a card" list — 4b review #11). */
export function findPlaces<T extends { label: string }>(places: readonly T[], q: string): T[] {
  const needle = q.trim().toLowerCase();
  return needle ? places.filter((p) => p.label.toLowerCase().includes(needle)) : [...places];
}

/** A column's cards in a new order, at once (each one's place is its index), before the server answers. */
export function withOrder<T extends { id: string; columnId: string; position: number }>(tasks: readonly T[], columnId: string, orderedIds: readonly string[]): T[] {
  const index = new Map(orderedIds.map((id, i) => [id, i]));
  return tasks.map((t) => (t.columnId === columnId && index.has(t.id) ? { ...t, position: index.get(t.id)! } : t));
}
