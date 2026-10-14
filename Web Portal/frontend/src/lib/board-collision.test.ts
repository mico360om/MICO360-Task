import { describe, it, expect } from 'vitest';
import type { CollisionDetection } from '@dnd-kit/core';
import { boardCollisionDetection, boardKeyboardCoordinates } from './board-collision';

type Args = Parameters<CollisionDetection>[0];
type Rect = { left: number; top: number; width: number; height: number; right: number; bottom: number };

const rect = (left: number, top: number, width: number, height: number): Rect => ({ left, top, width, height, right: left + width, bottom: top + height });

/** A board: column A (two cards), an EMPTY column B, column C (one card). Columns are 280 wide and 800 tall. */
const RECTS: Record<string, Rect> = {
  colA: rect(0, 0, 280, 800),
  colB: rect(300, 0, 280, 800),
  colC: rect(600, 0, 280, 800),
  T1: rect(10, 60, 260, 70),
  T2: rect(10, 140, 260, 70),
  T3: rect(610, 60, 260, 70),
};
const CARDS = new Set(['T1', 'T2', 'T3']);

function args(active: string, lifted: Rect, pointer: { x: number; y: number } | null): Args {
  return {
    active: { id: active },
    collisionRect: lifted,
    droppableRects: new Map(Object.entries(RECTS)),
    droppableContainers: Object.keys(RECTS).map((id) => ({ id, disabled: false, rect: { current: RECTS[id] }, node: { current: null }, data: { current: CARDS.has(id) ? { sortable: { index: 0 } } : {} } })),
    pointerCoordinates: pointer,
  } as unknown as Args;
}
const over = (a: Args) => boardCollisionDetection(a)[0]?.id;

describe('board collision detection', () => {
  describe('with the keyboard (there is no pointer: the lifted card itself says where it is)', () => {
    it('a card lifted over an empty column lands in that column', () => {
      // Before, the nearest *card* always won — and next to an empty column that is the card being
      // moved, so the drop was ignored.
      expect(over(args('T1', rect(310, 60, 260, 70), null))).toBe('colB');
    });

    it('…also when its old column has other cards nearby', () => {
      expect(over(args('T2', rect(310, 140, 260, 70), null))).toBe('colB');
    });

    it('a card lifted over another card targets that card (to land beside it)', () => {
      expect(over(args('T1', rect(612, 62, 260, 70), null))).toBe('T3');
      expect(over(args('T1', rect(12, 150, 260, 70), null))).toBe('T2');
    });

    it('a card that has not moved is over itself (dropping it changes nothing)', () => {
      expect(over(args('T1', RECTS.T1!, null))).toBe('T1');
    });

    it('over a column but below its cards it targets the column (to land at the end)', () => {
      expect(over(args('T1', rect(610, 400, 260, 70), null))).toBe('colC');
    });
  });

  describe('with a mouse or a finger', () => {
    it('whatever is under the pointer wins, a card before its column', () => {
      expect(over(args('T1', rect(500, 40, 260, 70), { x: 650, y: 90 }))).toBe('T3');
      expect(over(args('T1', rect(200, 300, 260, 70), { x: 440, y: 320 }))).toBe('colB');
    });

    it('between two columns the nearest target is used, never the card being dragged', () => {
      const target = over(args('T1', rect(150, 60, 260, 70), { x: 290, y: 90 }));
      expect(target).toBeDefined();
      expect(target).not.toBe('T1');
    });
  });
});

describe('board keyboard moves: the left and right arrows go straight to the next column', () => {
  type Getter = typeof boardKeyboardCoordinates;
  const press = (code: string, active: string, lifted: Rect) => {
    const containers = Object.keys(RECTS).map((id) => ({ id, disabled: false, rect: { current: RECTS[id] }, node: { current: null }, data: { current: CARDS.has(id) ? { sortable: { index: 0 } } : {} } }));
    const event = { code, preventDefault: () => {} } as unknown as Parameters<Getter>[0];
    const context = { active: { id: active }, collisionRect: lifted, droppableRects: new Map(Object.entries(RECTS)), droppableContainers: { getEnabled: () => containers }, over: null, scrollableAncestors: [] };
    return boardKeyboardCoordinates(event, { active: active, currentCoordinates: { x: lifted.left, y: lifted.top }, context } as unknown as Parameters<Getter>[1]);
  };
  /** Where the lifted card ends up after a key press, as the target the collision rule then reports. */
  const landsOn = (code: string, active: string, from: Rect) => {
    const to = press(code, active, from);
    if (!to) return undefined;
    return over(args(active, rect(to.x, to.y, from.width, from.height), null));
  };

  it('one press of ArrowLeft from the third column reaches the empty second column', () => {
    // dnd-kit's own rule first "moved" the card onto its own column, so the first press did nothing.
    expect(landsOn('ArrowLeft', 'T3', RECTS.T3!)).toBe('colB');
  });

  it('one press of ArrowRight from the first column reaches the empty second column', () => {
    expect(landsOn('ArrowRight', 'T1', RECTS.T1!)).toBe('colB');
  });

  it('into a column that has cards, it lands on the first card (to take its place)', () => {
    expect(landsOn('ArrowLeft', 'T3', rect(310, 60, 260, 70))).toBe('T1'); // from over column B, left again
    expect(landsOn('ArrowRight', 'T1', rect(310, 60, 260, 70))).toBe('T3');
  });

  it('there is nowhere to go past the first or the last column', () => {
    expect(press('ArrowLeft', 'T1', RECTS.T1!)).toBeUndefined();
    expect(press('ArrowRight', 'T3', RECTS.T3!)).toBeUndefined();
  });
});

