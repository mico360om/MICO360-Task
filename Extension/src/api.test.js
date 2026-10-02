import { describe, it, expect, vi } from 'vitest';
import { createApi, ApiError } from './api.js';

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

describe('api.download', () => {
  it('fetches a file with the session and returns it with the server’s file name', async () => {
    const blob = new Blob(['%PDF']);
    const auth = fakeAuth(() => ({ ok: true, status: 200, blob: async () => blob, headers: { get: (h) => (h.toLowerCase() === 'content-disposition' ? 'attachment; filename="tasks-report-2026-10-01.pdf"' : null) } }));
    const api = createApi({ auth, cache: noCache });
    const out = await api.download('/reports/export.pdf');
    expect(auth.authedFetch).toHaveBeenCalledWith('/reports/export.pdf', { method: 'GET' });
    expect(out).toEqual({ blob, fileName: 'tasks-report-2026-10-01.pdf' });
  });

  it('throws an ApiError with the server’s message when the download is refused', async () => {
    const auth = fakeAuth(() => json({ error: { code: 'FORBIDDEN', message: 'Admins only.' } }, 403));
    const api = createApi({ auth, cache: noCache });
    await expect(api.download('/reports/export.xlsx')).rejects.toMatchObject({ status: 403, code: 'FORBIDDEN' });
    await expect(api.download('/reports/export.xlsx')).rejects.toBeInstanceOf(ApiError);
  });
});
