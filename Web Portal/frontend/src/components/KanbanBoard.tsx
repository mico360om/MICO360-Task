import { useState } from 'react';
import { createPortal } from 'react-dom';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  pointerWithin,
  closestCorners,
  type CollisionDetection,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { KanbanColumn, type KanbanColumnData } from './KanbanColumn';
import { TaskCard } from './TaskCard';
import { dropIndex } from '../lib/board';

/**
 * Board collision detection. `closestCenter` mis-picks columns of unequal height (a short/empty
 * neighbour's centre can be nearer than the tall column you're actually over), dropping cards in the
 * wrong column. Instead: use whatever droppable is directly under the pointer (intuitive), fall back
 * to nearest corners, and prefer a card over its column so intra-column reordering still gets a target.
 */
const collisionDetectionStrategy: CollisionDetection = (args) => {
  const hits = pointerWithin(args);
  const collisions = hits.length > 0 ? hits : closestCorners(args);
  const cardHit = collisions.find((c) => {
    const container = args.droppableContainers.find((d) => d.id === c.id);
    return container?.data.current?.sortable != null;
  });
  return cardHit ? [cardHit] : collisions;
};

export interface KanbanBoardProps {
  columns: KanbanColumnData[];
  onTaskClick?: (taskKey: string) => void;
  /** Move a task to a different column, at `toIndex` (where it was dropped) in that column. */
  onMove?: (taskKey: string, toColumnId: string, toIndex: number) => void;
  /** Re-sequence a column's tasks (intra-column reorder), given the new key order. */
  onReorder?: (columnId: string, orderedKeys: string[]) => void;
  /** Company time zone, for the cards' overdue rule. */
  timeZone?: string;
}

/**
 * Keyboard dragging: Space picks a card up / drops it, arrows move it (across columns too), Escape
 * cancels. Enter is left free to open the task.
 */
const KEYBOARD_CODES = { start: ['Space'], cancel: ['Escape'], end: ['Space'] };

/**
 * Kanban board with drag-and-drop (T7.1/T7.3) via @dnd-kit/sortable: cards can be dragged across
 * columns (onMove) and reordered within a column (onReorder). A DragOverlay renders the lifted card
 * in a body-level portal so it stays visible over the columns' `overflow-hidden` edges and the
 * board's horizontal scroll. The container persists the change via the API (broadcast over realtime).
 */
export function KanbanBoard({ columns, onTaskClick, onMove, onReorder, timeZone }: KanbanBoardProps) {
  // Mouse drags after a small move; touch needs a short press so a swipe still scrolls the board;
  // keyboard users pick cards up with Space and move them with the arrow keys.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates, keyboardCodes: KEYBOARD_CODES }),
  );
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const activeTask = activeKey ? columns.flatMap((c) => c.tasks).find((t) => t.key === activeKey) ?? null : null;

  function handleDragStart(event: DragStartEvent) {
    setActiveKey(String(event.active.id));
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveKey(null);
    const { active, over } = event;
    if (!over) return;
    const activeK = String(active.id);
    const overId = String(over.id);

    const source = columns.find((c) => c.tasks.some((t) => t.key === activeK));
    if (!source) return;
    // `over` is either another card (its key) or an (empty) column (its id).
    let dest = columns.find((c) => c.tasks.some((t) => t.key === overId));
    if (!dest) dest = columns.find((c) => c.id === overId);
    if (!dest) return;

    // Dropped in the lower half of the card it's over → land after that card.
    const activeRect = active.rect.current.translated;
    const belowOver = !!activeRect && activeRect.top + activeRect.height / 2 > over.rect.top + over.rect.height / 2;

    if (dest.id === source.id) {
      // Reorder within the column.
      if (activeK === overId) return;
      const keys = source.tasks.map((t) => t.key);
      const from = keys.indexOf(activeK);
      // Dropped on the column's empty space (below the last card) → move to the end.
      const to = overId === dest.id ? keys.length - 1 : keys.indexOf(overId);
      if (from < 0 || to < 0 || from === to) return;
      const next = [...keys];
      next.splice(from, 1);
      next.splice(to, 0, activeK);
      onReorder?.(source.id, next);
    } else {
      // Move to another column, at the slot it was dropped on.
      onMove?.(activeK, dest.id, dropIndex(dest, overId, activeK, belowOver));
    }
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetectionStrategy}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setActiveKey(null)}
    >
      <div className="kanban-scroll flex gap-3 overflow-x-auto pb-3">
        {columns.map((column) => (
          <KanbanColumn key={column.id} column={column} onTaskClick={onTaskClick} timeZone={timeZone} />
        ))}
      </div>
      {/* Portal the overlay to <body> so its `position: fixed` is viewport-relative and follows the
          cursor exactly — never offset by a transformed ancestor (page-transition wrapper, etc.). */}
      {createPortal(
        <DragOverlay dropAnimation={null}>
          {activeTask ? (
            <div className="w-64 rotate-2 cursor-grabbing shadow-lift">
              <TaskCard task={activeTask} timeZone={timeZone} interactive={false} />
            </div>
          ) : null}
        </DragOverlay>,
        document.body,
      )}
    </DndContext>
  );
}
