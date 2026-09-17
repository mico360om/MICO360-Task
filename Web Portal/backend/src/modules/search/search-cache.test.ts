import { describe, it, expect, vi } from 'vitest';
import { createCachedSearchDataSource } from './search-service';
import type { SearchData } from './search-service';

const empty: SearchData = { tasks: [], projects: [], users: [], meetings: [] };

describe('createCachedSearchDataSource', () => {
  it('loads once within the TTL and reloads after it expires', async () => {
    let t = 0;
    const load = vi.fn(async () => empty);
    const src = createCachedSearchDataSource({ getSearchData: load }, { ttlMs: 1000, now: () => t });
    await src.getSearchData();
    await src.getSearchData();
    expect(load).toHaveBeenCalledTimes(1); // second call served from cache
    t = 1500; // past TTL
    await src.getSearchData();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('coalesces concurrent loads into a single call (single-flight)', async () => {
    let resolve!: (v: SearchData) => void;
    const load = vi.fn(() => new Promise<SearchData>((r) => { resolve = r; }));
    const src = createCachedSearchDataSource({ getSearchData: load }, { ttlMs: 1000, now: () => 0 });
    const a = src.getSearchData();
    const b = src.getSearchData();
    resolve(empty);
    await Promise.all([a, b]);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('does not cache a failed load', async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error('db down')).mockResolvedValue(empty);
    const src = createCachedSearchDataSource({ getSearchData: load }, { ttlMs: 1000, now: () => 0 });
    await expect(src.getSearchData()).rejects.toThrow(/db down/);
    await expect(src.getSearchData()).resolves.toEqual(empty); // retried, not stuck on the rejection
    expect(load).toHaveBeenCalledTimes(2);
  });
});
