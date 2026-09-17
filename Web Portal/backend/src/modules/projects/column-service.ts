import type { ColumnCategory, ColumnRecord, ColumnRepository, UpdateColumnData } from './column-repository';

export interface AddColumnInput {
  name: string;
  category?: ColumnCategory;
  color?: string;
}

export interface ColumnServiceDeps {
  columns: ColumnRepository;
}

export function createColumnService({ columns }: ColumnServiceDeps) {
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
      color: input.color,
    });
  }

  async function updateColumn(id: string, patch: UpdateColumnData): Promise<ColumnRecord> {
    return columns.update(id, patch);
  }

  async function removeColumn(id: string): Promise<{ projectId: string } | null> {
    return columns.remove(id);
  }

  return { listColumns, addColumn, updateColumn, removeColumn };
}

export type ColumnService = ReturnType<typeof createColumnService>;
