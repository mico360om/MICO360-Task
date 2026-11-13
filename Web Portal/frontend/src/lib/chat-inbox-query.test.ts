import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { CHAT_INBOX_KEY, INBOX_REFRESH_DEBOUNCE_MS, INBOX_REFRESH_MAX_WAIT_MS, refreshInboxSoon } from './chat-inbox-query';

// Review #35 (13 Nov 2026): live chat events refresh the conversation list once per burst, not once each.
describe('refreshInboxSoon', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  const client = () => {
    const qc = new QueryClient();
    const invalidate = vi.spyOn(qc, 'invalidateQueries').mockResolvedValue();
    return { qc, refreshes: () => invalidate.mock.calls.filter(([arg]) => JSON.stringify(arg?.queryKey) === JSON.stringify(CHAT_INBOX_KEY)).length };
  };

  it('a burst of twenty events makes one refresh, a moment after the last', () => {
    const { qc, refreshes } = client();
    for (let i = 0; i < 20; i++) {
      refreshInboxSoon(qc);
      vi.advanceTimersByTime(10);
    }
    expect(refreshes()).toBe(0);
    vi.advanceTimersByTime(INBOX_REFRESH_DEBOUNCE_MS);
    expect(refreshes()).toBe(1);
  });

  it('events that keep coming still refresh it at least every INBOX_REFRESH_MAX_WAIT_MS', () => {
    const { qc, refreshes } = client();
    for (let t = 0; t < 4 * INBOX_REFRESH_MAX_WAIT_MS; t += 200) {
      refreshInboxSoon(qc);
      vi.advanceTimersByTime(200);
    }
    expect(refreshes()).toBeGreaterThanOrEqual(3);
    expect(refreshes()).toBeLessThanOrEqual(5);
  });

  it('each page (QueryClient) waits on its own', () => {
    const a = client();
    const b = client();
    refreshInboxSoon(a.qc);
    refreshInboxSoon(b.qc);
    vi.advanceTimersByTime(INBOX_REFRESH_DEBOUNCE_MS);
    expect([a.refreshes(), b.refreshes()]).toEqual([1, 1]);
  });
});
