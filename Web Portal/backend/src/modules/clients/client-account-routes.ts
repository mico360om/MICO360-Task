import { isEffectiveAdmin } from '../auth/manager-view';
import { z } from 'zod';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { AuthGuard } from '../auth/auth-guard';
import { NotFoundError } from '../../lib/http-errors';
import { WELCOME_REFUSAL_WHY, WelcomeEmailUnavailableError, type WelcomeOutcome, type WelcomeService } from '../users/welcome-service';
import type { ClientAccounts } from './client-accounts';
import { grantRows, grantWords, grantsSchema } from './client-grants';
import type { PortalService, PreviewSpec } from './portal-service';
import { IGNORED_PASSWORD_AUDIT, ignoredPasswordMessage, resolveWayIn, temporaryPasswordFor, wayInFields } from '../users/way-in';

/**
 * 1.23 Client accounts for administrators: the Clients page and User Management's Role "Client" use
 * these. "Clients with access" on a project's page is for anyone who can see the project (read-only;
 * only administrators change it — `canChange`).
 */
export interface ClientAccountRouteDeps {
  accounts: ClientAccounts;
  guard: AuthGuard;
  welcome?: WelcomeService;
  /** May they see the project at all (else 404). */
  canViewProject: (userId: string, roles: string[], projectId: string) => Promise<boolean>;
  audit?: { record(entry: { userId: string | null; ip: string | null; module: string; action: string; entityId: string | null; newValue?: unknown }): Promise<unknown> };
  /** 1.23.6: System Settings → Accounts, "Invitation links last" (days; unused temporary passwords too). */
  invitationDays?: () => Promise<number>;
  /** 1.23.7 Preview as client: the portal's reads (enables POST /clients/preview/…). */
  portal?: Pick<PortalService, 'previewViewer' | 'home' | 'project' | 'task' | 'meetings' | 'meeting' | 'notices' | 'settings'>;
}

/**
 * 1.23.7 Preview as client: whose portal (a saved client, or none yet) and the matrix still on screen
 * (absent: their saved access). The typed name and organisation of a client not saved yet head the page.
 */
const previewBody = z
  .object({
    clientId: z.string().trim().min(1).max(64).nullable().optional(),
    firstName: z.string().trim().max(191).optional(),
    lastName: z.string().trim().max(191).optional(),
    organisation: z.string().trim().max(160).nullable().optional(),
    email: z.string().trim().max(191).optional(),
    projects: grantsSchema.optional(),
  })
  .strict();

const name = z.string().trim().min(1).max(191);
const optionalText = (max: number) => z.string().trim().max(max).nullable().optional();
const createSchema = z
  .object({
    firstName: name,
    lastName: name,
    username: name,
    email: z.string().trim().email().max(191),
    // 1.23.6: one way in — an invitation link or a temporary password (made here, or typed), never both.
    ...wayInFields,
    organisation: optionalText(160),
    phone: optionalText(40),
    projects: grantsSchema.optional(),
  })
  .superRefine((b, ctx) => {
    if (!b.sendWelcome && !b.password && !b.generatePassword) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['password'], message: 'Required' });
  });
const updateSchema = z.object({
  firstName: name.optional(),
  lastName: name.optional(),
  username: name.optional(),
  email: z.string().trim().email().max(191).optional(),
  organisation: optionalText(160),
  phone: optionalText(40),
  projects: grantsSchema.optional(),
});

