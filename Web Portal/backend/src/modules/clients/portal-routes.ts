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
  /** Comments, sign-offs and answers a client may send a minute (default 20): each one tells the team. */
  writesPerMinute?: number;
  /** 1.23.7: files a client may download a minute (default 30). */
  filesPerMinute?: number;
}

/**
 * 1.23.7 A file's type as sent to a client's browser: the stored type when it is one a browser shows
 * safely, else a plain download. The file always comes as an attachment, never sniffed, in a sandbox.
 */
const SAFE_TYPES = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'text/plain',
  'text/csv',
  'application/zip',
  'application/msword',
  'application/vnd.ms-excel',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
]);
export const downloadType = (mime: string) => (SAFE_TYPES.has(String(mime).toLowerCase()) ? String(mime).toLowerCase() : 'application/octet-stream');

/** Content-Disposition for a file's own name: an ASCII fallback and the UTF-8 name (RFC 6266 / 5987). */
export function attachmentDisposition(name: string): string {
  // Control characters (a line break could end the header) become spaces.
  const clean = [...String(name)].map((c) => (c.charCodeAt(0) < 0x20 || c.charCodeAt(0) === 0x7f ? ' ' : c)).join('').trim() || 'file';
  const ascii = clean.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  const utf8 = encodeURIComponent(clean).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${utf8}`;
}

/** The client's notification switches: booleans only, nothing else. */
const settingsBody = z.object({ reply: z.boolean().optional(), signOff: z.boolean().optional(), minutes: z.boolean().optional(), document: z.boolean().optional() }).strict();

const commentBody = z.object({ body: longText.refine((s) => s.trim().length > 0, { message: 'A comment cannot be empty.' }) });
const sendBackBody = z.object({ reason: z.string().trim().min(1, 'Say why you are sending it back.').max(2000, 'A reason has at most 2,000 characters.') });
const responseBody = z.object({ response: z.enum(['ACCEPTED', 'TENTATIVE', 'DECLINED']) });

type Params = { projectId?: string; taskId?: string; meetingId?: string; itemId?: string; fileId?: string; noticeId?: string };

export async function registerPortalRoutes(app: FastifyInstance, deps: PortalRouteDeps): Promise<void> {
  const { service, guard } = deps;
  const signedIn = { preHandler: guard.authenticate };
  // Every write tells the team (the bell, phone pushes, emails): a client can't flood them (security review).
  const write = { preHandler: guard.authenticate, config: { rateLimit: { max: deps.writesPerMinute ?? 20, timeWindow: '1 minute' } } };
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

  app.post('/portal/projects/:projectId/tasks/:taskId/comments', write, async (req, reply) => {
    const { body } = commentBody.parse(req.body ?? {});
    return reply.status(201).send({ data: await service.comment(me(req), p(req).projectId, p(req).taskId, body, ip(req)) });
  });

  app.post('/portal/projects/:projectId/tasks/:taskId/accept', write, async (req) => ({ data: await service.accept(me(req), p(req).projectId, p(req).taskId, ip(req)) }));

  app.post('/portal/projects/:projectId/tasks/:taskId/send-back', write, async (req) => {
    const { reason } = sendBackBody.parse(req.body ?? {});
    return { data: await service.sendBack(me(req), p(req).projectId, p(req).taskId, reason, ip(req)) };
  });

  app.get('/portal/projects/:projectId/tasks.pdf', pdfLimit, async (req, reply) => sendPdf(reply, await service.taskListPdf(me(req), p(req).projectId, ip(req))));

  app.get('/portal/projects/:projectId/meetings', signedIn, async (req) => ({ data: await service.meetings(me(req), p(req).projectId) }));

  app.get('/portal/projects/:projectId/meetings/:meetingId', signedIn, async (req) => ({ data: await service.meeting(me(req), p(req).projectId, p(req).meetingId) }));

  app.post('/portal/projects/:projectId/meetings/:meetingId/response', write, async (req) => {
    const { response } = responseBody.parse(req.body ?? {});
    return { data: await service.respond(me(req), p(req).projectId, p(req).meetingId, response, ip(req)) };
  });

  app.get('/portal/projects/:projectId/meetings/:meetingId/minutes.pdf', pdfLimit, async (req, reply) =>
    sendPdf(reply, await service.minutesPdf(me(req), p(req).projectId, p(req).meetingId, ip(req))),
  );

  app.post('/portal/projects/:projectId/action-items/:itemId/done', write, async (req) => ({ data: await service.completeItem(me(req), p(req).projectId, p(req).itemId, ip(req)) }));

  // An invitation email links to /meetings/<id>: the portal asks where that meeting is.
  app.get('/portal/meetings/:meetingId', signedIn, async (req) => ({ data: await service.whereIs(me(req), p(req).meetingId) }));

  // 1.23.7 Upload a document to a shared task (Upload permission). The gate runs before the file is read.
  app.post('/portal/projects/:projectId/tasks/:taskId/files', write, async (req, reply) => {
    const read = async () => {
      const file = await req.file();
      if (!file) return null;
      return { filename: file.filename, mimeType: file.mimetype, content: await file.toBuffer() };
    };
    return reply.status(201).send({ data: await service.upload(me(req), p(req).projectId, p(req).taskId, read, ip(req)) });
  });

  // 1.23.7 A file of a shared task (View tasks): through the portal, never its stored address.
  app.get(
    '/portal/projects/:projectId/tasks/:taskId/files/:fileId',
    { preHandler: guard.authenticate, config: { rateLimit: { max: deps.filesPerMinute ?? 30, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const out = await service.file(me(req), p(req).projectId, p(req).taskId, p(req).fileId, ip(req));
      return reply
        .header('Content-Type', downloadType(out.mimeType))
        .header('Content-Disposition', attachmentDisposition(out.filename))
        .header('X-Content-Type-Options', 'nosniff')
        .header('Content-Security-Policy', "sandbox; default-src 'none'")
        .header('Cache-Control', 'no-store')
        .send(out.content);
    },
  );

  // 1.23.7 The portal's bell and the client's notification switches.
  app.get('/portal/notifications', signedIn, async (req) => ({ data: await service.notices(me(req)) }));
  app.post('/portal/notifications/:noticeId/read', signedIn, async (req) => ({ data: await service.readNotice(me(req), p(req).noticeId) }));
  app.post('/portal/notifications/read-all', signedIn, async (req) => ({ data: await service.readAllNotices(me(req)) }));
  app.get('/portal/settings/notifications', signedIn, async (req) => ({ data: await service.settings(me(req)) }));
  app.put('/portal/settings/notifications', write, async (req) => ({ data: await service.setSettings(me(req), settingsBody.parse(req.body ?? {}), ip(req)) }));
}
