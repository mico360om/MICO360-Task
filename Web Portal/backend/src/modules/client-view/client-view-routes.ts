import { z } from 'zod';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AuthGuard } from '../auth/auth-guard';
import type { AuditService } from '../audit/audit-service';
import type { RecordTaskActivity } from '../activity/task-activity';
import { noteActivity } from '../activity/task-activity';
import type { TaskRecord } from '../tasks/task-repository';
import { ConflictError, ForbiddenError, NotFoundError } from '../../lib/http-errors';
import type { ClientAccessService } from './client-access-service';
import { clearedSessionCookie, hashToken, readCookie, sessionCookie, sessionCookieName } from './client-tokens';
import { clientMinutesContent } from './client-minutes-content';
import type { FinalMinutesContent } from '../meetings/final-minutes';

/** "Show to client" on tasks (milestones are tasks). */
export interface ClientTaskFlags {
  /** The task's project; null when the task (or its project) is gone. */
  projectOf(taskId: string): Promise<string | null>;
  /** Sets the flag; returns what it was and the task as it now is (for its history and open boards). */
  setClientVisible(taskId: string, visible: boolean): Promise<{ before: boolean; task: TaskRecord }>;
}

/** "Show to client" on a meeting's approved final minutes. */
export interface ClientMinutesFlags {
  /** The meeting's project: null for a standalone meeting, undefined when the meeting is gone. */
  projectOf(meetingId: string): Promise<string | null | undefined>;
  /** Its final minutes' state (null: none written); includeRisks: shown with their risks and open issues. */
  state(meetingId: string): Promise<{ approved: boolean; clientVisible: boolean; includeRisks: boolean } | null>;
  /**
   * Sets the flag (for the project the meeting is filed under now, with or without the risks); turning
   * it on works only while the minutes are approved (false otherwise).
   */
  set(meetingId: string, visible: boolean, opts: { includeRisks: boolean }): Promise<boolean>;
  /** The approved minutes and the names of the people they may mention (null: not approved). */
  preview(meetingId: string): Promise<{ content: FinalMinutesContent; names: string[] } | null>;
}

export interface ClientViewRouteDeps {
  service: ClientAccessService;
  guard: AuthGuard;
  /** Mark the session cookie Secure (production). A request that came over https gets it anyway. */
  secureCookies: boolean;
  /** May they see the project at all (else 404, so outsiders don't learn it exists). */
  canViewProject: (userId: string, roles: string[], projectId: string) => Promise<boolean>;
  /** Do they run it — its owner, named manager or a MANAGER member — or are they an admin (else 403)? */
  canManageProject: (userId: string, roles: string[], projectId: string) => Promise<boolean>;
  canViewTask?: (userId: string, roles: string[], taskId: string) => Promise<boolean>;
  canViewMeeting?: (userId: string, roles: string[], meetingId: string) => Promise<boolean>;
  tasks?: ClientTaskFlags;
  minutes?: ClientMinutesFlags;
  /** A task's history line ("made this visible to the client"). */
  recordActivity?: RecordTaskActivity;
  audit?: AuditService;
  /** Tells open boards a task changed. */
  broadcast?: (projectId: string, event: string, payload: unknown) => void;
  /** Tells open meeting pages the minutes changed. */
  onMinutesChanged?: (meetingId: string) => void;
  /** Per IP address, a minute: code requests (default 5) and code tries (default 10); minutes PDFs per signed-in device (default 10). */
  rateLimits?: { codesPerMinute?: number; verifiesPerMinute?: number; pdfsPerMinute?: number };
}

const shareBody = z.object({
  name: z.string().trim().min(1, 'Enter the client’s name.').max(120, 'A name has at most 120 characters.'),
  email: z.string().trim().max(254, 'An email address has at most 254 characters.').email('Enter a valid email address.'),
});
const visibleBody = z.object({ visible: z.boolean() });
const minutesVisibleBody = z.object({ visible: z.boolean(), includeRisks: z.boolean().optional() });
const codeBody = z.object({ email: z.string().max(254) });
const verifyBody = z.object({ email: z.string().max(254), code: z.string().max(12) });

const CHANGE_REFUSED = 'Only this project’s owner, its managers or an administrator can share it with a client.';
const MARK_REFUSED = 'Only this project’s owner, its managers or an administrator can show its items to a client.';

/**
 * Two sets of routes. The client's own, under /client/: no staff sign-in at all — they read the
 * link from the X-Client-Link header and the device's session from its cookie, and never look at
 * an Authorization header. And the staff routes that share a project and mark its items, which
 * need a staff sign-in and someone who runs the project (or an admin).
 */
