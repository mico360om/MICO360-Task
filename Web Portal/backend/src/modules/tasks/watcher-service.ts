import { NotFoundError } from '../../lib/http-errors';
import type { TaskLookup } from './assignee-repository';
import type { WatcherRepository, WatcherUser } from './watcher-repository';

export interface WatcherServiceDeps {
  repo: WatcherRepository;
  taskLookup: TaskLookup;
  /** Fired after a user starts watching a task (used for activity/analytics). */
  onWatch?: (taskId: string, userId: string) => void | Promise<void>;
}

export function createWatcherService({ repo, taskLookup, onWatch }: WatcherServiceDeps) {
  async function ensureTask(taskId: string): Promise<void> {
    if (!(await taskLookup.exists(taskId))) throw new NotFoundError('Task not found.');
  }

  async function watch(taskId: string, userId: string): Promise<WatcherUser[]> {
    await ensureTask(taskId);
    const already = await repo.isWatching(taskId, userId);
    await repo.add(taskId, userId);
    if (!already) await onWatch?.(taskId, userId);
    return repo.list(taskId);
  }

  async function unwatch(taskId: string, userId: string): Promise<void> {
    await ensureTask(taskId);
    await repo.remove(taskId, userId);
  }

  async function listWatchers(taskId: string): Promise<WatcherUser[]> {
    await ensureTask(taskId);
    return repo.list(taskId);
  }

  async function isWatching(taskId: string, userId: string): Promise<boolean> {
    await ensureTask(taskId);
    return repo.isWatching(taskId, userId);
  }

  return { watch, unwatch, listWatchers, isWatching };
}

export type WatcherService = ReturnType<typeof createWatcherService>;
