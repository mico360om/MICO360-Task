import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import { ZodError } from 'zod';
import type { AuthGuard } from '../auth/auth-guard';
import { HttpError } from '../../lib/http-errors';
import { createAttachmentService } from './attachment-service';
import { FILE_SHOW_REFUSED, registerAttachmentRoutes } from './attachment-routes';
import type { AttachmentRecord, AttachmentRepository } from './attachment-repository';

// 1.23.7 "Show to client" on a task's file: whoever runs the project (or an administrator) ticks it; clients
// of the project are told once, when it is first shown; every change is audited.
function setup(opts: { manager?: boolean; view?: boolean } = {}) {
  const rows = new Map<string, AttachmentRecord>([
    ['f1', { id: 'f1', taskId: 't1', uploadedById: 'c9', filename: 'Spec.pdf', mimeType: 'application/pdf', sizeBytes: 3, storageKey: 'k', url: '/uploads/k', createdAt: new Date(), fromClient: true, clientVisible: false }],
    ['f2', { id: 'f2', taskId: 't2', uploadedById: 'u1', filename: 'Other.pdf', mimeType: 'application/pdf', sizeBytes: 3, storageKey: 'k2', url: '/uploads/k2', createdAt: new Date(), clientVisible: false }],
  ]);
  const repo: AttachmentRepository = {
    async create() { throw new Error('no'); },
    async list(taskId) { return [...rows.values()].filter((r) => r.taskId === taskId); },
    async findById(id) { return rows.get(id) ?? null; },
    async delete(id) { rows.delete(id); },
    async setClientVisible(id, visible) { const r = { ...rows.get(id)!, clientVisible: visible }; rows.set(id, r); return r; },
  };
  const attachmentService = createAttachmentService({ repo, storage: { async save() { throw new Error('no'); }, async remove() {} }, taskLookup: { async exists() { return true; } }, maxSizeBytes: 10, allowedMimeTypes: [] });
  const audited: { action: string; entityId: string | null }[] = [];
  const shown: string[] = [];
  const guard = { authenticate: async (req: { user?: unknown }) => { req.user = { id: 'u1', roles: ['EMPLOYEE'] }; } } as unknown as AuthGuard;
  const app = Fastify();
  app.setErrorHandler((err: Error, _req, reply) => void reply.status(err instanceof ZodError ? 400 : ((err as HttpError).status ?? 500)).send({ error: { message: err.message } }));
  const ready = registerAttachmentRoutes(app, {
    attachmentService,
    guard,
    canViewTask: async () => opts.view !== false,
    canManageTask: async () => opts.manager !== false,
    onShownToClient: (id) => void shown.push(id),
    audit: { async record(e) { audited.push(e); return {}; } },
  });
  const put = async (url: string, payload: unknown) => {
    await ready;
    return app.inject({ method: 'PUT', url, payload: payload as object });
  };
  return { put, audited, shown, rows };
}

describe('"Show to client" on a task’s file', () => {
  it('who runs the project ticks it: saved, audited, clients told once', async () => {
    const s = setup();
    const r = await s.put('/tasks/t1/attachments/f1/client-visible', { visible: true });
    expect(r.statusCode).toBe(200);
    expect(r.json().data).toMatchObject({ id: 'f1', clientVisible: true, fromClient: true });
    await s.put('/tasks/t1/attachments/f1/client-visible', { visible: true }); // already shown: nothing new
    expect(s.shown).toEqual(['f1']);
    expect(s.audited.map((a) => a.action)).toEqual(['client-view.file.shown']);
    await s.put('/tasks/t1/attachments/f1/client-visible', { visible: false });
    expect(s.audited.map((a) => a.action)).toEqual(['client-view.file.shown', 'client-view.file.hidden']);
    expect(s.shown).toEqual(['f1']);
  });

  it('anyone else on the team is refused (403), and nothing changes', async () => {
    const s = setup({ manager: false });
    const r = await s.put('/tasks/t1/attachments/f1/client-visible', { visible: true });
    expect(r.statusCode).toBe(403);
    expect(r.json().error.message).toBe(FILE_SHOW_REFUSED);
    expect(s.rows.get('f1')!.clientVisible).toBe(false);
  });

  it('a task they can’t open is refused; another task’s file is not found; only a boolean is taken', async () => {
    expect((await setup({ view: false }).put('/tasks/t1/attachments/f1/client-visible', { visible: true })).statusCode).toBe(403);
    expect((await setup().put('/tasks/t1/attachments/f2/client-visible', { visible: true })).statusCode).toBe(404);
    expect((await setup().put('/tasks/t1/attachments/f1/client-visible', { visible: 'yes' })).statusCode).toBe(400);
  });
});
