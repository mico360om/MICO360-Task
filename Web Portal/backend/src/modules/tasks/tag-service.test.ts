import { describe, it, expect, beforeEach } from 'vitest';
import { createTagService } from './tag-service';
import { createMemoryTagRepository } from './tag-repository';
import { NotFoundError, ValidationError } from '../../lib/http-errors';

function make(taskExists = true) {
  const repo = createMemoryTagRepository();
  return {
    repo,
    svc: createTagService({ repo, taskLookup: { async exists() { return taskExists; } } }),
  };
}

let repo: ReturnType<typeof createMemoryTagRepository>;
let svc: ReturnType<typeof createTagService>;
beforeEach(() => {
  const m = make();
  repo = m.repo;
  svc = m.svc;
});

describe('TagService', () => {
  it('creates and attaches tags to a task, returning them sorted', async () => {
    const tags = await svc.setTaskTags('t1', ['urgent', 'backend']);
    expect(tags.map((t) => t.name)).toEqual(['backend', 'urgent']);
    expect(await svc.getTaskTags('t1')).toHaveLength(2);
  });

  it('trims, collapses whitespace and de-duplicates case-insensitively', async () => {
    const tags = await svc.setTaskTags('t1', ['  Design ', 'design', 'UX   Review']);
    expect(tags.map((t) => t.name)).toEqual(['Design', 'UX Review']);
  });

  it('reuses an existing catalog tag instead of creating a duplicate', async () => {
    await svc.setTaskTags('t1', ['shared']);
    await svc.setTaskTags('t2', ['Shared']); // different case, same tag
    expect(await svc.listCatalog()).toHaveLength(1);
  });

  it('replaces the whole tag set on each call', async () => {
    await svc.setTaskTags('t1', ['a', 'b', 'c']);
    const after = await svc.setTaskTags('t1', ['b']);
    expect(after.map((t) => t.name)).toEqual(['b']);
  });

  it('clears all tags when given an empty list', async () => {
    await svc.setTaskTags('t1', ['a']);
    expect(await svc.setTaskTags('t1', [])).toEqual([]);
  });

  it('rejects blank tag names', async () => {
    await expect(svc.setTaskTags('t1', ['   '])).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects more than the maximum number of tags', async () => {
    const many = Array.from({ length: 11 }, (_, i) => `tag${i}`);
    await expect(svc.setTaskTags('t1', many)).rejects.toBeInstanceOf(ValidationError);
  });

  it('removes a single tag from a task', async () => {
    const tags = await svc.setTaskTags('t1', ['keep', 'drop']);
    const drop = tags.find((t) => t.name === 'drop')!;
    await svc.removeTaskTag('t1', drop.id);
    expect((await svc.getTaskTags('t1')).map((t) => t.name)).toEqual(['keep']);
  });

  it('throws NotFound for an unknown task', async () => {
    const { svc: missing } = make(false);
    await expect(missing.getTaskTags('ghost')).rejects.toBeInstanceOf(NotFoundError);
    await expect(missing.setTaskTags('ghost', ['x'])).rejects.toBeInstanceOf(NotFoundError);
    await expect(missing.removeTaskTag('ghost', 'tag0')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('exposes the catalog for tag suggestions', async () => {
    await svc.setTaskTags('t1', ['zebra', 'alpha']);
    expect((await svc.listCatalog()).map((t) => t.name)).toEqual(['alpha', 'zebra']);
    void repo;
  });
});
