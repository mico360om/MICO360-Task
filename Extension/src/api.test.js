import { describe, it, expect, vi } from 'vitest';
import { createApi, ApiError } from './api.js';
import { DOWNLOAD_TIMEOUT_MS, REQUEST_TIMEOUT_MS } from './auth.js';
import { createReadCache } from './read-cache.js';
import { fakeStorage } from './test-helpers.js';

function fakeAuth(handler) {
  return { authedFetch: vi.fn(async (path, opts) => handler(path, opts)) };
}
const noCache = { read: async (_key, load) => ({ data: await load(), stale: false }) };
const json = (body, status = 200) => ({ ok: status < 300, status, json: async () => body, headers: { get: () => null } });

describe('api.reports', () => {
  it('reads each report with the filters (always fresh, never from the offline cache)', async () => {
    const auth = fakeAuth((path) => json({ data: path }));
    const cache = { read: vi.fn() };
    const api = createApi({ auth, cache });
    expect(await api.reports.projects({ projectId: 'p1' })).toBe('/reports/projects?projectId=p1');
    expect(await api.reports.status({ userId: 'u1' })).toBe('/reports/status?userId=u1');
    expect(await api.reports.workload({})).toBe('/reports/workload');
    expect(await api.reports.completion({ projectId: 'p1', userId: 'u1' })).toBe('/reports/completion?projectId=p1&userId=u1');
    expect(await api.reports.timeseries({ from: '2026-09-01', to: '2026-09-30', projectId: 'p1' })).toBe('/reports/timeseries?projectId=p1&from=2026-09-01&to=2026-09-30');
    expect(cache.read).not.toHaveBeenCalled();
  });
});

describe('api.version', () => {
  it('reads GET /version and keeps the answer, so the versions still show offline', async () => {
    const store = fakeStorage();
    let online = true;
    const auth = fakeAuth((path) => {
      if (!online) throw new TypeError('Failed to fetch');
      return json({ data: { version: '1.6.0', deployedAt: '2026-10-21T05:00:00Z', path } });
    });
    const api = createApi({ auth, cache: createReadCache(store) });
    expect(await api.version()).toMatchObject({ data: { version: '1.6.0', path: '/version' }, stale: false });
    online = false;
    expect(await api.version()).toMatchObject({ data: { version: '1.6.0' }, stale: true });
  });
});

describe('cached reads only keep real API answers (M6)', () => {
  const saved = () => fakeStorage({ 'cache:projects': { data: [{ id: 'p1', name: 'Ops' }], cachedAt: 1 } });

  it('a 200 page that is not JSON (a Wi-Fi sign-in page or a proxy) is not cached: the saved copy is shown instead', async () => {
    const store = saved();
    const portal = { ok: true, status: 200, headers: { get: (h) => (h.toLowerCase() === 'content-type' ? 'text/html; charset=utf-8' : null) }, json: async () => { throw new SyntaxError('Unexpected token <'); } };
    const api = createApi({ auth: fakeAuth(() => portal), cache: createReadCache(store) });
    const r = await api.projects.list();
    expect(r).toMatchObject({ data: [{ id: 'p1', name: 'Ops' }], stale: true });
    expect(store.data['cache:projects'].data).toEqual([{ id: 'p1', name: 'Ops' }]);
  });

  it('a JSON 200 without the API’s `data` is not cached either', async () => {
    for (const reply of [json({ hello: 'portal' }), { ...json(null), json: async () => { throw new SyntaxError('empty'); } }]) {
      const store = saved();
      const api = createApi({ auth: fakeAuth(() => reply), cache: createReadCache(store) });
      expect(await api.projects.list()).toMatchObject({ stale: true, data: [{ id: 'p1', name: 'Ops' }] });
      expect(store.data['cache:projects'].cachedAt).toBe(1);
    }
  });

  it('a real answer is cached as before', async () => {
    const store = saved();
    const reply = { ...json({ data: [{ id: 'p2' }] }), headers: { get: (h) => (h.toLowerCase() === 'content-type' ? 'application/json; charset=utf-8' : null) } };
    const api = createApi({ auth: fakeAuth(() => reply), cache: createReadCache(store) });
    expect(await api.projects.list()).toMatchObject({ stale: false, data: [{ id: 'p2' }] });
    expect(store.data['cache:projects'].data).toEqual([{ id: 'p2' }]);
  });
});

describe('reads show changes waiting to sync (H3)', () => {
  it('layers this person’s queued changes over the server’s copy, and says how many', async () => {
    const store = fakeStorage();
    const pending = vi.fn(async () => [
      { id: 'q1', kind: 'task.update', userId: 'u1', status: 'pending', payload: { id: 't1', patch: { title: 'Edited offline' }, expectedVersion: 2 } },
    ]);
    const api = createApi({ auth: fakeAuth(() => json({ data: { id: 't1', title: 'Server', version: 2 } })), cache: createReadCache(store), pending });
    const r = await api.tasks.get('t1');
    expect(r).toMatchObject({ data: { id: 't1', title: 'Edited offline', version: 2 }, stale: false, pending: 1 });
    expect(store.data['cache:task:t1'].data.title).toBe('Server'); // the offline copy keeps the server's answer
    const other = await api.tasks.get('t2');
    expect(other.pending).toBeUndefined();
  });
});

describe('api.download', () => {
  it('fetches a file with the session and returns it with the server’s file name', async () => {
    const blob = new Blob(['%PDF']);
    const auth = fakeAuth(() => ({ ok: true, status: 200, blob: async () => blob, headers: { get: (h) => (h.toLowerCase() === 'content-disposition' ? 'attachment; filename="tasks-report-2026-10-01.pdf"' : null) } }));
    const api = createApi({ auth, cache: noCache });
    const out = await api.download('/reports/export.pdf');
    expect(auth.authedFetch).toHaveBeenCalledWith('/reports/export.pdf', expect.objectContaining({ method: 'GET' }));
    expect(out).toEqual({ blob, fileName: 'tasks-report-2026-10-01.pdf' });
  });

  it('M4: waits longer for a file than for other calls (a large report on a slow server)', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    const auth = fakeAuth(() => ({ ok: true, status: 200, blob: async () => new Blob(['x']), headers: { get: () => null } }));
    await createApi({ auth, cache: noCache }).download('/tasks/t1/export.xlsx');
    expect(timeout).toHaveBeenCalledWith(DOWNLOAD_TIMEOUT_MS);
    expect(DOWNLOAD_TIMEOUT_MS).toBeGreaterThan(REQUEST_TIMEOUT_MS * 10);
    expect(auth.authedFetch.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
    timeout.mockRestore();
  });

  it('throws an ApiError with the server’s message when the download is refused', async () => {
    const auth = fakeAuth(() => json({ error: { code: 'FORBIDDEN', message: 'Admins only.' } }, 403));
    const api = createApi({ auth, cache: noCache });
    await expect(api.download('/reports/export.xlsx')).rejects.toMatchObject({ status: 403, code: 'FORBIDDEN' });
    await expect(api.download('/reports/export.xlsx')).rejects.toBeInstanceOf(ApiError);
  });
});
