/**
 * The board's moves (4b), as the website sends a drop: the move (through the app's task write
 * path — its lane, its version, kept on the phone when there is no answer), then the column's new
 * order (PUT /columns/:id/tasks/reorder). A change of order inside a column needs a connection, as
 * on the website (a refused or unsent one puts the card back). Pure (the requests come in), so it is
 * tested here.
 */
import { isNetworkError } from './api-client';
import { keptOnPhoneText } from './write-order';

export const BOARD_TEXT = {
  moveRefused: 'Couldn’t move that task — it was put back. Please try again.',
  orderNeedsConnection: 'Changing the order needs a connection — the card was put back.',
  orderNotSaved: 'Moved. Its place in the column wasn’t saved — check your connection, then place it again.',
} as const;

export type MoveOutcome =
  | { kind: 'moved' }
  /** No answer, or behind an earlier change: kept on this phone with its place, sent later. */
  | { kind: 'kept'; message: string }
  /** Moved, but the column's new order didn't go. */
  | { kind: 'order-not-saved'; message: string }
  /** The server refused it: the card goes back. */
  | { kind: 'refused'; message: string };

export interface MoveDeps {
  /** The task write path's move: (task, column, its index there, where it shows meanwhile). */
  move: (id: string, columnId: string, position: number, at: number) => Promise<unknown>;
  reorder: (columnId: string, orderedIds: string[]) => Promise<unknown>;
}

/**
 * What a task's move carries through the write path, and kept on this phone when it gets no answer:
 * the task, its column and place there, its project (the replay refreshes that project's board
 * days), where it shows meanwhile (`at`, 4b) and the kind of its new column (`category`, 4c) — so a
 * move kept offline shows under its new status on the All projects board too.
 */
export function taskMovePayload(v: { id: string; columnId: string; position?: number; projectId: string; at?: number; category?: string | null }): Record<string, unknown> {
  return { id: v.id, columnId: v.columnId, position: v.position, projectId: v.projectId, ...(v.at !== undefined ? { at: v.at } : {}), ...(v.category ? { category: v.category } : {}) };
}

export async function moveCard(deps: MoveDeps, req: { id: string; toColumnId: string; plan: { index: number; orderedIds: string[]; at: number } }): Promise<MoveOutcome> {
  try {
    await deps.move(req.id, req.toColumnId, req.plan.index, req.plan.at);
  } catch (e) {
    if (isNetworkError(e)) return { kind: 'kept', message: keptOnPhoneText(e) };
    return { kind: 'refused', message: BOARD_TEXT.moveRefused };
  }
  if (req.plan.orderedIds.length < 2) return { kind: 'moved' };
  try {
    await deps.reorder(req.toColumnId, req.plan.orderedIds);
    return { kind: 'moved' };
  } catch {
    return { kind: 'order-not-saved', message: BOARD_TEXT.orderNotSaved };
  }
}

export async function reorderCards(deps: Pick<MoveDeps, 'reorder'>, req: { columnId: string; orderedIds: string[] }): Promise<{ kind: 'done' } | { kind: 'put-back'; message: string }> {
  try {
    await deps.reorder(req.columnId, req.orderedIds);
    return { kind: 'done' };
  } catch (e) {
    return { kind: 'put-back', message: isNetworkError(e) ? BOARD_TEXT.orderNeedsConnection : BOARD_TEXT.moveRefused };
  }
}
