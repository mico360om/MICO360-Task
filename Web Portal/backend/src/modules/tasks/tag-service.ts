import { NotFoundError, ValidationError } from '../../lib/http-errors';
import type { TagRecord, TagRepository } from './tag-repository';
import type { TaskLookup } from './assignee-repository';

/** A task can carry at most this many tags — keeps the UI and the join table sane. */
export const MAX_TAGS_PER_TASK = 10;
const MAX_TAG_LENGTH = 40;

export interface TagServiceDeps {
  repo: TagRepository;
  taskLookup: TaskLookup;
}

/** Trim, collapse internal whitespace and cap the length of a tag name. */
function normalizeName(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ').slice(0, MAX_TAG_LENGTH);
}

export function createTagService({ repo, taskLookup }: TagServiceDeps) {
  async function ensureTask(taskId: string): Promise<void> {
    if (!(await taskLookup.exists(taskId))) throw new NotFoundError('Task not found.');
  }

  async function listCatalog(): Promise<TagRecord[]> {
    return repo.listCatalog();
  }

  async function getTaskTags(taskId: string): Promise<TagRecord[]> {
    await ensureTask(taskId);
    return repo.listForTask(taskId);
  }

  /**
   * Replace a task's tags with these names (find-or-create each). Names are
   * normalized and de-duplicated case-insensitively; an empty list clears them.
   */
  async function setTaskTags(taskId: string, names: string[]): Promise<TagRecord[]> {
    await ensureTask(taskId);

    const seen = new Set<string>();
    const clean: string[] = [];
    for (const raw of names) {
      const name = normalizeName(raw);
      if (!name) throw new ValidationError('Tag names cannot be blank.');
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      clean.push(name);
    }
    if (clean.length > MAX_TAGS_PER_TASK) {
      throw new ValidationError(`A task can have at most ${MAX_TAGS_PER_TASK} tags.`);
    }

    const tags: TagRecord[] = [];
    for (const name of clean) tags.push(await repo.findOrCreateByName(name));
    await repo.setForTask(taskId, tags.map((t) => t.id));
    return repo.listForTask(taskId);
  }

  async function removeTaskTag(taskId: string, tagId: string): Promise<void> {
    await ensureTask(taskId);
    await repo.removeFromTask(taskId, tagId);
  }

  return { listCatalog, getTaskTags, setTaskTags, removeTaskTag };
}

export type TagService = ReturnType<typeof createTagService>;
