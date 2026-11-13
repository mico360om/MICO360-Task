export type ColumnCategory = 'BACKLOG' | 'TODO' | 'IN_PROGRESS' | 'BLOCKED' | 'REVIEW' | 'DONE';

export interface ColumnRecord {
  id: string;
  projectId: string;
  name: string;
  category: ColumnCategory;
  position: number;
  color: string;
  enabled: boolean;
}

export interface CreateColumnData {
  projectId: string;
  name: string;
  category?: ColumnCategory;
  position: number;
  color?: string;
}

export interface UpdateColumnData {
  name?: string;
  category?: ColumnCategory;
  color?: string;
  enabled?: boolean;
  position?: number;
}

/** What a column holds when its status kind changes (review fix #13), read under a hold on its row. */
export interface ColumnHold {
  /** Its status kind right now. */
  category: ColumnCategory;
  /** Tasks on the board (not archived, not in the Recycle Bin). */
  live: number;
  /** Archived tasks (unarchived, one comes back into this column). */
  archived: number;
  /** Tasks in the Recycle Bin (restored, one comes back into this column). Merged records are not counted. */
  binned: number;
  /** Live tasks (archived too) waiting for approval. */
  waiting: number;
}

export interface ColumnRepository {
  listForProject(projectId: string): Promise<ColumnRecord[]>;
  create(data: CreateColumnData): Promise<ColumnRecord>;
  update(id: string, patch: UpdateColumnData): Promise<ColumnRecord>;
  /**
   * Review fix #13: change a column that changes status kind, in one step with `check` — which sees what
   * the column holds, read after a hold on its row, and throws to refuse. Absent (old fakes): no check.
   */
  changeStatus?(id: string, patch: UpdateColumnData, check: (held: ColumnHold) => void): Promise<ColumnRecord>;
  /**
   * Review fix #26: put all of a project's columns in this order (positions 0…n-1) in one step; null when
   * `orderedIds` is not exactly the project's columns (one added, removed or moved meanwhile).
   */
  reorder?(projectId: string, orderedIds: string[]): Promise<ColumnRecord[] | null>;
  /** How many live (not deleted) tasks sit in the column. */
  countLiveTasks(id: string): Promise<number>;
  /**
   * Remove an empty column, returning its project id (so callers can scope a broadcast). Deleted
   * tasks that still reference it are moved to another column of the project first; throws a
   * ConflictError if live tasks remain or there is no other column to move them to.
   */
  remove(id: string): Promise<{ projectId: string } | null>;
}
