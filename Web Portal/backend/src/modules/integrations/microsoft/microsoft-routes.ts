import { z } from 'zod';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AuthGuard } from '../../auth/auth-guard';
import type { AuditService } from '../../audit/audit-service';
import { ConflictError } from '../../../lib/http-errors';
import type { MeetingRecord } from '../../meetings/meeting-repository';
import type { MeetingNotifyService } from '../../meetings/meeting-notify-service';
import { readCookie } from '../../client-view/client-tokens';
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
const ticketQuery = z.object({ ticket: z.string().max(2000).optional() });
const callbackQuery = z.object({ code: z.string().max(4000).optional(), state: z.string().max(2000).optional(), error: z.string().max(200).optional() });
const NOT_SET_UP = 'Teams links aren’t set up on this site yet.';

function plain(reply: FastifyReply, status: number, text: string) {
  return reply.status(status).header('content-type', 'text/plain; charset=utf-8').header('cache-control', 'no-store').send(text);
}

/**
 * Settings → Microsoft Teams (each person's own Microsoft account, staff only) and Make Teams link on a
 * meeting. /start and /callback are opened by the browser itself (no sign-in header): the signed ticket,
 * state and flow cookie stand in for it.
 */
export async function registerMicrosoftRoutes(app: FastifyInstance, deps: MicrosoftRouteDeps): Promise<void> {
  // Staff only: client accounts (1.23) never connect anything or make links.
  const staff = {
    preHandler: async (req: FastifyRequest, reply: FastifyReply) => {
      await deps.guard.authenticate(req, reply);
      if ((req.user?.roles ?? []).includes('CLIENT')) return reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'This is for staff accounts only.' } });
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

  // The browser then opens this address on the server itself (it sets the flow cookie, then goes to Microsoft).
  app.post('/integrations/microsoft/connect', staff, async (req) => {
    if (!deps.connections) throw new ConflictError(NOT_SET_UP, 'TEAMS_NOT_SET_UP');
    return { data: { url: `${COOKIE_PATH}/start?${new URLSearchParams({ ticket: deps.connections.connectTicket(req.user!.id) })}` } };
  });

  app.get('/integrations/microsoft/start', async (req, reply) => {
    if (!deps.connections) return plain(reply, 404, NOT_SET_UP);
    const { ticket } = ticketQuery.parse(req.query);
    const begun = ticket ? deps.connections.begin(ticket) : null;
    if (!begun) return plain(reply, 410, 'This link has expired or was already used. Go back to Settings → Microsoft Teams and press Connect again.');
    return reply.header('set-cookie', cookie(req, begun.cookie.value, begun.cookie.maxAgeSeconds)).header('cache-control', 'no-store').redirect(begun.authorizeUrl, 302);
  });

  // Microsoft sends the person here after its sign-in and consent page.
  app.get('/integrations/microsoft/callback', async (req, reply) => {
    reply.header('set-cookie', cookie(req, '', 0)).header('cache-control', 'no-store');
    if (!deps.connections) return reply.redirect(settingsUrl('failed'), 302);
    const answer = callbackQuery.safeParse(req.query);
    const done = answer.success ? await deps.connections.complete(answer.data, readCookie(req.headers.cookie, FLOW_COOKIE)) : { result: 'failed' as const, userId: null, email: null };
    if (done.result === 'connected') await record({ userId: done.userId, ip: req.ip ?? null, action: 'microsoft.connect', newValue: { email: done.email } });
    else if (done.userId && 'reason' in done && (done.reason === 'tenant' || done.reason === 'browser')) {
      await record({ userId: done.userId, ip: req.ip ?? null, action: 'microsoft.connect-refused', newValue: { reason: done.reason } });
    }
    return reply.redirect(settingsUrl(done.result), 302);
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
