import { z } from 'zod';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AuthGuard } from '../auth/auth-guard';
import { longText } from '../tasks/validation';
import type { PortalService } from './portal-service';

/**
 * 1.23 The Client portal's API. Every route is a client route (client-route-table.ts): the auth guard
 * refuses staff sessions on them and client sessions everywhere else. Each handler goes through the
 * portal service's gate (portal-service.ts) — project grant, module, action, then the item itself.
 */
export interface PortalRouteDeps {
  service: PortalService;
  guard: AuthGuard;
  /** PDFs a client may download a minute (default 10). */
  pdfsPerMinute?: number;
}

const commentBody = z.object({ body: longText.refine((s) => s.trim().length > 0, { message: 'A comment cannot be empty.' }) });
const sendBackBody = z.object({ reason: z.string().trim().min(1, 'Say why you are sending it back.').max(2000, 'A reason has at most 2,000 characters.') });
const responseBody = z.object({ response: z.enum(['ACCEPTED', 'TENTATIVE', 'DECLINED']) });

type Params = { projectId?: string; taskId?: string; meetingId?: string; itemId?: string };

export async function registerPortalRoutes(app: FastifyInstance, deps: PortalRouteDeps): Promise<void> {
  const { service, guard } = deps;
  const signedIn = { preHandler: guard.authenticate };
  const me = (req: FastifyRequest) => req.user!.id;
  const p = (req: FastifyRequest) => req.params as Params;
  const ip = (req: FastifyRequest) => ({ ip: req.ip ?? null });
  const pdfLimit = {
    preHandler: guard.authenticate,
    // Per signed-in person (the site's own key: their user id from the token), separately from other routes.
    config: { rateLimit: { max: deps.pdfsPerMinute ?? 10, timeWindow: '1 minute' } },
  };
  const sendPdf = (reply: FastifyReply, out: { pdf: Buffer; fileName: string }) =>
    reply.header('Content-Type', 'application/pdf').header('Content-Disposition', `attachment; filename="${out.fileName}"`).header('Cache-Control', 'no-store').send(out.pdf);

  app.get('/portal/me', signedIn, async (req) => ({ data: await service.home(me(req)) }));

  app.get('/portal/projects/:projectId', signedIn, async (req) => ({ data: await service.project(me(req), p(req).projectId) }));

  app.get('/portal/projects/:projectId/tasks/:taskId', signedIn, async (req) => ({ data: await service.task(me(req), p(req).projectId, p(req).taskId) }));

  app.post('/portal/projects/:projectId/tasks/:taskId/comments', signedIn, async (req, reply) => {
    const { body } = commentBody.parse(req.body ?? {});
    return reply.status(201).send({ data: await service.comment(me(req), p(req).projectId, p(req).taskId, body, ip(req)) });
  });

  app.post('/portal/projects/:projectId/tasks/:taskId/accept', signedIn, async (req) => ({ data: await service.accept(me(req), p(req).projectId, p(req).taskId, ip(req)) }));

  app.post('/portal/projects/:projectId/tasks/:taskId/send-back', signedIn, async (req) => {
    const { reason } = sendBackBody.parse(req.body ?? {});
    return { data: await service.sendBack(me(req), p(req).projectId, p(req).taskId, reason, ip(req)) };
  });

  app.get('/portal/projects/:projectId/tasks.pdf', pdfLimit, async (req, reply) => sendPdf(reply, await service.taskListPdf(me(req), p(req).projectId, ip(req))));

  app.get('/portal/projects/:projectId/meetings', signedIn, async (req) => ({ data: await service.meetings(me(req), p(req).projectId) }));

  app.get('/portal/projects/:projectId/meetings/:meetingId', signedIn, async (req) => ({ data: await service.meeting(me(req), p(req).projectId, p(req).meetingId) }));

  app.post('/portal/projects/:projectId/meetings/:meetingId/response', signedIn, async (req) => {
    const { response } = responseBody.parse(req.body ?? {});
    return { data: await service.respond(me(req), p(req).projectId, p(req).meetingId, response, ip(req)) };
  });

  app.get('/portal/projects/:projectId/meetings/:meetingId/minutes.pdf', pdfLimit, async (req, reply) =>
    sendPdf(reply, await service.minutesPdf(me(req), p(req).projectId, p(req).meetingId, ip(req))),
  );

  app.post('/portal/projects/:projectId/action-items/:itemId/done', signedIn, async (req) => ({ data: await service.completeItem(me(req), p(req).projectId, p(req).itemId, ip(req)) }));

  // An invitation email links to /meetings/<id>: the portal asks where that meeting is.
  app.get('/portal/meetings/:meetingId', signedIn, async (req) => ({ data: await service.whereIs(me(req), p(req).meetingId) }));
}
