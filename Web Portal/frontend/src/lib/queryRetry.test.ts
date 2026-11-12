import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { clientRetriedNetwork, DROPPED_READ_DELAY_MS, queryRetryDelay, retriesLeft, shouldRetryQuery } from './queryRetry';
import { ApiError, createApiClient, networkTries, READ_TRIES } from './api-client';

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

  // 1.23.23: the API client already tries a dropped read 3 times (in about 1.6 s); the query adds ONE more round,
  // about 4 s later (a connection back within about 7 s is never seen, as before) — 6 requests at most, not 3 × 4.
  it('a dropped read the API client already tried 3 times: one more round, 4 s later; one it stopped early on (page hidden, offline) as before', async () => {
    const tried = async (answers: number) => {
      vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
      let allowed = answers;
      const client = createApiClient({ baseUrl: 'http://api.test', getToken: () => null, networkRetry: { wait: async () => undefined, allowed: () => allowed-- > 0 } });
      return client.get('/tasks').catch((e: unknown) => e);
    };
    const full = await tried(4);
    expect(networkTries(full)).toBe(READ_TRIES);
    expect(shouldRetryQuery(0, full)).toBe(true);
    expect(shouldRetryQuery(1, full)).toBe(false);
    expect(queryRetryDelay(0, full)).toBe(DROPPED_READ_DELAY_MS);
    expect(DROPPED_READ_DELAY_MS).toBe(4000);
    const early = await tried(0);
    expect(networkTries(early)).toBe(1);
    expect(shouldRetryQuery(2, early)).toBe(true);
    expect(shouldRetryQuery(3, early)).toBe(false);
    expect(queryRetryDelay(0, early)).toBe(1000);
    expect(queryRetryDelay(2, early)).toBe(4000);
    expect(queryRetryDelay(1, api(500), 400)).toBe(400);
    expect(queryRetryDelay(1, full, 400)).toBe(DROPPED_READ_DELAY_MS);
    expect(clientRetriedNetwork(full)).toBe(true);
    expect(clientRetriedNetwork(early)).toBe(false);
    expect(clientRetriedNetwork(new TypeError('Failed to fetch'))).toBe(false);
    expect(clientRetriedNetwork(api(500))).toBe(false);
    // A page's own limit (2) is kept for anything else, and capped at the one round for such a read.
    expect(retriesLeft(1, api(500), 2)).toBe(true);
    expect(retriesLeft(2, api(500), 2)).toBe(false);
    expect(retriesLeft(0, full, 2)).toBe(true);
    expect(retriesLeft(1, full, 2)).toBe(false);
    vi.unstubAllGlobals();
  });

  // 1.23.23 review: a page with its own retry rule must not multiply the API client's tries either.
  it('every query’s own retry rule goes through this file’s rules (no 3 × 3 requests for a dropped read)', () => {
    const root = path.resolve(__dirname, '..');
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) files.push(p);
      }
    };
    walk(root);
    const bad: string[] = [];
    for (const f of files) {
      const lines = fs.readFileSync(f, 'utf8').split('\n');
      lines.forEach((line, i) => {
        const where = `${path.relative(root, f)}:${i + 1}`;
        // A query's predicate (failures, error) => …
        if (/\bretry:\s*\(\s*\w+\s*,\s*\w+\s*\)\s*=>/.test(line) && !/shouldRetryQuery|retriesLeft/.test(line)) bad.push(where);
        // A plain count multiplies the client's tries.
        if (/\bretry:\s*[1-9]/.test(line)) bad.push(where);
      });
    }
    expect(files.length).toBeGreaterThan(100);
    expect(bad).toEqual([]);
  });
});
