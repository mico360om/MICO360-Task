import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import { registerTaskExportRoutes } from './task-export-routes';
import type { TaskExportData } from './task-export';
import { inspectXlsx } from '../../lib/xlsx-inspect';
import { inspectPdf } from '../../lib/pdf-inspect';

const data: TaskExportData = {
  key: 'MICO-7', title: 'Inspect the rig', description: null, projectName: 'Rig Inspection Portal', projectCode: 'RIG', status: 'To do', category: 'TODO', priority: 'NORMAL',
  startDate: null, dueDate: null, completedAt: null, createdAt: new Date('2026-09-01T00:00:00Z'), updatedAt: new Date('2026-09-01T00:00:00Z'), progress: 0, estimatedHours: null, actualHours: null,
  createdBy: 'Aisha Khan', assignees: [], watchers: [], tags: [], repeat: null, overdue: false, checklist: [], blockedBy: [], blocks: [], attachments: [], comments: [], activity: [],
};

async function makeApp(opts: { canView?: boolean; userId?: string | null } = {}) {
  const app = Fastify();
  const guard = {
    authenticate: async (req: { user?: unknown }, reply: { status: (n: number) => { send: (b: unknown) => unknown } }) => {
      if (opts.userId === null) return reply.status(401).send({ error: { code: 'UNAUTHORIZED' } });
      req.user = { id: opts.userId ?? 'u1', roles: ['EMPLOYEE'] };
    },
  };
  await registerTaskExportRoutes(app, {
    guard: guard as never,
    source: { async load(id) { return id === 't1' ? data : null; } },
    canViewTask: async () => opts.canView ?? true,
    userName: async () => 'Omar Ahmed',
    timeZone: 'Asia/Muscat',
  });
  return app;
}

describe('Task export routes', () => {
  it('downloads a task as an .xlsx workbook named after its key', async () => {
    const res = await (await makeApp()).inject({ method: 'GET', url: '/tasks/t1/export.xlsx' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    expect(res.headers['content-disposition']).toMatch(/attachment; filename="MICO-7-inspect-the-rig\.xlsx"/);
    expect(res.headers['cache-control']).toBe('no-store');
    const { sheets, text } = inspectXlsx(res.rawPayload);
    expect(sheets[0]).toBe('Task');
    expect(text[0]!.join(' ')).toContain('by Omar Ahmed');
  });

  it('downloads a task as a PDF', async () => {
    const res = await (await makeApp()).inject({ method: 'GET', url: '/tasks/t1/export.pdf' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['content-disposition']).toMatch(/MICO-7-inspect-the-rig\.pdf/);
    expect(inspectPdf(res.rawPayload).pages.flat()).toContain('Inspect the rig');
  });

  it('hides tasks the user cannot see (404), like opening the task', async () => {
    const app = await makeApp({ canView: false });
    expect((await app.inject({ method: 'GET', url: '/tasks/t1/export.pdf' })).statusCode).toBe(404);
    expect((await (await makeApp()).inject({ method: 'GET', url: '/tasks/nope/export.xlsx' })).statusCode).toBe(404);
  });

  it('requires sign-in (401)', async () => {
    expect((await (await makeApp({ userId: null })).inject({ method: 'GET', url: '/tasks/t1/export.xlsx' })).statusCode).toBe(401);
  });
});
