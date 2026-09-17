import type { ApiTask } from '../api/tasks';
import type { ApiColumn } from '../api/columns';
import type { KanbanColumnData } from '../components/KanbanColumn';

/**
 * Resolve a drag-drop: given the dragged task key and the id it was dropped over
 * (a column id or another task's key), return the move to persist — or null if it's
 * a no-op (dropped in the same column or unresolved).
 */
export function resolveDrop(
  activeKey: string,
  overId: string,
  columns: KanbanColumnData[],
): { taskKey: string; toColumnId: string } | null {
  const source = columns.find((c) => c.tasks.some((t) => t.key === activeKey));
  if (!source) return null;
  let target = columns.find((c) => c.id === overId);
  if (!target) target = columns.find((c) => c.tasks.some((t) => t.key === overId));
  if (!target || target.id === source.id) return null;
  return { taskKey: activeKey, toColumnId: target.id };
}

/**
 * Move a task to another column in the board view model, for an optimistic UI update
 * (so the card lands instantly instead of snapping back until the refetch). Pure — returns
 * new column objects and leaves the input untouched; returns the same reference if the task
 * isn't found so callers can skip a needless re-render.
 */
export function moveTaskInBoard(
  columns: KanbanColumnData[],
  taskKey: string,
  toColumnId: string,
): KanbanColumnData[] {
  let moved: KanbanColumnData['tasks'][number] | undefined;
  const without = columns.map((col) => {
    const idx = col.tasks.findIndex((t) => t.key === taskKey);
    if (idx === -1) return col;
    moved = col.tasks[idx];
    return { ...col, tasks: col.tasks.filter((_, i) => i !== idx) };
  });
  if (!moved) return columns;
  return without.map((col) => (col.id === toColumnId ? { ...col, tasks: [...col.tasks, moved!] } : col));
}

/**
 * Reorder one column's tasks to match `orderedKeys` (intra-column drag reordering), for an
 * optimistic UI update. Pure — returns new column objects. Any task not named in orderedKeys is
 * kept (appended) as a safety net.
 */
export function reorderColumnInBoard(
  columns: KanbanColumnData[],
  columnId: string,
  orderedKeys: string[],
): KanbanColumnData[] {
  return columns.map((col) => {
    if (col.id !== columnId) return col;
    const byKey = new Map(col.tasks.map((t) => [t.key, t]));
    const reordered = orderedKeys.map((k) => byKey.get(k)).filter((t): t is KanbanColumnData['tasks'][number] => Boolean(t));
    const missing = col.tasks.filter((t) => !orderedKeys.includes(t.key));
    return { ...col, tasks: [...reordered, ...missing] };
  });
}

/** Compose API columns + tasks into the KanbanBoard's view model (columns ordered, tasks grouped). */
export function composeBoard(columns: ApiColumn[], tasks: ApiTask[]): KanbanColumnData[] {
  return [...columns]
    .sort((a, b) => a.position - b.position)
    .map((col) => ({
      id: col.id,
      name: col.name,
      color: col.color,
      tasks: tasks
        .filter((t) => t.columnId === col.id)
        .map((t) => ({
          key: t.key,
          title: t.title,
          priority: t.priority,
          dueDate: t.dueDate,
          progress: t.progress,
          assignees: t.assignees ?? [],
          counts: t.counts,
          accentColor: col.color,
          blocked: col.category === 'BLOCKED',
        })),
    }));
}