export async function registerClientAccountRoutes(app: FastifyInstance, deps: ClientAccountRouteDeps): Promise<void> {
  const { accounts, guard } = deps;
  const adminOnly = { preHandler: guard.requireRoles('ADMIN') };
  const actor = (req: FastifyRequest) => ({ id: req.user!.id, ip: req.ip ?? null });

  app.get('/clients', adminOnly, async () => ({ data: await accounts.list() }));

  app.get('/clients/project-options', adminOnly, async () => ({ data: await accounts.projectOptions() }));

  app.get('/clients/:id', adminOnly, async (req) => {
    const { id } = req.params as { id: string };
    return { data: await accounts.get(id) };
  });

  app.post('/clients', adminOnly, async (req, reply) => {
    // 1.23.6: one way in — an invitation with a typed password (the Android app's default) is exactly an
    // invitation; the typed password is ignored.
    const { sendWelcome, password, generatePassword, inviteDays, ignoredPassword, ...body } = resolveWayIn(createSchema.parse(req.body ?? {}));
    // Asked for a welcome email that can't be sent: say so before making an account no one can use.
    if (sendWelcome && !deps.welcome?.isConfigured()) throw new WelcomeEmailUnavailableError();
    // 1.23.6: a temporary password (made here, or typed) is changed at the first sign-in and ends unused.
    const temporary = await temporaryPasswordFor({ password, generatePassword, inviteDays }, { setById: req.user!.id, setting: deps.invitationDays });
    let created = await accounts.create({ ...body, ...(temporary ? { password: temporary.password, temporary: temporary.mark } : {}) }, actor(req));
    if (temporary) {
      await deps.audit?.record({
        userId: req.user!.id,
        ip: req.ip ?? null,
        module: 'users',
        action: 'user.password.temporary',
        entityId: created.id,
        newValue: { generated: temporary.generated, expiresAt: temporary.mark.expiresAt.toISOString() },
      });
      // A password made here goes back once, in this answer only (never stored, logged or emailed).
      return reply.status(201).send({ data: created, ...(temporary.generated ? { meta: { temporaryPassword: temporary.password } } : {}) });
    }
    if (ignoredPassword) {
      await deps.audit?.record({ userId: req.user!.id, ip: req.ip ?? null, module: 'users', action: IGNORED_PASSWORD_AUDIT.action, entityId: created.id, newValue: IGNORED_PASSWORD_AUDIT.newValue });
    }
    if (!sendWelcome || !deps.welcome) return reply.status(201).send({ data: created });
    let welcome: WelcomeOutcome;
    try {
      welcome = await deps.welcome.send(created.id, {
        ...(inviteDays ? { days: inviteDays } : {}),
        onSent: async (out) => {
          await deps.audit?.record({ userId: req.user!.id, ip: req.ip ?? null, module: 'users', action: 'user.welcome_email', entityId: out.userId, newValue: { to: out.email, username: out.username, bulk: false, resent: out.resent === true } });
        },
      });
    } catch {
      welcome = { userId: created.id, username: created.username, name: `${created.firstName} ${created.lastName}`.trim(), email: created.email, sent: false, reason: 'SERVER_ERROR', why: WELCOME_REFUSAL_WHY.SERVER_ERROR };
    }
    if (welcome.sent && welcome.sentAt) created = { ...created, welcomeSentAt: new Date(welcome.sentAt) };
    return reply.status(201).send({ data: created, meta: { welcome, ...(ignoredPassword ? { ignoredPassword: true, message: ignoredPasswordMessage(welcome) } : {}) } });
  });

  app.put('/clients/:id', adminOnly, async (req) => {
    const { id } = req.params as { id: string };
    const patch = updateSchema.parse(req.body ?? {});
    return { data: await accounts.update(id, patch, actor(req)) };
  });

  // 1.23.7 Preview as client (administrators): the Client portal exactly as this client would see it, with
  // the matrix still on screen — before the invitation goes. Every answer is the portal's own read (nothing
  // here writes or sends), marked a preview; opening one (its home) is audited. It never signs in as the
  // client and never touches their sessions.
  if (deps.portal) {
    const portal = deps.portal;
    const params = (req: FastifyRequest) => req.params as { projectId?: string; taskId?: string; meetingId?: string };
    /**
     * One preview read: its viewer, then the read, then (review minor 5) an audit line — at its home always,
     * and at every page of a saved client's preview (it reads their own comments, uploads and bell).
     */
    const preview =
      (view: string, read: (viewer: Awaited<ReturnType<typeof portal.previewViewer>>, p: ReturnType<typeof params>) => Promise<unknown>) =>
      async (req: FastifyRequest) => {
        const spec = previewBody.parse(req.body ?? {}) as PreviewSpec;
        const p = params(req);
        const data = await read(await portal.previewViewer(spec), p);
        if (view === 'home' || spec.clientId) {
          await deps.audit?.record({
            userId: req.user!.id,
            ip: req.ip ?? null,
            module: 'clients',
            action: 'client.preview',
            entityId: spec.clientId ?? null,
            newValue: {
              view,
              clientId: spec.clientId ?? null,
              ...(p.projectId ? { projectId: p.projectId } : {}),
              ...(p.taskId ? { taskId: p.taskId } : {}),
              ...(p.meetingId ? { meetingId: p.meetingId } : {}),
              ...(view === 'home' ? { unsaved: Boolean(spec.projects) } : {}),
              ...(view === 'home' && spec.projects ? { projects: grantRows(spec.projects).map((r) => ({ projectId: r.projectId, access: grantWords(r) })) } : {}),
            },
          });
        }
        return { data, meta: { preview: true } };
      };
    app.post('/clients/preview/me', adminOnly, preview('home', (v) => portal.home(v)));
    app.post('/clients/preview/projects/:projectId', adminOnly, preview('project', (v, p) => portal.project(v, p.projectId)));
    app.post('/clients/preview/projects/:projectId/tasks/:taskId', adminOnly, preview('task', (v, p) => portal.task(v, p.projectId, p.taskId)));
    app.post('/clients/preview/projects/:projectId/meetings', adminOnly, preview('meetings', (v, p) => portal.meetings(v, p.projectId)));
    app.post('/clients/preview/projects/:projectId/meetings/:meetingId', adminOnly, preview('meeting', (v, p) => portal.meeting(v, p.projectId, p.meetingId)));
    app.post('/clients/preview/notifications', adminOnly, preview('notifications', (v) => portal.notices(v)));
    app.post('/clients/preview/settings', adminOnly, preview('settings', (v) => portal.settings(v)));
  }

  // "Clients with access" on a project's page: anyone who can see the project reads it; only
  // administrators change it (on the Clients page or in User Management).
  app.get('/projects/:id/clients', { preHandler: guard.authenticate }, async (req) => {
    const { id } = req.params as { id: string };
    const roles = req.user!.roles ?? [];
    if (!(await deps.canViewProject(req.user!.id, roles, id))) throw new NotFoundError('Project not found.');
    // Manager View: the Clients page is closed to them, so they can't change it from here either.
    return { data: { clients: await accounts.forProject(id), canChange: isEffectiveAdmin(req.user!) } };
  });
}
