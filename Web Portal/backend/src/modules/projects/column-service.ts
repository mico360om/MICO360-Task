import { ConflictError } from '../../lib/http-errors';
import type { ColumnCategory, ColumnRecord, ColumnRepository, UpdateColumnData } from './column-repository';
import { statusTones } from '../../lib/colour-scheme';

export interface AddColumnInput {
  name: string;
  category?: ColumnCategory;
  color?: string;
}

export interface ColumnServiceDeps {
  columns: ColumnRepository;
  /** How many live tasks in the column wait for approval (task approvals). */
  waitingTasksIn?: (columnId: string) => Promise<number>;
}

export function createColumnService({ columns, waitingTasksIn }: ColumnServiceDeps) {
  async function listColumns(projectId: string): Promise<ColumnRecord[]> {
    return columns.listForProject(projectId);
  }

  async function addColumn(projectId: string, input: AddColumnInput): Promise<ColumnRecord> {
    const existing = await columns.listForProject(projectId);
    // Use max(position)+1, not count — positions can be non-contiguous after reordering
    // and the DB enforces a unique (projectId, position) index.
    const nextPosition = existing.length ? Math.max(...existing.map((c) => c.position)) + 1 : 0;
    return columns.create({
      projectId,
      name: input.name,
      category: input.category ?? 'TODO',
      position: nextPosition,
      // 1.23.8: one colour scheme — a column added without a colour (the website no longer picks one) gets its
      // status kind's, so the Android app, which still shows the stored colour, matches the website.
      color: input.color ?? statusTones(input.category ?? 'TODO').light.fill,
    });
  }

  async function updateColumn(id: string, patch: UpdateColumnData): Promise<ColumnRecord> {
    // Tasks waiting for approval are never in a Done column (there they would count as done).
    if (patch.category === 'DONE' && waitingTasksIn) {
      const waiting = await waitingTasksIn(id);
      if (waiting > 0) {
        throw new ConflictError(
          `${waiting} task${waiting === 1 ? ' in this column is' : 's in this column are'} waiting for approval. Approve or send ${waiting === 1 ? 'it' : 'them'} back first, then make it a Done column.`,
          'TASKS_WAITING',
        );
      }
    }
    // 1.23.8 one colour scheme: a column moved to another status takes that status's colour, unless a colour is
    // sent with the change (the Android app's picker) — the website shows the status's colour either way, the
    // app the stored one.
    const stamped = patch.category && patch.color === undefined ? { ...patch, color: statusTones(patch.category).light.fill } : patch;
    return columns.update(id, stamped);
  }

  /** Delete a column — only once it's empty, so no task is ever left without a column. */
  async function removeColumn(id: string): Promise<{ projectId: string } | null> {
    const live = await columns.countLiveTasks(id);
    if (live > 0) {
      throw new ConflictError(
        `This column still has ${live} task${live === 1 ? '' : 's'}. Move ${live === 1 ? 'it' : 'them'} to another column first.`,
        'COLUMN_NOT_EMPTY',
      );
    }
    return columns.remove(id);
  }

  return { listColumns, addColumn, updateColumn, removeColumn };
}

export type ColumnService = ReturnType<typeof createColumnService>;
