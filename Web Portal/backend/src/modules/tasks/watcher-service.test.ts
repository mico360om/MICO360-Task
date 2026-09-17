import { describe, it, expect, vi } from 'vitest';
import { createWatcherService } from './watcher-service';
import type { WatcherRepository, WatcherUser } from './watcher-repository';

function inMemoryRepo(): WatcherRepository {
  const map = new Map<string, Set<string>>();
  const user = (id: string): WatcherUser => ({ id, username: id, email: `${id}@x`, firstName: id, lastName: '' });
  return {
    async add(taskId, userId) { (map.get(taskId) ?? map.set(taskId, new Set()).get(taskId)!).add(userId); },
    async remove(taskId, userId) { map.get(taskId)?.delete(userId); },
    async list(taskId) { return [...(map.get(taskId) ?? [])].map(user); },
    async isWatching(taskId, userId) { return !!map.get(taskId)?.has(userId); },
    async listWatcherIds(taskId) { return [...(map.get(taskId) ?? [])]; },
  };
}
const taskLookup = { async exists(id: string) { return id !== 'missing'; } };

describe('WatcherService', () => {
  it('lets a user watch a task and reports it back', async () => {
    const svc = createWatcherService({ repo: inMemoryRepo(), taskLookup });
    await svc.watch('t1', 'u1');
    expect(await svc.isWatching('t1', 'u1')).toBe(true);
    expect((await svc.listWatchers('t1')).map((w) => w.id)).toEqual(['u1']);
  });

  it('is idempotent — watching twice keeps a single watcher', async () => {
    const svc = createWatcherService({ repo: inMemoryRepo(), taskLookup });
    await svc.watch('t1', 'u1');
    await svc.watch('t1', 'u1');
    expect(await svc.listWatchers('t1')).toHaveLength(1);
  });

  it('unwatches', async () => {
    const svc = createWatcherService({ repo: inMemoryRepo(), taskLookup });
    await svc.watch('t1', 'u1');
    await svc.unwatch('t1', 'u1');
    expect(await svc.isWatching('t1', 'u1')).toBe(false);
  });

  it('fires onWatch when a user starts watching', async () => {
    const onWatch = vi.fn();
    const svc = createWatcherService({ repo: inMemoryRepo(), taskLookup, onWatch });
    await svc.watch('t1', 'u1');
    expect(onWatch).toHaveBeenCalledWith('t1', 'u1');
  });

  it('rejects watching a task that does not exist', async () => {
    const svc = createWatcherService({ repo: inMemoryRepo(), taskLookup });
    await expect(svc.watch('missing', 'u1')).rejects.toThrow(/not found/i);
  });
});
