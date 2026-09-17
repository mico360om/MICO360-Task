import { useState } from 'react';
import { createPortal } from 'react-dom';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  closestCorners,
  type CollisionDetection,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { KanbanColumn, type KanbanColumnData } from './KanbanColumn';
import { TaskCard } from './TaskCard';

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
  /** Move a task to a different column. */
  onMove?: (taskKey: string, toColumnId: string) => void;
  /** Re-sequence a column's tasks (intra-column reorder), given the new key order. */
  onReorder?: (columnId: string, orderedKeys: string[]) => void;
}

/**
 * Kanban board with drag-and-drop (T7.1/T7.3) via @dnd-kit/sortable: cards can be dragged across
 * columns (onMove) and reordered within a column (onReorder). A DragOverlay renders the lifted card
 * in a body-level portal so it stays visible over the columns' `overflow-hidden` edges and the
 * board's horizontal scroll. The container persists the change via the API (broadcast over realtime).
 */
export function KanbanBoard({ columns, onTaskClick, onMove, onReorder }: KanbanBoardProps) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
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

    if (dest.id === source.id) {
      // Reorder within the column.
      if (activeK === overId) return;
      const keys = source.tasks.map((t) => t.key);
      const from = keys.indexOf(activeK);
      const to = keys.indexOf(overId);
      if (from < 0 || to < 0 || from === to) return;
      const next = [...keys];
      next.splice(from, 1);
      next.splice(to, 0, activeK);
      onReorder?.(source.id, next);
    } else {
      // Move to another column.
      onMove?.(activeK, dest.id);
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
          <KanbanColumn key={column.id} column={column} onTaskClick={onTaskClick} />
        ))}
      </div>
      {/* Portal the overlay to <body> so its `position: fixed` is viewport-relative and follows the
          cursor exactly — never offset by a transformed ancestor (page-transition wrapper, etc.). */}
      {createPortal(
        <DragOverlay dropAnimation={null}>
          {activeTask ? (
            <div className="w-64 rotate-2 cursor-grabbing shadow-lift">
              <TaskCard task={activeTask} />
            </div>
          ) : null}
        </DragOverlay>,
        document.body,
      )}
    </DndContext>
  );
}
