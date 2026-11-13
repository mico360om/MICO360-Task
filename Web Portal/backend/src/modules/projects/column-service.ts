import { ConflictError } from '../../lib/http-errors';
import type { ColumnCategory, ColumnHold, ColumnRecord, ColumnRepository, UpdateColumnData } from './column-repository';
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

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function waitingRefusal(waiting: number): ConflictError {
  return new ConflictError(
    `${waiting} task${waiting === 1 ? ' in this column is' : 's in this column are'} waiting for approval. Approve or send ${waiting === 1 ? 'it' : 'them'} back first, then make it a Done column.`,
    'TASKS_WAITING',
  );
}

/** Review fix #13: why a column holding tasks can't change into or out of Done (and what counts that the board doesn't show). */
function tasksInColumnRefusal(held: ColumnHold): ConflictError {
  const hidden = [held.archived ? plural(held.archived, 'archived task', 'archived tasks') : '', held.binned ? plural(held.binned, 'task in the Recycle Bin', 'tasks in the Recycle Bin') : ''].filter(Boolean);
  const also = hidden.length ? ` That includes ${hidden.join(' and ')}.` : '';
  return new ConflictError(`Move the tasks out of this column first, then change its status.${also}`, 'COLUMN_HAS_TASKS');
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
    // 1.23.8 one colour scheme: a column moved to another status takes that status's colour, unless a colour is
    // sent with the change (the Android app's picker) — the website shows the status's colour either way, the
    // app the stored one.
    const stamped = patch.category && patch.color === undefined ? { ...patch, color: statusTones(patch.category).light.fill } : patch;
    // Tasks waiting for approval are never in a Done column (there they would count as done).
    if (patch.category === 'DONE' && waitingTasksIn) {
      const waiting = await waitingTasksIn(id);
      if (waiting > 0) throw waitingRefusal(waiting);
    }
    // Review fix #13: a status change is checked against what the column holds, in the same step as the save.
    if (patch.category !== undefined && columns.changeStatus) {
      const to = patch.category;
      return columns.changeStatus(id, stamped, (held) => {
        if (to === 'DONE' && held.waiting > 0) throw waitingRefusal(held.waiting);
        // Into or out of Done: the tasks' completion dates would be wrong (done with none, open with one).
        if ((held.category === 'DONE') !== (to === 'DONE') && held.live + held.archived + held.binned > 0) throw tasksInColumnRefusal(held);
      });
    }
    return columns.update(id, stamped);
  }

  /**
   * Review fix #26: a project's whole column order in one step (the website's arrows and drag). Refused
   * (409) when the list isn't exactly the project's columns — someone added or removed one meanwhile.
   */
  async function reorderColumns(projectId: string, orderedIds: string[]): Promise<ColumnRecord[]> {
    const changed = () => new ConflictError('The columns changed since this list was opened. Reload and try again.', 'COLUMNS_CHANGED');
    if (new Set(orderedIds).size !== orderedIds.length) throw changed();
    if (columns.reorder) {
      const saved = await columns.reorder(projectId, orderedIds);
      if (!saved) throw changed();
      return saved;
    }
    // Fakes without the one-step write: the same result, one column at a time.
    const existing = await columns.listForProject(projectId);
    if (existing.length !== orderedIds.length || existing.some((c) => !orderedIds.includes(c.id))) throw changed();
    const low = Math.min(0, ...existing.map((c) => c.position)) - 1;
    for (const [i, id] of orderedIds.entries()) await columns.update(id, { position: low - i });
    for (const [i, id] of orderedIds.entries()) await columns.update(id, { position: i });
    return [...(await columns.listForProject(projectId))].sort((a, b) => a.position - b.position);
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

  return { listColumns, addColumn, updateColumn, reorderColumns, removeColumn };
}

export type ColumnService = ReturnType<typeof createColumnService>;
