import { describe, it, expect, vi } from 'vitest';
import { createExporter, type ExportFiles } from './exporter';
import { ApiError, NetworkError } from './api-client';

function fakeFiles(responses: { status: number; headers?: Record<string, string> }[]) {
  const calls: { url: string; name: string; headers: Record<string, string> }[] = [];
  const files: ExportFiles = {
    download: vi.fn(async (url: string, name: string, headers: Record<string, string>) => {
      calls.push({ url, name, headers });
      const r = responses.shift();
      if (!r) throw new Error('offline');
      return { status: r.status, headers: r.headers ?? {}, uri: `file:///cache/exports/${name}` };
    }),
    rename: vi.fn(async (uri: string, name: string) => uri.replace(/[^/]+$/, name)),
    remove: vi.fn(async () => {}),
    share: vi.fn(async () => {}),
  };
  return { files, calls };
}

function exporter(files: ExportFiles, over: Partial<Parameters<typeof createExporter>[0]> = {}) {
  return createExporter({
    baseUrl: 'https://tasks.example.com/api/v1',
    getToken: async () => 'tok1',
    refreshSession: vi.fn(async () => 'ok' as const),
    onUnauthorized: vi.fn(),
    files,
    ...over,
  });
}

describe('createExporter', () => {
  it('downloads with the session, renames to the server’s file name and opens the share sheet', async () => {
    const { files, calls } = fakeFiles([{ status: 200, headers: { 'Content-Disposition': 'attachment; filename="tasks-report-ops-2026-10-01.pdf"' } }]);
    const out = await exporter(files).exportFile('/reports/export.pdf?projectId=p1', 'tasks-report-2026-10-01.pdf', 'Tasks report');
    expect(calls[0]).toEqual({ url: 'https://tasks.example.com/api/v1/reports/export.pdf?projectId=p1', name: 'tasks-report-2026-10-01.pdf', headers: { Authorization: 'Bearer tok1' } });
    expect(files.rename).toHaveBeenCalledWith('file:///cache/exports/tasks-report-2026-10-01.pdf', 'tasks-report-ops-2026-10-01.pdf');
    expect(files.share).toHaveBeenCalledWith('file:///cache/exports/tasks-report-ops-2026-10-01.pdf', 'application/pdf', 'Tasks report');
    expect(out).toEqual({ uri: 'file:///cache/exports/tasks-report-ops-2026-10-01.pdf', fileName: 'tasks-report-ops-2026-10-01.pdf' });
  });

  it('keeps its own name when the server sends none', async () => {
    const { files } = fakeFiles([{ status: 200 }]);
    const out = await exporter(files).exportFile('/tasks/t1/export.xlsx', 'OPS-1-task.xlsx', 'OPS-1');
    expect(files.rename).not.toHaveBeenCalled();
    expect(files.share).toHaveBeenCalledWith('file:///cache/exports/OPS-1-task.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'OPS-1');
    expect(out.fileName).toBe('OPS-1-task.xlsx');
  });

  it('renews an expired session once and tries again', async () => {
    const { files, calls } = fakeFiles([{ status: 401 }, { status: 200 }]);
    let token = 'old';
    const refreshSession = vi.fn(async () => {
      token = 'new';
      return 'ok' as const;
    });
    await exporter(files, { getToken: async () => token, refreshSession }).exportFile('/reports/export.xlsx', 'r.xlsx', 'Report');
    expect(refreshSession).toHaveBeenCalledTimes(1);
    expect(calls.map((c) => c.headers.Authorization)).toEqual(['Bearer old', 'Bearer new']);
    expect(files.share).toHaveBeenCalledTimes(1);
  });

  it('signs out when the session is over, and never shares the error page', async () => {
    const { files } = fakeFiles([{ status: 401 }]);
    const onUnauthorized = vi.fn();
    const ex = exporter(files, { refreshSession: vi.fn(async () => 'invalid' as const), onUnauthorized });
    await expect(ex.exportFile('/reports/export.xlsx', 'r.xlsx', 'Report')).rejects.toBeInstanceOf(ApiError);
    expect(onUnauthorized).toHaveBeenCalled();
    expect(files.share).not.toHaveBeenCalled();
    expect(files.remove).toHaveBeenCalled();
  });

  it('reports a refused export (e.g. 403 for a non-admin) as an ApiError and removes the partial file', async () => {
    const { files } = fakeFiles([{ status: 403 }]);
    const err = await exporter(files).exportFile('/reports/export.pdf', 'r.pdf', 'Report').catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(403);
    expect(files.remove).toHaveBeenCalledWith('file:///cache/exports/r.pdf');
    expect(files.share).not.toHaveBeenCalled();
  });

  it('a failed connection is a NetworkError', async () => {
    const { files } = fakeFiles([]);
    await expect(exporter(files).exportFile('/reports/export.pdf', 'r.pdf', 'Report')).rejects.toBeInstanceOf(NetworkError);
  });
});
