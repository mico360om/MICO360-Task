import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { bindFileLinkRefresh, linkExpiry, reportFileLinkFailed } from './file-link-refresh';

// 1.23.29 Private file links (design §7.5): task and chat files' addresses are signed links that stop
// working 24–30 hours after they were given. A tab left open gets new ones an hour before the first one
// ends; a picture that fails to load (or a preview the server refuses) gets its list read again — at most
// once a minute, so a person who really lost access never causes a loop.

const H = 3600_000;
const T0 = Date.UTC(2026, 10, 13, 8, 0, 0);
const link = (key: string, expiresAtMs: number) => `/uploads/${key}?u=cmuser1&e=${Math.floor(expiresAtMs / 1000).toString(36)}&s=${'A'.repeat(43)}`;

let qc: QueryClient;
let unbind: () => void;
let reads: Record<string, number>;

/** A query read once and kept in the cache (no page shows it). */
async function query(key: readonly unknown[], data: () => unknown) {
  reads[JSON.stringify(key)] = 0;
  await qc.fetchQuery({ queryKey: key, queryFn: async () => { reads[JSON.stringify(key)]! += 1; return data(); }, staleTime: Infinity });
}
/** A query a page shows (an active observer): an invalidation reads it again. Resolves once read. */
async function watch(key: readonly unknown[], data: () => unknown): Promise<{ off: () => void; count: () => number }> {
  const name = JSON.stringify(key);
  reads[name] = 0;
  const obs = new QueryObserver(qc, { queryKey: key, queryFn: async () => { reads[name]! += 1; return data(); } });
  const off = obs.subscribe(() => {});
  await flush();
  return { off, count: () => reads[name]! };
}
/** Lets the query library finish what it started (it schedules with timers, which are fake here). */
async function flush() {
  for (let i = 0; i < 3; i++) await vi.advanceTimersByTimeAsync(0);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
  qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity, staleTime: Infinity } } });
  reads = {};
  unbind = bindFileLinkRefresh(qc);
});
afterEach(() => {
  unbind();
  qc.clear();
  vi.useRealTimers();
});

describe('linkExpiry', () => {
  it('reads a signed link’s expiry; a plain address has none', () => {
    expect(linkExpiry(link('a.png', T0 + 30 * H))).toBe(Math.floor((T0 + 30 * H) / 1000) * 1000);
    expect(linkExpiry('https://task.example/uploads/a.png?u=x&e=mhx4k0&s=abc')).toBe(parseInt('mhx4k0', 36) * 1000);
    expect(linkExpiry('/uploads/a.png')).toBeNull();
    expect(linkExpiry('/uploads/faces/a.png.webp')).toBeNull();
    expect(linkExpiry('')).toBeNull();
  });
});

describe('a list of files gets new links before its first one ends', () => {
  it('a task’s files: read again an hour before the earliest link ends, not before', async () => {
    const q = await watch(['attachments', 't1'], () => [{ id: 'f1', url: link('a.png', T0 + 25 * H) }, { id: 'f2', url: link('b.pdf', T0 + 29 * H) }]);
    expect(q.count()).toBe(1);
    await vi.advanceTimersByTimeAsync(24 * H - 1000);
    expect(q.count()).toBe(1);
    await vi.advanceTimersByTimeAsync(2000);
    await flush();
    expect(q.count()).toBe(2);
    q.off();
  });

  it('chat history pages too (an infinite list of messages with files)', async () => {
    const q = await watch(['chat', 'messages', 'conv1'], () => ({ pages: [[{ id: 'm1', attachments: [{ id: 'a1', url: link('c.png', T0 + 26 * H) }] }]], pageParams: [null] }));
    await vi.advanceTimersByTimeAsync(25 * H + 1000);
    await flush();
    expect(q.count()).toBe(2);
    q.off();
  });

  it('other queries (and lists of plain addresses) are left alone', async () => {
    await query(['projects'], () => [{ id: 'p1', imageUrl: link('p.png', T0 + 2 * H) }]);
    await query(['attachments', 't2'], () => [{ id: 'f', url: '/uploads/old.png' }]);
    await vi.advanceTimersByTimeAsync(3 * H);
    expect(qc.getQueryState(['projects'])?.isInvalidated).toBe(false);
    expect(qc.getQueryState(['attachments', 't2'])?.isInvalidated).toBe(false);
  });

  it('a wrong clock (links already past by it) reads a list a minute after it came, then at most hourly while the links stay the same', async () => {
    const q = await watch(['attachments', 't3'], () => [{ id: 'f', url: link('a.png', T0 - H) }]);
    expect(q.count()).toBe(1);
    await vi.advanceTimersByTimeAsync(59_000);
    await flush();
    expect(q.count()).toBe(1);
    await vi.advanceTimersByTimeAsync(2_000);
    await flush();
    expect(q.count()).toBe(2); // the server sent the same links: its clock says they still work
    await vi.advanceTimersByTimeAsync(59 * 60_000);
    await flush();
    expect(q.count()).toBe(2);
    await vi.advanceTimersByTimeAsync(2 * 60_000);
    await flush();
    expect(q.count()).toBe(3);
    q.off();
  });
});

describe('a picture that doesn’t load, or a refused preview', () => {
  it('reads again the list that holds that file — once every ten minutes at most (a picture that can’t be shown for another reason never loops)', async () => {
    const url = link('pic.png', T0 + 28 * H);
    const q = await watch(['attachments', 't4'], () => [{ id: 'f', url }]);
    reportFileLinkFailed(`https://task.example${url}`);
    await flush();
    expect(q.count()).toBe(2);
    reportFileLinkFailed(`https://task.example${url}`);
    await flush();
    expect(q.count()).toBe(2);
    await vi.advanceTimersByTimeAsync(61_000);
    reportFileLinkFailed(`https://task.example${url}`);
    await flush();
    expect(q.count()).toBe(2);
    await vi.advanceTimersByTimeAsync(9 * 60_000);
    reportFileLinkFailed(`https://task.example${url}`);
    await flush();
    expect(q.count()).toBe(3);
    q.off();
  });

  it('an <img> of a signed file that fails to load anywhere on the page counts as a failure', async () => {
    const url = link('chat.png', T0 + 28 * H);
    const q = await watch(['chat', 'messages', 'conv9'], () => ({ pages: [[{ id: 'm', attachments: [{ url }] }]], pageParams: [null] }));
    const img = document.createElement('img');
    img.setAttribute('src', `http://localhost:4000${url}`);
    document.body.append(img);
    img.dispatchEvent(new Event('error'));
    await flush();
    expect(q.count()).toBe(2);
    img.remove();
    q.off();
  });

  it('a failing photo or a plain address is not a file link: nothing is read again', async () => {
    const q = await watch(['attachments', 't5'], () => [{ id: 'f', url: link('x.png', T0 + 28 * H) }]);
    reportFileLinkFailed('http://localhost:4000/uploads/photo.png');
    const img = document.createElement('img');
    img.setAttribute('src', 'http://localhost:4000/uploads/faces/photo.png.webp');
    document.body.append(img);
    img.dispatchEvent(new Event('error'));
    await flush();
    expect(q.count()).toBe(1);
    img.remove();
    q.off();
  });

  it('stops listening once unbound', async () => {
    const url = link('gone.png', T0 + 28 * H);
    const q = await watch(['attachments', 't6'], () => [{ id: 'f', url }]);
    unbind();
    unbind = () => {};
    reportFileLinkFailed(url);
    await vi.advanceTimersByTimeAsync(28 * H);
    await flush();
    expect(q.count()).toBe(1);
    q.off();
  });
});