export async function registerClientViewRoutes(app: FastifyInstance, deps: ClientViewRouteDeps): Promise<void> {
  const { service, guard } = deps;
  const viewer = (req: FastifyRequest) => ({ id: req.user!.id, roles: req.user!.roles ?? [] });
  const secure = (req: FastifyRequest) => deps.secureCookies || req.protocol === 'https';
  const linkOf = (req: FastifyRequest): string | null => {
    const v = req.headers['x-client-link'];
    return typeof v === 'string' ? v : null;
  };
  const sessionFrom = (req: FastifyRequest) => (shareId: string) => readCookie(req.headers.cookie, sessionCookieName(shareId));
  const perIp = (prefix: string, max: number) => ({
    config: { rateLimit: { max, timeWindow: '1 minute', keyGenerator: (req: FastifyRequest) => `${prefix}:${req.ip}` } },
  });

  // ── The client's page ────────────────────────────────────────────────────

  app.get('/client/view', async (req) => ({ data: await service.view(linkOf(req), sessionFrom(req)) }));

  app.post('/client/code', perIp('client-code', deps.rateLimits?.codesPerMinute ?? 5), async (req, reply) => {
    const { email } = codeBody.parse(req.body ?? {});
    return reply.status(202).send({ data: await service.requestCode(linkOf(req), email, { ip: req.ip }) });
  });

  app.post('/client/verify', perIp('client-verify', deps.rateLimits?.verifiesPerMinute ?? 10), async (req, reply) => {
    const { email, code } = verifyBody.parse(req.body ?? {});
    const signedIn = await service.verifyCode(linkOf(req), email, code, { ip: req.ip });
    reply.header('Set-Cookie', sessionCookie(sessionCookieName(signedIn.shareId), signedIn.token, { maxAgeSeconds: signedIn.maxAgeSeconds, secure: secure(req) }));
    return { data: { signedIn: true } };
  });

  app.post('/client/sign-out', async (req, reply) => {
    const { shareId } = await service.signOut(linkOf(req), sessionFrom(req));
    reply.header('Set-Cookie', clearedSessionCookie(sessionCookieName(shareId), { secure: secure(req) }));
    return reply.status(204).send();
  });

  // A PDF takes real work to make: each signed-in device (its link and session cookie) gets 10 a minute.
  const perSession = {
    config: {
      rateLimit: {
        max: deps.rateLimits?.pdfsPerMinute ?? 10,
        timeWindow: '1 minute',
        keyGenerator: (req: FastifyRequest) => `client-pdf:${hashToken(`${linkOf(req) ?? ''}|${req.headers.cookie ?? req.ip}`)}`,
      },
    },
  };
  app.get('/client/minutes/:meetingId/pdf', perSession, async (req: FastifyRequest, reply: FastifyReply) => {
    const { meetingId } = req.params as { meetingId: string };
    const { pdf, fileName } = await service.minutesPdf(linkOf(req), sessionFrom(req), meetingId);
    return reply.header('Content-Type', 'application/pdf').header('Content-Disposition', `attachment; filename="${fileName}"`).send(pdf);
  });

  // A shown inspection report’s client copy (as many a minute as the minutes PDFs).
  app.get('/client/inspections/:inspectionId/pdf', perSession, async (req: FastifyRequest, reply: FastifyReply) => {
    const { inspectionId } = req.params as { inspectionId: string };
    const { pdf, fileName } = await service.inspectionPdf(linkOf(req), sessionFrom(req), inspectionId);
    return reply.header('Content-Type', 'application/pdf').header('Content-Disposition', `attachment; filename="${fileName}"`).send(pdf);
  });

  // ── Staff: sharing a project ─────────────────────────────────────────────

  /** 404 for someone who can't see the project, 403 for its members who don't run it. */
  async function mayShare(req: FastifyRequest, projectId: string): Promise<void> {
    const user = viewer(req);
    if (!(await deps.canViewProject(user.id, user.roles, projectId))) throw new NotFoundError('Project not found.');
    if (!(await deps.canManageProject(user.id, user.roles, projectId))) throw new ForbiddenError(CHANGE_REFUSED);
  }

  app.get('/projects/:id/client-shares', { preHandler: guard.authenticate }, async (req) => {
    const { id } = req.params as { id: string };
    await mayShare(req, id);
    return { data: await service.listShares(id) };
  });

  app.post('/projects/:id/client-shares', { preHandler: guard.authenticate }, async (req, reply) => {
    const { id } = req.params as { id: string };
    await mayShare(req, id);
    const body = shareBody.parse(req.body ?? {});
    const created = await service.share({ projectId: id, name: body.name, email: body.email, actorId: req.user!.id, ip: req.ip });
    return reply.status(201).send({ data: created });
  });

  app.post('/projects/:id/client-shares/:shareId/resend', { preHandler: guard.authenticate }, async (req) => {
    const { id, shareId } = req.params as { id: string; shareId: string };
    await mayShare(req, id);
    return { data: await service.resend({ projectId: id, shareId, actorId: req.user!.id, ip: req.ip }) };
  });

  app.delete('/projects/:id/client-shares/:shareId', { preHandler: guard.authenticate }, async (req, reply) => {
    const { id, shareId } = req.params as { id: string; shareId: string };
    await mayShare(req, id);
    await service.remove({ projectId: id, shareId, actorId: req.user!.id, ip: req.ip });
    return reply.status(204).send();
  });

  // ── Staff: "Show to client" ──────────────────────────────────────────────

  const audit = (req: FastifyRequest, action: string, entityId: string, newValue: unknown) =>
    deps.audit?.record({ userId: req.user!.id, ip: req.ip ?? null, module: 'client-view', action, entityId, newValue }).catch(() => undefined);

  if (deps.tasks) {
    const tasks = deps.tasks;
    app.put('/tasks/:id/client-visible', { preHandler: guard.authenticate }, async (req) => {
      const { id } = req.params as { id: string };
      const user = viewer(req);
      const projectId = await tasks.projectOf(id);
      if (!projectId || (deps.canViewTask && !(await deps.canViewTask(user.id, user.roles, id)))) throw new NotFoundError('Task not found.');
      if (!(await deps.canManageProject(user.id, user.roles, projectId))) throw new ForbiddenError(MARK_REFUSED);
      const { visible } = visibleBody.parse(req.body ?? {});
      const { before, task } = await tasks.setClientVisible(id, visible);
      if (before !== visible) {
        await noteActivity(deps.recordActivity, { taskId: id, userId: user.id, action: 'UPDATED', meta: { changes: [{ field: 'clientVisible', from: before, to: visible }] } });
        await audit(req, visible ? 'client-view.task.shown' : 'client-view.task.hidden', id, { projectId });
      }
      deps.broadcast?.(projectId, 'task:updated', task);
      return { data: task };
    });
  }

  if (deps.minutes) {
    const minutes = deps.minutes;
    /** The meeting's project (404 for someone who can't see the meeting). */
    const meetingProject = async (req: FastifyRequest, meetingId: string) => {
      const user = viewer(req);
      const projectId = await minutes.projectOf(meetingId);
      if (projectId === undefined || (deps.canViewMeeting && !(await deps.canViewMeeting(user.id, user.roles, meetingId)))) throw new NotFoundError('Meeting not found.');
      return projectId;
    };
    const stateOf = async (req: FastifyRequest, meetingId: string, projectId: string | null) => {
      const user = viewer(req);
      const s = await minutes.state(meetingId);
      return {
        projectMeeting: projectId !== null,
        approved: s?.approved ?? false,
        clientVisible: s?.clientVisible ?? false,
        includeRisks: s?.includeRisks ?? false,
        canChange: projectId !== null && (await deps.canManageProject(user.id, user.roles, projectId)),
      };
    };

    app.get('/meetings/:id/client-visibility', { preHandler: guard.authenticate }, async (req) => {
      const { id } = req.params as { id: string };
      return { data: await stateOf(req, id, await meetingProject(req, id)) };
    });

    /** A project meeting whose minutes the person may show (409 standalone, 403 not theirs to run). */
    const meetingToShow = async (req: FastifyRequest, id: string): Promise<string> => {
      const user = viewer(req);
      const projectId = await meetingProject(req, id);
      if (projectId === null) throw new ConflictError('Only a project’s meetings can be shown to its client.', 'NOT_A_PROJECT_MEETING');
      if (!(await deps.canManageProject(user.id, user.roles, projectId))) throw new ForbiddenError(MARK_REFUSED);
      return projectId;
    };
    const notFinal = () => new ConflictError('Mark the minutes final before showing them to the client.', 'MINUTES_NOT_FINAL');

    // Exactly what the client would see (owners off the next steps; the risks, which are shown only
    // when ticked) and the names to highlight, so whoever shows them checks them first.
    app.get('/meetings/:id/client-visibility/preview', { preHandler: guard.authenticate }, async (req) => {
      const { id } = req.params as { id: string };
      await meetingToShow(req, id);
      const p = await minutes.preview(id);
      if (!p) throw notFinal();
      return { data: { content: clientMinutesContent(p.content, { names: p.names, includeRisks: true }), names: p.names } };
    });

    app.put('/meetings/:id/client-visibility', { preHandler: guard.authenticate }, async (req) => {
      const { id } = req.params as { id: string };
      const projectId = await meetingToShow(req, id);
      const { visible, includeRisks = false } = minutesVisibleBody.parse(req.body ?? {});
      const before = await minutes.state(id);
      if (!(await minutes.set(id, visible, { includeRisks }))) throw notFinal();
      if ((before?.clientVisible ?? false) !== visible || (visible && before?.includeRisks !== includeRisks)) {
        await audit(req, visible ? 'client-view.minutes.shown' : 'client-view.minutes.hidden', id, visible ? { projectId, includeRisks } : { projectId });
        deps.onMinutesChanged?.(id);
      }
      return { data: await stateOf(req, id, projectId) };
    });
  }
}
