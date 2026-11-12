import { describe, it, expect, vi } from 'vitest';
import { clientRetriedNetwork, shouldRetryQuery } from './queryRetry';
import { ApiError, createApiClient, networkTries } from './api-client';

const api = (status: number) => new ApiError(status, 'X', 'x');

describe('shouldRetryQuery', () => {
  it('never retries deterministic client errors (401/403/404/400)', () => {
    for (const s of [400, 401, 403, 404]) expect(shouldRetryQuery(0, api(s))).toBe(false);
  });

  it('retries server errors and network failures up to 3 times', () => {
    expect(shouldRetryQuery(0, api(500))).toBe(true);
    expect(shouldRetryQuery(2, api(503))).toBe(true);
    expect(shouldRetryQuery(3, api(500))).toBe(false);
    expect(shouldRetryQuery(0, new TypeError('Failed to fetch'))).toBe(true);
    expect(shouldRetryQuery(3, new TypeError('Failed to fetch'))).toBe(false);
  });

  it('treats 408/429 as retryable (transient client statuses)', () => {
    expect(shouldRetryQuery(0, api(408))).toBe(true);
    expect(shouldRetryQuery(0, api(429))).toBe(true);
  });

  // 1.23.23: the API client already tries a dropped read 3 times; the query adds none on top (no 3 × 4 requests).
  it('never retries a dropped read the API client already tried 3 times; one it stopped early on (page hidden, offline) still is', async () => {
    const tried = async (answers: number) => {
      vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
      let allowed = answers;
      const client = createApiClient({ baseUrl: 'http://api.test', getToken: () => null, networkRetry: { wait: async () => undefined, allowed: () => allowed-- > 0 } });
      return client.get('/tasks').catch((e: unknown) => e);
    };
    const full = await tried(4);
    expect(networkTries(full)).toBe(3);
    expect(shouldRetryQuery(0, full)).toBe(false);
    const early = await tried(0);
    expect(networkTries(early)).toBe(1);
    expect(shouldRetryQuery(0, early)).toBe(true);
    expect(clientRetriedNetwork(full)).toBe(true);
    expect(clientRetriedNetwork(early)).toBe(false);
    expect(clientRetriedNetwork(new TypeError('Failed to fetch'))).toBe(false);
    expect(clientRetriedNetwork(api(500))).toBe(false);
    vi.unstubAllGlobals();
  });
});
