import { describe, it, expect, vi, afterEach } from 'vitest';
import { MutationObserver, onlineManager } from '@tanstack/react-query';
import { createAppQueryClient } from './query-client';

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
});
