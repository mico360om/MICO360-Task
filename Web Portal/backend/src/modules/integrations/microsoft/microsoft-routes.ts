import { z } from 'zod';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AuthGuard } from '../../auth/auth-guard';
import type { AuditService } from '../../audit/audit-service';
import { ConflictError } from '../../../lib/http-errors';
import type { MeetingRecord } from '../../meetings/meeting-repository';
import type { MeetingNotifyService } from '../../meetings/meeting-notify-service';
import { readCookie } from '../../client-view/client-tokens';
import { isClientRoles } from '../../clients/client-kind';
import { FLOW_COOKIE, type MicrosoftConnections } from './microsoft-connections';
import type { TeamsMeetings } from './teams-meetings';

export interface MicrosoftRouteDeps {
  guard: AuthGuard;
  /** Null when Teams links aren't set up on this server (the feature is hidden; nothing breaks). */
  connections: MicrosoftConnections | null;
  teams: Pick<TeamsMeetings, 'makeLink'>;
  audit?: AuditService;
  /** Where the web app is: Microsoft sends the person back to its Settings. */
  appUrl: string;
  /** Mark the flow cookie Secure (production); a request that came over https gets it anyway. */
  secureCookies?: boolean;
  /** Make Teams link on a meeting: who may see it and who may change it (the meeting rules). */
  canViewMeeting?: (userId: string, roles: string[], meetingId: string) => Promise<boolean>;
  canEditMeeting: (userId: string, roles: string[], meetingId: string) => Promise<boolean>;
  getMeeting: (meetingId: string) => Promise<MeetingRecord | null>;
  /** Invitations already sent: an updated one carries the new link. */
  notify?: Pick<MeetingNotifyService, 'sendInvites'>;
  logger?: { error(msg: string, ctx?: Record<string, unknown>): void };
}

const COOKIE_PATH = '/api/v1/integrations/microsoft';
const callbackQuery = z.object({ code: z.string().max(4000).optional(), state: z.string().max(2000).optional(), error: z.string().max(200).optional() });
const NOT_SET_UP = 'Teams links aren’t set up on this site yet.';

/**
 * Settings → Microsoft Teams (each person's own Microsoft account, staff only) and Make Teams link on a
 * meeting. Connect is asked by the person's own signed-in page; its answer sets the flow cookie in that
 * browser. The callback is opened by the browser itself (no sign-in header): the signed, single-use
 * state and that cookie stand in for the sign-in. Nothing a link opens begins a connection.
 */
