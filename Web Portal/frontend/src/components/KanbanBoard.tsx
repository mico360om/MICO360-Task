import { useState } from 'react';
import { createPortal } from 'react-dom';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MeasuringStrategy,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { KanbanColumn, type KanbanColumnData } from './KanbanColumn';
import type { CardMenuItem } from './board/CardMenu';
import { TaskCard } from './TaskCard';
import { dropIndex } from '../lib/board';
import { boardCollisionDetection, boardKeyboardCoordinates } from '../lib/board-collision';

export interface KanbanBoardProps {
  columns: KanbanColumnData[];
  onTaskClick?: (taskKey: string) => void;
  /** Move a task to a different column, at `toIndex` (where it was dropped) in that column. */
  onMove?: (taskKey: string, toColumnId: string, toIndex: number) => void;
  /** Re-sequence a column's tasks (intra-column reorder), given the new key order. */
  onReorder?: (columnId: string, orderedKeys: string[]) => void;
  /** Company time zone, for the cards' overdue rule. */
  timeZone?: string;
  /** Start a new task in a column (its "+" and its empty box); without it the board is read-only. */
  onAddTask?: (columnId: string) => void;
  /** Each card's "⋯" menu, by task key (e.g. "Move to another project…"). */
  cardMenu?: (taskKey: string) => CardMenuItem[] | null;
  /** The board fills the height it is given and each column scrolls by itself (see BOARD_FIT_QUERY in lib/board). */
  fit?: boolean;
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
export function KanbanBoard({ columns, onTaskClick, onMove, onReorder, timeZone, onAddTask, cardMenu, fit = false }: KanbanBoardProps) {
  // Mouse drags after a small move; touch needs a short press so a swipe still scrolls the board;
  // keyboard users pick cards up with Space and move them with the arrow keys.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: boardKeyboardCoordinates, keyboardCodes: KEYBOARD_CODES }),
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
      collisionDetection={boardCollisionDetection}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setActiveKey(null)}
      // Columns scroll while a card is dragged (dnd-kit scrolls them near an edge): drop targets are
      // measured all along, not once when the drag starts.
      measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
    >
      {/* Fitted: the board is as tall as the room it is given and each column scrolls by itself.
          Otherwise the columns reach the bottom of the window (lanes to drop into, and the page doesn't
          jump when the board replaces its placeholder); a longer column makes the page scroll. */}
      <div
        className={`kanban-scroll flex gap-3 overflow-x-auto pb-3 ${fit ? 'h-full min-h-0' : 'min-h-[calc(100dvh-12rem)]'}`}
        tabIndex={0}
        role="region"
        aria-label="Board columns"
        data-fit={fit ? 'true' : 'false'}
      >
        {columns.map((column) => (
          <KanbanColumn
            key={column.id}
            column={column}
            onTaskClick={onTaskClick}
            onAddTask={onAddTask ? () => onAddTask(column.id) : undefined}
            timeZone={timeZone}
            cardMenu={cardMenu}
            dragging={activeKey !== null}
            fit={fit}
          />
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
