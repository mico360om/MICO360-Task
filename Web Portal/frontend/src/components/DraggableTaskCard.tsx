import { useSortable } from '@dnd-kit/sortable';
import { TaskCard, type TaskCardTask } from './TaskCard';

/**
 * A sortable Kanban card: draggable across columns AND reorderable within its column
 * (via @dnd-kit/sortable). The lifted card is dimmed here while a DragOverlay renders the
 * floating copy at the board level (so it isn't clipped by the column's overflow).
 */
export function DraggableTaskCard({ task, onClick }: { task: TaskCardTask; onClick?: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: task.key });
  const style: React.CSSProperties = {
    cursor: 'grab',
    transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
    transition,
    opacity: isDragging ? 0.4 : 1,
    zIndex: isDragging ? 10 : undefined,
  };
  return (
    <div ref={setNodeRef} style={style} {...listeners} {...attributes}>
      <TaskCard task={task} onClick={onClick} />
    </div>
  );
}