export async function registerMicrosoftRoutes(app: FastifyInstance, deps: MicrosoftRouteDeps): Promise<void> {
  // Staff only: client accounts (1.23) never connect anything or make links. (The auth guard refuses a
  // client's session on these routes already — client-route-table.ts; this is the same rule, kept here.)
  const staff = {
    preHandler: async (req: FastifyRequest, reply: FastifyReply) => {
      await deps.guard.authenticate(req, reply);
      if (isClientRoles(req.user?.roles)) return reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'This is for staff accounts only.' } });
    },
  };
  const secure = (req: FastifyRequest) => Boolean(deps.secureCookies) || req.protocol === 'https';
  const cookie = (req: FastifyRequest, value: string, maxAge: number) =>
    `${FLOW_COOKIE}=${value}; Path=${COOKIE_PATH}; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${secure(req) ? '; Secure' : ''}`;
  const record = (entry: { userId: string | null; ip: string | null; action: string; oldValue?: unknown; newValue?: unknown }) =>
    deps.audit?.record({ module: 'integrations', entityId: entry.userId, oldValue: null, newValue: null, ...entry });
  const settingsUrl = (result: string) => `${deps.appUrl.replace(/\/+$/, '')}/settings?teams=${encodeURIComponent(result)}#microsoft-teams`;

  app.get('/integrations/microsoft', staff, async (req) => {
    if (!deps.connections) return { data: { available: false, connected: false, email: null, name: null, connectedAt: null, problem: null } };
    return { data: await deps.connections.status(req.user!.id) };
  });

  // Connect: the person's own page asks (signed in); the answer sets this browser's flow cookie and names
  // Microsoft's sign-in page, which the page then opens.
  app.post('/integrations/microsoft/connect', staff, async (req, reply) => {
    if (!deps.connections) throw new ConflictError(NOT_SET_UP, 'TEAMS_NOT_SET_UP');
    const begun = deps.connections.begin(req.user!.id);
    reply.header('set-cookie', cookie(req, begun.cookie.value, begun.cookie.maxAgeSeconds));
    return { data: { url: begun.authorizeUrl } };
  });

  // Microsoft sends the person here after its sign-in and consent page. Whatever happens, back to
  // Settings — never an error page (its address carries the sign-in code).
  app.get('/integrations/microsoft/callback', async (req, reply) => {
    reply.header('set-cookie', cookie(req, '', 0)).header('cache-control', 'no-store');
    if (!deps.connections) return reply.redirect(settingsUrl('failed'), 302);
    let result: 'connected' | 'denied' | 'failed' = 'failed';
    try {
      const answer = callbackQuery.safeParse(req.query);
      const done = answer.success ? await deps.connections.complete(answer.data, readCookie(req.headers.cookie, FLOW_COOKIE)) : { result: 'failed' as const, userId: null, email: null };
      result = done.result;
      if (done.result === 'connected') await record({ userId: done.userId, ip: req.ip ?? null, action: 'microsoft.connect', newValue: { email: done.email } });
      else if (done.userId && 'reason' in done && (done.reason === 'tenant' || done.reason === 'browser')) {
        await record({ userId: done.userId, ip: req.ip ?? null, action: 'microsoft.connect-refused', newValue: { reason: done.reason } });
      }
    } catch (err) {
      deps.logger?.error('Microsoft Teams: the sign-in callback failed', { reason: err instanceof Error ? err.name : 'unknown' });
    }
    return reply.redirect(settingsUrl(result), 302);
  });

  app.delete('/integrations/microsoft', staff, async (req) => {
    const gone = deps.connections ? await deps.connections.disconnect(req.user!.id) : null;
    if (gone) await record({ userId: req.user!.id, ip: req.ip ?? null, action: 'microsoft.disconnect', oldValue: { email: gone.email } });
    return { data: { disconnected: true } };
  });

  // "Make Teams link": a meeting waiting for its link (Microsoft couldn't be reached when it was saved).
  app.post('/meetings/:id/teams-link', staff, async (req, reply) => {
    const { id } = req.params as { id: string };
    const { id: userId, roles = [] } = req.user!;
    const notFound = { error: { code: 'NOT_FOUND', message: 'Meeting not found.' } };
    if (deps.canViewMeeting && !(await deps.canViewMeeting(userId, roles, id))) return reply.status(404).send(notFound);
    const before = await deps.getMeeting(id);
    if (!before) return reply.status(404).send(notFound);
    if (!(await deps.canEditMeeting(userId, roles, id))) {
      return reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'Only the organizer, the project manager or an admin can change this meeting.' } });
    }
    const out = await deps.teams.makeLink(id, { id: userId });
    const m = (await deps.getMeeting(id)) ?? before;
    if (out.made && m.invitesSentAt && deps.notify) {
      const family = Boolean(m.recurrenceParentId || m.recurrenceRule);
      deps.notify.sendInvites(id, family ? { scope: 'series' } : undefined).catch((err) => deps.logger?.error('meeting update notice failed', { err, meetingId: id }));
    }
    return { data: { made: out.made, teamsNotice: out.notice, onlineLink: m.onlineLink, onlineMeetingProvider: m.onlineMeetingProvider ?? null, teamsLinkPending: m.teamsLinkPending ?? false } };
  });
}
