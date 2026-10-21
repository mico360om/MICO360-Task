import { describe, it, expect } from 'vitest';
import { moveTargets, movePlan, placeChoices, placeOrder, stepOrder, withOrder } from './board-move';
import type { ApiColumn } from './types';

const col = (id: string, position: number, enabled = true): ApiColumn => ({ id, projectId: 'p', name: id, category: 'TODO', position, color: '#000', enabled });

describe('moveTargets', () => {
  it('lists the other enabled columns in board order', () => {
    const cols = [col('done', 4), col('todo', 1), col('backlog', 0), col('hidden', 2, false), col('review', 3)];
    expect(moveTargets(cols, 'todo').map((c) => c.id)).toEqual(['backlog', 'review', 'done']);
  });
});

describe('moving a card to a chosen place (4b)', () => {
  const t = (id: string, position: number) => ({ id, key: `MICO-${id}`, title: `Task ${id}`, position });
  const column = [t('a', 0), t('b', 1), t('c', 2)];

  it('in its own column: up, down, to the top or the bottom — nothing at an edge', () => {
    expect(stepOrder(column, 'b', -1)).toEqual(['b', 'a', 'c']);
    expect(stepOrder(column, 'b', 1)).toEqual(['a', 'c', 'b']);
    expect(stepOrder(column, 'a', -1)).toBeNull();
    expect(stepOrder(column, 'c', 1)).toBeNull();
    expect(placeOrder(column, 'c', 'top')).toEqual(['c', 'a', 'b']);
    expect(placeOrder(column, 'a', 'bottom')).toEqual(['b', 'c', 'a']);
    expect(placeOrder(column, 'a', { after: 'b' })).toEqual(['b', 'a', 'c']);
    // Already there: no change to send.
    expect(placeOrder(column, 'a', 'top')).toBeNull();
    expect(placeOrder(column, 'b', { after: 'a' })).toBeNull();
  });

  it('into another column at the top, after a card, or at the bottom: the new order, its place and where it shows meanwhile', () => {
    expect(movePlan(column, 'x', 'top')).toEqual({ index: 0, orderedIds: ['x', 'a', 'b', 'c'], at: -1 });
    expect(movePlan(column, 'x', { after: 'a' })).toEqual({ index: 1, orderedIds: ['a', 'x', 'b', 'c'], at: 0.5 });
    expect(movePlan(column, 'x', 'bottom')).toEqual({ index: 3, orderedIds: ['a', 'b', 'c', 'x'], at: 3 });
    expect(movePlan([], 'x', 'bottom')).toEqual({ index: 0, orderedIds: ['x'], at: 0 });
    // A card named that isn't there (it moved meanwhile): the bottom.
    expect(movePlan(column, 'x', { after: 'gone' })).toMatchObject({ index: 3 });
  });

  it('offers the places in words: the top, after each card, the bottom', () => {
    expect(placeChoices(column, 'x').map((p) => p.label)).toEqual(['At the top', 'After MICO-a · Task a', 'After MICO-b · Task b', 'At the bottom']);
    // In its own column the card itself isn't offered, nor the place it is in already.
    expect(placeChoices(column, 'b').map((p) => p.label)).toEqual(['At the top', 'At the bottom']);
    expect(placeChoices([], 'x').map((p) => p.label)).toEqual(['At the top']);
  });

  it('lays a new order over the cards at once (each card’s place in the column)', () => {
    const tasks = [
      { id: 'a', columnId: 'c1', position: 0 },
      { id: 'b', columnId: 'c1', position: 1 },
      { id: 'z', columnId: 'c2', position: 0 },
    ];
    expect(withOrder(tasks, 'c1', ['b', 'a'])).toEqual([
      { id: 'a', columnId: 'c1', position: 1 },
      { id: 'b', columnId: 'c1', position: 0 },
      { id: 'z', columnId: 'c2', position: 0 },
    ]);
  });
});
