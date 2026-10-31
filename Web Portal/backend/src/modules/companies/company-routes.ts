import { z } from 'zod';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { AuthGuard } from '../auth/auth-guard';
import { ConflictError, ValidationError } from '../../lib/http-errors';
import { idString } from '../tasks/validation';
import type { CompanyService } from './company-service';

/**
 * Companies (System → Companies), administrators only: the list, create and edit, the logo,
 * archive and unarchive, and each company's people and projects. Plus GET /me/companies — the
 * signed-in person's own companies, which the company picker shows.
 */

/** The details the Companies page sends; the service checks each one (with its words). */
const companyBody = z
  .object({ name: z.unknown(), code: z.unknown(), timeZone: z.unknown(), weekStart: z.unknown(), workingHours: z.unknown(), senderName: z.unknown() })
  .partial();
/** People added at once: at most this many. */
const MAX_PEOPLE = 200;
const peopleBody = z.object({ userIds: z.array(idString).min(1).max(MAX_PEOPLE) });

export interface CompanyRouteDeps {
  service: CompanyService;
  guard: AuthGuard;
}

export async function registerCompanyRoutes(app: FastifyInstance, deps: CompanyRouteDeps): Promise<void> {
  const { service, guard } = deps;
  const adminOnly = { preHandler: guard.requireRoles('ADMIN') };
  const actor = (req: FastifyRequest) => ({ id: req.user!.id, roles: req.user!.roles ?? [] });
  const idOf = (req: FastifyRequest) => (req.params as { id: string }).id;

  // The signed-in person's companies (administrators: every active one), for the company picker.
  app.get('/me/companies', { preHandler: guard.authenticate }, async (req) => ({ data: await service.mine(actor(req)) }));

  app.get('/companies', adminOnly, async () => ({ data: await service.list() }));

  app.post('/companies', adminOnly, async (req, reply) => {
    const body = companyBody.parse(req.body ?? {});
    return reply.status(201).send({ data: await service.create(body as never, actor(req), req.ip) });
  });

  app.get('/companies/:id', adminOnly, async (req) => ({ data: await service.get(idOf(req)) }));

  app.put('/companies/:id', adminOnly, async (req) => {
    const body = companyBody.parse(req.body ?? {});
    return { data: await service.update(idOf(req), body as never, actor(req), req.ip) };
  });

  // The logo: a PNG, JPEG or WebP picture up to 2 MB (multipart field "file"), stored smaller.
  app.post('/companies/:id/logo', adminOnly, async (req) => {
    const file = await req.file();
    if (!file) throw new ValidationError('No file uploaded.');
    const buffer = await file.toBuffer();
    return { data: await service.setLogo(idOf(req), { buffer, mimetype: file.mimetype }, actor(req), req.ip) };
  });

  app.delete('/companies/:id/logo', adminOnly, async (req) => ({ data: await service.clearLogo(idOf(req), actor(req), req.ip) }));

  // Archive: its projects count as archived and its people lose access through it (never the last active company).
  app.post('/companies/:id/archive', adminOnly, async (req) => ({ data: await service.archive(idOf(req), actor(req), req.ip) }));

  app.post('/companies/:id/unarchive', adminOnly, async (req) => ({ data: await service.unarchive(idOf(req), actor(req), req.ip) }));

  app.get('/companies/:id/people', adminOnly, async (req) => ({ data: await service.people(idOf(req)) }));

  // Add people: who joined, and who couldn't (with why).
  app.post('/companies/:id/people', adminOnly, async (req) => {
    const { userIds } = peopleBody.parse(req.body);
    return { data: await service.addPeople(idOf(req), userIds, actor(req), req.ip) };
  });

  // Take one person out: refused (409) with the rule's words when they must keep this company.
  app.delete('/companies/:id/people/:userId', adminOnly, async (req, reply) => {
    const { id, userId } = req.params as { id: string; userId: string };
    const result = await service.removePerson(id, userId, actor(req), req.ip);
    const refused = result.refused[0];
    if (refused) throw new ConflictError(refused.reason, 'LAST_COMPANY');
    return reply.status(204).send();
  });

  app.get('/companies/:id/projects', adminOnly, async (req) => ({ data: await service.projects(idOf(req)) }));
}
