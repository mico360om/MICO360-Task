import type { ApiTask } from '../api/tasks';
import type { ApiColumn } from '../api/columns';
import type { ApiProject } from '../api/projects';
import { STATUS_META, STATUS_ORDER, type TaskCategory } from './taskStatus';
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
 * Index in `dest` where a card dropped on `overId` should land: the slot of the card it was dropped
 * on (after it when dropped on its lower half), or the end when dropped on the column's empty space.
 */
export function dropIndex(dest: KanbanColumnData, overId: string, activeKey: string, belowOver: boolean): number {
  const keys = dest.tasks.map((t) => t.key).filter((k) => k !== activeKey);
  const at = keys.indexOf(overId);
  if (at === -1) return keys.length;
  return belowOver ? at + 1 : at;
}

/**
 * Move a task to another column in the board view model, for an optimistic UI update
 * (so the card lands instantly instead of snapping back until the refetch). `toIndex` is where it
 * was dropped in the target column (default: the end). Pure — returns new column objects and leaves
 * the input untouched; returns the same reference if the task isn't found so callers can skip a
 * needless re-render.
 */
export function moveTaskInBoard(
  columns: KanbanColumnData[],
  taskKey: string,
  toColumnId: string,
  toIndex?: number,
): KanbanColumnData[] {
  let moved: KanbanColumnData['tasks'][number] | undefined;
  const without = columns.map((col) => {
    const idx = col.tasks.findIndex((t) => t.key === taskKey);
    if (idx === -1) return col;
    moved = col.tasks[idx];
    return { ...col, tasks: col.tasks.filter((_, i) => i !== idx) };
  });
  if (!moved) return columns;
  return without.map((col) => {
    if (col.id !== toColumnId) return col;
    const tasks = [...col.tasks];
    const at = toIndex === undefined ? tasks.length : Math.max(0, Math.min(toIndex, tasks.length));
    tasks.splice(at, 0, moved!);
    return { ...col, tasks };
  });
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

/** Compose API columns + tasks into the KanbanBoard's view model (columns ordered, tasks grouped, in position order). */
export function composeBoard(columns: ApiColumn[], tasks: ApiTask[]): KanbanColumnData[] {
  return [...columns]
    // "Visible" switched off in Manage columns: the column (and the cards in it) is not on the board.
    .filter((col) => col.enabled !== false)
    .sort((a, b) => a.position - b.position)
    .map((col) => ({
      id: col.id,
      name: col.name,
      color: col.color,
      tasks: tasks
        .filter((t) => t.columnId === col.id)
        .sort((a, b) => a.position - b.position)
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
          recurring: Boolean(t.recurrenceRule),
          milestone: !!t.isMilestone,
          clientVisible: !!t.clientVisible,
          inspection: !!t.inspectionFormId,
          // A finished task (DONE column, or completed) is never shown as overdue.
          done: col.category === 'DONE' || !!t.completedAt,
        })),
    }));
}

// ── The All projects board: every project's tasks under the six shared statuses ──

/** The board's project choice that shows every project at once (also `?project=all`). */
export const ALL_PROJECTS = 'all';

const STATUS_COLUMN = 'status:';
/** The status a combined board column stands for (null for a project's own column). */
export const statusOfBoardColumn = (columnId: string): TaskCategory | null =>
  columnId.startsWith(STATUS_COLUMN) ? (columnId.slice(STATUS_COLUMN.length) as TaskCategory) : null;

const PRIORITY_RANK: Record<string, number> = { URGENT: 0, HIGH: 1, NORMAL: 2, LOW: 3 };

/** The projects the combined board shows: not finished, not archived. */
export function boardProjects<P extends Pick<ApiProject, 'status'>>(projects: P[]): P[] {
  return projects.filter((p) => p.status !== 'COMPLETED' && p.status !== 'ARCHIVED');
}

/**
 * Every shown project's tasks under the six statuses (Backlog … Done). Each card carries its project;
 * a column is sorted by due date (no date last), then priority, then key. Tasks of finished or
 * archived projects, of projects filtered out (`hidden`), and in columns switched off are left out.
 */
export function composeAllProjectsBoard(tasks: ApiTask[], projects: ApiProject[], opts: { hidden?: ReadonlySet<string> } = {}): KanbanColumnData[] {
  const shown = new Map(boardProjects(projects).filter((p) => !opts.hidden?.has(p.id)).map((p) => [p.id, p]));
  return STATUS_ORDER.map((status) => {
    const { label, color } = STATUS_META[status]!;
    const inColumn = tasks
      .filter((t) => shown.has(t.projectId) && !t.columnHidden && ((t.columnCategory as TaskCategory | null) ?? 'TODO') === status)
      .sort(
        (a, b) =>
          (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999') ||
          (PRIORITY_RANK[a.priority] ?? 9) - (PRIORITY_RANK[b.priority] ?? 9) ||
          a.key.localeCompare(b.key, undefined, { numeric: true }),
      );
    return {
      id: `${STATUS_COLUMN}${status}`,
      name: label,
      color,
      tasks: inColumn.map((t) => {
        const p = shown.get(t.projectId)!;
        return {
          key: t.key,
          title: t.title,
          priority: t.priority,
          dueDate: t.dueDate,
          progress: t.progress,
          assignees: t.assignees ?? [],
          counts: t.counts,
          accentColor: color,
          blocked: status === 'BLOCKED',
          recurring: Boolean(t.recurrenceRule),
          milestone: !!t.isMilestone,
          clientVisible: !!t.clientVisible,
          inspection: !!t.inspectionFormId,
          done: status === 'DONE' || !!t.completedAt,
          project: { name: p.name, code: p.code, color: p.color, icon: p.icon ?? null, imageUrl: p.imageUrl },
        };
      }),
    };
  });
}

/** Where a card dropped on a status lands in its own project: that project's first visible column of it. */
export function targetColumnFor(columns: ApiColumn[], status: TaskCategory): string | null {
  return (
    [...columns]
      .filter((c) => c.enabled !== false && c.category === status)
      .sort((a, b) => a.position - b.position)[0]?.id ?? null
  );
}
