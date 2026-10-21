import { describe, it, expect, vi } from 'vitest';
import { ApiError, NetworkError } from './api-client';
import { WaitingBehindError } from './write-order';
import { BOARD_TEXT, moveCard, reorderCards, taskMovePayload } from './board-writes';

const kept = (e: Error) => Object.assign(e, { [Symbol.for('mico360.keptOnPhone')]: true });

describe('moving a card on the board (4b): the move, then the column’s order, as the website does', () => {
  const plan = { index: 1, orderedIds: ['a', 'x', 'b'], at: 0.5 };

  it('moves the card with its place, then sends the column’s new order', async () => {
    const calls: unknown[][] = [];
    const deps = { move: vi.fn(async (...a: unknown[]) => void calls.push(['move', ...a])), reorder: vi.fn(async (...a: unknown[]) => void calls.push(['reorder', ...a])) };
    expect(await moveCard(deps, { id: 'x', toColumnId: 'c2', plan })).toEqual({ kind: 'moved' });
    expect(calls).toEqual([
      ['move', 'x', 'c2', 1, 0.5],
      ['reorder', 'c2', ['a', 'x', 'b']],
    ]);
  });

  it('a card alone in its new column needs no order', async () => {
    const deps = { move: vi.fn(async () => {}), reorder: vi.fn(async () => {}) };
    await moveCard(deps, { id: 'x', toColumnId: 'c2', plan: { index: 0, orderedIds: ['x'], at: 0 } });
    expect(deps.reorder).not.toHaveBeenCalled();
  });

  it('offline the move is kept on the phone with its place (the order goes when it is sent); a refusal puts the card back', async () => {
    const offline = { move: vi.fn(async () => Promise.reject(kept(new NetworkError('Network request failed.')))), reorder: vi.fn(async () => {}) };
    // Its place among other cards may change when it syncs (4b review #8).
    expect(await moveCard(offline, { id: 'x', toColumnId: 'c2', plan })).toEqual({ kind: 'kept', message: `Saved on this phone — will sync when you’re online. ${BOARD_TEXT.placeMayChange}` });
    expect(offline.reorder).not.toHaveBeenCalled();
    const behind = { move: vi.fn(async () => Promise.reject(new WaitingBehindError())), reorder: vi.fn(async () => {}) };
    expect((await moveCard(behind, { id: 'x', toColumnId: 'c2', plan })).kind).toBe('kept');
    const refused = { move: vi.fn(async () => Promise.reject(new ApiError(403, 'FORBIDDEN', 'You do not have permission to do that.'))), reorder: vi.fn(async () => {}) };
    // The server's reason is said (4b review #9).
    expect(await moveCard(refused, { id: 'x', toColumnId: 'c2', plan })).toEqual({ kind: 'refused', message: 'Couldn’t move that task — it was put back. You do not have permission to do that.' });
  });

  it('moved, but its place not saved (the connection went): it says so', async () => {
    const deps = { move: vi.fn(async () => {}), reorder: vi.fn(async () => Promise.reject(new NetworkError('Network request failed.'))) };
    expect(await moveCard(deps, { id: 'x', toColumnId: 'c2', plan })).toEqual({ kind: 'order-not-saved', message: BOARD_TEXT.orderNotSaved });
  });
});

describe('changing a card’s place in its own column (4b)', () => {
  it('sends the new order; it needs a connection, as on the website — offline or refused, the card goes back', async () => {
    const ok = { reorder: vi.fn(async () => {}) };
    expect(await reorderCards(ok, { columnId: 'c1', orderedIds: ['b', 'a'] })).toEqual({ kind: 'done' });
    expect(ok.reorder).toHaveBeenCalledWith('c1', ['b', 'a']);
    const offline = { reorder: vi.fn(async () => Promise.reject(new NetworkError('Network request failed.'))) };
    expect(await reorderCards(offline, { columnId: 'c1', orderedIds: ['b', 'a'] })).toEqual({ kind: 'put-back', message: BOARD_TEXT.orderNeedsConnection });
    const refused = { reorder: vi.fn(async () => Promise.reject(new ApiError(403, 'FORBIDDEN', 'x'))) };
    expect(await reorderCards(refused, { columnId: 'c1', orderedIds: ['b', 'a'] })).toEqual({ kind: 'put-back', message: 'Couldn’t move that task — it was put back. x' });
  });

  it('in the website’s words', () => {
    expect(BOARD_TEXT.moveRefused).toBe('Couldn’t move that task — it was put back. Please try again.');
    expect(BOARD_TEXT.orderNeedsConnection).toBe('Changing the order needs a connection — the card was put back.');
    expect(BOARD_TEXT.orderNotSaved).toBe('Moved. Its place in the column wasn’t saved — check your connection, then place it again.');
  });
});

describe('what a move kept on this phone carries (4c)', () => {
  it('its task, column, place and project — and the status of its column, so every board shows it there meanwhile', () => {
    expect(taskMovePayload({ id: 't1', columnId: 'd1', projectId: 'p1', category: 'DONE' })).toEqual({ id: 't1', columnId: 'd1', position: undefined, projectId: 'p1', category: 'DONE' });
    expect(taskMovePayload({ id: 't1', columnId: 'c2', position: 2, projectId: 'p1', at: 1.5 })).toEqual({ id: 't1', columnId: 'c2', position: 2, projectId: 'p1', at: 1.5 });
  });
});
