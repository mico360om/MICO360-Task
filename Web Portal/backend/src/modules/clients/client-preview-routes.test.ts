import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import type { AuthGuard } from '../auth/auth-guard';
import { registerClientAccountRoutes } from './client-account-routes';
import type { ClientAccounts } from './client-accounts';
import type { PortalService, PortalViewer, PreviewSpec } from './portal-service';
import { HttpError } from '../../lib/http-errors';

// 1.23.7 Preview as client: administrators read the portal as a client would see it (saved access or the
// matrix still on screen). Read-only: only the portal's reads are reachable, each answer is marked, the
// opening of a preview is audited.
function setup(roles: string[]) {
  const specs: PreviewSpec[] = [];
  const audited: { action: string; newValue?: unknown }[] = [];
  const viewer = { client: { id: 'c1' }, preview: true } as unknown as PortalViewer;
  const reads: string[] = [];
  const portal = {
    async previewViewer(spec: PreviewSpec) { specs.push(spec); return viewer; },
    async home(v: PortalViewer) { reads.push(`home ${v === viewer}`); return { me: { name: 'Fatma' }, projects: [] }; },
    async project(v: PortalViewer, p: string) { reads.push(`project ${p} ${v === viewer}`); return { project: { id: p } }; },
    async task(v: PortalViewer, p: string, t: string) { reads.push(`task ${p} ${t} ${v === viewer}`); return { task: { id: t } }; },
    async meetings(v: PortalViewer, p: string) { reads.push(`meetings ${p} ${v === viewer}`); return []; },
    async meeting(v: PortalViewer, p: string, m: string) { reads.push(`meeting ${p} ${m} ${v === viewer}`); return { meeting: { id: m } }; },
    async notices(v: PortalViewer) { reads.push(`notices ${v === viewer}`); return { items: [], unread: 0 }; },
    async settings(v: PortalViewer) { reads.push(`settings ${v === viewer}`); return { settings: {}, projects: [] }; },
  } as unknown as PortalService;
  const guard = {
    authenticate: async (req: { user?: unknown }) => { req.user = { id: 'admin1', roles }; },
    requireRoles: (...need: string[]) => async (req: { user?: unknown }) => {
      req.user = { id: 'admin1', roles };
      if (!need.some((r) => roles.includes(r))) throw new HttpError('Forbidden', 'FORBIDDEN', 403);
    },
  } as unknown as AuthGuard;
  const app = Fastify();
  app.setErrorHandler((err: Error, _req, reply) => void reply.status((err as HttpError).status ?? (err.name === 'ZodError' ? 400 : 500)).send({ error: { code: (err as HttpError).code } }));
  return {
    app,
    specs,
    audited,
    reads,
    ready: registerClientAccountRoutes(app, {
      accounts: {} as ClientAccounts,
      guard,
      portal,
      canViewProject: async () => true,
      audit: { async record(e) { audited.push(e); return {}; } },
    }),
  };
}

const body = { clientId: 'c1', projects: [{ projectId: 'p1', role: 'VIEWER' }] };

describe('Preview as client', () => {
  it('reads the portal’s pages for the preview viewer, each answer marked a preview', async () => {
    const s = setup(['ADMIN']);
    await s.ready;
    const urls = ['/clients/preview/me', '/clients/preview/projects/p1', '/clients/preview/projects/p1/tasks/t1', '/clients/preview/projects/p1/meetings', '/clients/preview/projects/p1/meetings/m1', '/clients/preview/notifications', '/clients/preview/settings'];
    for (const url of urls) {
      const r = await s.app.inject({ method: 'POST', url, payload: body });
      expect(r.statusCode, url).toBe(200);
      expect(r.json().meta, url).toEqual({ preview: true });
    }
    expect(s.reads).toEqual(['home true', 'project p1 true', 'task p1 t1 true', 'meetings p1 true', 'meeting p1 m1 true', 'notices true', 'settings true']);
    expect(s.specs[0]).toMatchObject({ clientId: 'c1', projects: [{ projectId: 'p1', role: 'VIEWER' }] });
  });

  it('opening a preview (its home) is audited: whose, saved or on screen, with what access', async () => {
    const s = setup(['ADMIN']);
    await s.ready;
    await s.app.inject({ method: 'POST', url: '/clients/preview/me', payload: body });
    await s.app.inject({ method: 'POST', url: '/clients/preview/projects/p1', payload: body });
    expect(s.audited).toEqual([expect.objectContaining({ module: 'clients', action: 'client.preview', entityId: 'c1', newValue: { clientId: 'c1', unsaved: true, projects: [{ projectId: 'p1', access: expect.arrayContaining(['Viewer', 'View tasks']) }] } })]);
  });

  it('is for administrators only', async () => {
    const s = setup(['EMPLOYEE']);
    await s.ready;
    expect((await s.app.inject({ method: 'POST', url: '/clients/preview/me', payload: body })).statusCode).toBe(403);
    expect(s.reads).toEqual([]);
  });

  it('checks what it is given (lengths, ticks, nothing else)', async () => {
    const s = setup(['ADMIN']);
    await s.ready;
    expect((await s.app.inject({ method: 'POST', url: '/clients/preview/me', payload: { clientId: 'c1', firstName: 'x'.repeat(192) } })).statusCode).toBe(400);
    expect((await s.app.inject({ method: 'POST', url: '/clients/preview/me', payload: { projects: [{ projectId: 'p1', role: 'OWNER' }] } })).statusCode).toBe(400);
    expect((await s.app.inject({ method: 'POST', url: '/clients/preview/me', payload: { clientId: 'c1', password: 'x' } })).statusCode).toBe(400);
  });
});
