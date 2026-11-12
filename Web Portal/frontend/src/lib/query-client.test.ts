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

  // 1.23.23: the API client tries a dropped read 3 times; the query adds one more round 4 s later — 6 requests
  // in all (not 4 × 3), and a connection back within about 7 s is never seen (as before).
  describe('a dropped read (1.23.23)', () => {
    const watch = (fetchFn: () => Promise<Response>) => {
      const f = vi.fn(fetchFn);
      vi.stubGlobal('fetch', f);
      const api = createApiClient({ baseUrl: 'http://api.test', getToken: () => null, networkRetry: { wait: async () => undefined } });
      const read = new QueryObserver(createAppQueryClient(), { queryKey: ['dropped', Math.random()], queryFn: () => api.get('/tasks') });
      const states: string[] = [];
      const stop = read.subscribe((r) => states.push(r.status));
      return { f, states, stop };
    };
    afterEach(() => {
      vi.useRealTimers();
      vi.unstubAllGlobals();
    });

    it('dropped every time: 3 tries, one more round of 3 after 4 s, then the error — 6 requests in all', async () => {
      vi.useFakeTimers();
      const { f, states, stop } = watch(async () => { throw new TypeError('Failed to fetch'); });
      await vi.advanceTimersByTimeAsync(10);
      expect(f).toHaveBeenCalledTimes(3);
      await vi.advanceTimersByTimeAsync(3_900);
      expect(f).toHaveBeenCalledTimes(3);
      await vi.advanceTimersByTimeAsync(200);
      expect(f).toHaveBeenCalledTimes(6);
      expect(states.at(-1)).toBe('error');
      await vi.advanceTimersByTimeAsync(120_000);
      expect(f).toHaveBeenCalledTimes(6);
      stop();
    });

    it('back within the extra round: the data, never the error', async () => {
      vi.useFakeTimers();
      let n = 0;
      const { f, states, stop } = watch(async () => {
        n += 1;
        if (n <= 3) throw new TypeError('Failed to fetch');
        return new Response('{"data":1}', { status: 200 });
      });
      await vi.advanceTimersByTimeAsync(4_200);
      expect(f).toHaveBeenCalledTimes(4);
      expect(states).not.toContain('error');
      expect(states.at(-1)).toBe('success');
      stop();
    });
  });

  it('a server error is still retried by the query (the API client doesn’t)', () => {
    const retry = createAppQueryClient().getDefaultOptions().queries?.retry as (n: number, e: unknown) => boolean;
    expect(retry(0, new ApiError(503, 'X', 'x'))).toBe(true);
  });
});
