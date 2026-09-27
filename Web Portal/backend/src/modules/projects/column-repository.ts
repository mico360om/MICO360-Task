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

export interface ColumnRepository {
  listForProject(projectId: string): Promise<ColumnRecord[]>;
  create(data: CreateColumnData): Promise<ColumnRecord>;
  update(id: string, patch: UpdateColumnData): Promise<ColumnRecord>;
  /** How many live (not deleted) tasks sit in the column. */
  countLiveTasks(id: string): Promise<number>;
  /**
   * Remove an empty column, returning its project id (so callers can scope a broadcast). Deleted
   * tasks that still reference it are moved to another column of the project first; throws a
   * ConflictError if live tasks remain or there is no other column to move them to.
   */
  remove(id: string): Promise<{ projectId: string } | null>;
}
