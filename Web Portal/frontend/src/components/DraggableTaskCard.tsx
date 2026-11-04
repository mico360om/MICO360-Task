import type { KeyboardEvent } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { TaskCard, type TaskCardTask } from './TaskCard';

/**
 * A sortable Kanban card: draggable across columns AND reorderable within its column
 * (via @dnd-kit/sortable). The lifted card is dimmed here while a DragOverlay renders the
 * floating copy at the board level (so it isn't clipped by the column's overflow).
 *
 * This wrapper is the card's single tab stop: Enter opens the task, Space picks it up for a
 * keyboard move (arrow keys, Space to drop, Escape to cancel).
 *
 * `disabled` (1.22.3 review: a read-only board — an archived or completed project's): the card
 * doesn't move and says nothing about dragging; it is a button that opens its task.
 */
export function DraggableTaskCard({ task, onClick, timeZone, menuSpace, disabled = false }: { task: TaskCardTask; onClick?: () => void; timeZone?: string; menuSpace?: boolean; disabled?: boolean }) {
  const sortable = useSortable({ id: task.key, disabled });
  const { listeners, setNodeRef, transform, transition, isDragging } = sortable;
  // Still dragged: dnd-kit's own (role, tab stop, "sortable", how to pick it up). Read-only: a plain button.
  const attributes = disabled ? { role: 'button', tabIndex: 0 } : sortable.attributes;
  const style: React.CSSProperties = {
    cursor: disabled ? 'pointer' : 'grab',
    transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
    transition,
    opacity: isDragging ? 0.4 : 1,
    zIndex: isDragging ? 10 : undefined,
    // Let a quick swipe scroll the board; a press-and-hold (TouchSensor delay) starts the drag.
    touchAction: 'manipulation',
  };
  const { onKeyDown: dndKeyDown, ...restListeners } = (listeners ?? {}) as { onKeyDown?: (e: KeyboardEvent) => void } & Record<string, unknown>;
  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...restListeners}
      aria-label={`${task.key}: ${task.title}`}
      data-card-key={task.key}
      className="rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-brand/60"
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !isDragging) {
          e.preventDefault();
          onClick?.();
          return;
        }
        dndKeyDown?.(e);
      }}
    >
      <TaskCard task={task} onClick={onClick} timeZone={timeZone} interactive={false} menuSpace={menuSpace} />
    </div>
  );
}
