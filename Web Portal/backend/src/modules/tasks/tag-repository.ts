/** A workspace tag from the shared catalog. */
export interface TagRecord {
  id: string;
  name: string;
  color: string;
}

/**
 * Persistence port for tags. Tags live in a shared catalog (unique by name) and
 * are attached to tasks through a join. Attaching by name is find-or-create so
 * lightweight clients (mobile quick-add, the extension) can send plain strings.
 */
export interface TagRepository {
  /** Every tag in the catalog, ordered by name. */
  listCatalog(): Promise<TagRecord[]>;
  /** Return the catalog tag with this (case-insensitive) name, creating it if new. */
  findOrCreateByName(name: string, color?: string): Promise<TagRecord>;
  /** The tags currently attached to a task. */
  listForTask(taskId: string): Promise<TagRecord[]>;
  /** Replace a task's tag set with exactly these tag ids. */
  setForTask(taskId: string, tagIds: string[]): Promise<void>;
  /** Detach a single tag from a task. */
  removeFromTask(taskId: string, tagId: string): Promise<void>;
}

/** A small, distinct palette so auto-created tags get a stable, pleasant colour. */
const TAG_PALETTE = ['#3A6EA5', '#8B1E1E', '#1F7A5A', '#B87611', '#6B4FA8', '#0E7490', '#B23A6E'];

export function paletteColorFor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return TAG_PALETTE[h % TAG_PALETTE.length]!;
}

/** In-memory tag repository for tests. */
export function createMemoryTagRepository(): TagRepository {
  const catalog = new Map<string, TagRecord>(); // id -> tag
  const byName = new Map<string, string>(); // lowercased name -> id
  const taskTags = new Map<string, Set<string>>(); // taskId -> set of tag ids
  let seq = 0;

  return {
    async listCatalog() {
      return [...catalog.values()].sort((a, b) => a.name.localeCompare(b.name));
    },
    async findOrCreateByName(name, color) {
      const key = name.toLowerCase();
      const existingId = byName.get(key);
      if (existingId) return catalog.get(existingId)!;
      const tag: TagRecord = { id: `tag${seq++}`, name, color: color ?? paletteColorFor(name) };
      catalog.set(tag.id, tag);
      byName.set(key, tag.id);
      return tag;
    },
    async listForTask(taskId) {
      const ids = taskTags.get(taskId) ?? new Set();
      return [...ids]
        .map((id) => catalog.get(id))
        .filter((t): t is TagRecord => Boolean(t))
        .sort((a, b) => a.name.localeCompare(b.name));
    },
    async setForTask(taskId, tagIds) {
      taskTags.set(taskId, new Set(tagIds));
    },
    async removeFromTask(taskId, tagId) {
      taskTags.get(taskId)?.delete(tagId);
    },
  };
}
