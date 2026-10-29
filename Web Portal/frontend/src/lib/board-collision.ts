import { closestCorners, pointerWithin, type CollisionDetection, type KeyboardCoordinateGetter } from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';

/**
 * Which card or column a dragged card is over.
 *
 * `closestCenter` mis-picks columns of unequal height (a short or empty neighbour's centre can be
 * nearer than the tall column you are actually over), dropping cards in the wrong column. Instead,
 * whatever lies under the pointer wins — a card before its column, so reordering inside a column
 * still gets a target.
 *
 * The keyboard has no pointer: the middle of the lifted card stands in for it. (Falling back to "the
 * nearest card" instead picked the card being moved whenever it was lifted over an EMPTY column —
 * there is no other card nearby — so the drop was ignored.)
 *
 * When nothing is under that point (the gap between two columns), the nearest target is used, never
 * the dragged card itself.
 */
export const boardCollisionDetection: CollisionDetection = (args) => {
  const isCard = (id: unknown) => args.droppableContainers.find((d) => d.id === id)?.data.current?.sortable != null;
  const { collisionRect } = args;
  const point = args.pointerCoordinates ?? { x: collisionRect.left + collisionRect.width / 2, y: collisionRect.top + collisionRect.height / 2 };

  // A card scrolled out of its column's scroll area (the board fitted to the window) still has a
  // rect, over the column's header or the page above: it is not under the pointer for real.
  const inView = (id: unknown) => {
    const node = args.droppableContainers.find((d) => d.id === id)?.node.current;
    const area = node?.closest?.('[data-column-scroll]');
    if (!area) return true;
    const r = area.getBoundingClientRect();
    return point.x >= r.left && point.x <= r.right && point.y >= r.top && point.y <= r.bottom;
  };
  const under = pointerWithin({ ...args, pointerCoordinates: point }).filter((c) => !isCard(c.id) || inView(c.id));
  if (under.length > 0) {
    const card = under.find((c) => isCard(c.id));
    return card ? [card] : under;
  }
  const nearest = closestCorners(args).filter((c) => c.id !== args.active.id);
  const card = nearest.find((c) => isCard(c.id));
  return card ? [card] : nearest;
};

/** Room left above a card dropped into an empty column (its header). */
const COLUMN_HEADER_PX = 56;

/**
 * Where an arrow key takes a lifted card.
 *
 * Up and down step through the cards of a column (dnd-kit's own rule). Left and right go straight
 * to the neighbouring column: onto its first card (to take that place), or into the column when it
 * is empty. dnd-kit's rule looks for "the nearest droppable to the left", and the nearest one is the
 * card's OWN column, a few pixels wider than the card — so the first press appeared to do nothing.
 */
export const boardKeyboardCoordinates: KeyboardCoordinateGetter = (event, args) => {
  if (event.code !== 'ArrowLeft' && event.code !== 'ArrowRight') return sortableKeyboardCoordinates(event, args);
  const { active, collisionRect, droppableRects, droppableContainers } = args.context;
  if (!active || !collisionRect) return undefined;
  event.preventDefault();

  const all = droppableContainers.getEnabled().map((c) => ({ id: c.id, card: c.data.current?.sortable != null, rect: droppableRects.get(c.id) }));
  const columns = all.filter((c) => !c.card && c.rect).sort((a, b) => a.rect!.left - b.rect!.left);
  const centre = collisionRect.left + collisionRect.width / 2;
  const at = columns.findIndex((c) => centre >= c.rect!.left && centre <= c.rect!.right);
  if (at < 0) return undefined;
  const next = columns[at + (event.code === 'ArrowRight' ? 1 : -1)]?.rect;
  if (!next) return undefined;

  const firstCard = all
    .filter((c) => c.card && c.rect && c.id !== active.id && c.rect.left >= next.left - 1 && c.rect.right <= next.right + 1)
    .map((c) => c.rect!)
    .sort((a, b) => a.top - b.top)[0];
  if (firstCard) return { x: firstCard.left, y: firstCard.top };
  return { x: next.left + (next.width - collisionRect.width) / 2, y: next.top + COLUMN_HEADER_PX };
};

