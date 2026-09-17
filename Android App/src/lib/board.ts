import type { ApiColumn, ApiTask } from './types';

export interface BoardColumn {
  column: ApiColumn;
  tasks: ApiTask[];
}

/** Compose enabled columns (in order) with their tasks (in order) for the Kanban board (A4). */
export function composeBoard(columns: ApiColumn[], tasks: ApiTask[]): BoardColumn[] {
  return [...columns]
    .filter((c) => c.enabled)
    .sort((a, b) => a.position - b.position)
    .map((column) => ({
      column,
      tasks: tasks.filter((t) => t.columnId === column.id).sort((a, b) => a.position - b.position),
    }));
}
