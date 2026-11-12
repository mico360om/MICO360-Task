import { describe, it, expect, vi, afterEach } from 'vitest';
import { MutationObserver, QueryObserver, onlineManager } from '@tanstack/react-query';
import { createAppQueryClient } from './query-client';
import { ApiError, createApiClient } from './api-client';

afterEach(() => onlineManager.setOnline(true));

describe('the app’s query client', () => {
  it('keeps the tuned read defaults (short stale window, no refetch on window focus)', () => {
    const { queries } = createAppQueryClient().getDefaultOptions();
    expect(queries?.staleTime).toBe(30_000);
    expect(queries?.refetchOnWindowFocus).toBe(false);
  });

  it('a change made while the browser is offline fails at once, so it can be queued — it does not wait silently', async () => {
    // By default the library *pauses* a change while offline: nothing fails, nothing is queued, and
    // the "Add task" button sat on "Adding…" until the connection came back.
    onlineManager.setOnline(false);
    const onError = vi.fn();
    const change = new MutationObserver(createAppQueryClient(), {
      mutationFn: async () => { throw new TypeError('Failed to fetch'); },
      onError,
    });
    const settled = change.mutate(undefined).then(() => 'done', () => 'failed');
    const outcome = await Promise.race([settled, new Promise((resolve) => setTimeout(() => resolve('still waiting'), 300))]);
    expect(outcome).toBe('failed');
    expect(onError).toHaveBeenCalledTimes(1);
  });

  // 1.23.23: the API client tries a dropped read 3 times; the query doesn't multiply that (4 × 3 requests).
  it('a read dropped every time is sent 3 times in all (the API client’s tries), not 3 × the query’s retries', async () => {
    const f = vi.fn(async () => { throw new TypeError('Failed to fetch'); });
    vi.stubGlobal('fetch', f);
    const api = createApiClient({ baseUrl: 'http://api.test', getToken: () => null, networkRetry: { wait: async () => undefined } });
    const read = new QueryObserver(createAppQueryClient(), { queryKey: ['dropped'], queryFn: () => api.get('/tasks') });
    const failed = new Promise<void>((resolve) => {
      const stop = read.subscribe((r) => {
        if (r.status === 'error') {
          stop();
          resolve();
        }
      });
    });
    await Promise.race([failed, new Promise((_, reject) => setTimeout(() => reject(new Error('the query kept retrying')), 3_000))]);
    expect(f).toHaveBeenCalledTimes(3);
    vi.unstubAllGlobals();
  });

  it('a server error is still retried by the query (the API client doesn’t)', () => {
    const retry = createAppQueryClient().getDefaultOptions().queries?.retry as (n: number, e: unknown) => boolean;
    expect(retry(0, new ApiError(503, 'X', 'x'))).toBe(true);
  });
});
