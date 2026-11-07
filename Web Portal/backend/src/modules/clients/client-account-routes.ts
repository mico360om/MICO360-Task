import { z } from 'zod';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { AuthGuard } from '../auth/auth-guard';
import { NotFoundError } from '../../lib/http-errors';
import { WELCOME_REFUSAL_WHY, WelcomeEmailUnavailableError, type WelcomeOutcome, type WelcomeService } from '../users/welcome-service';
import type { ClientAccounts } from './client-accounts';
import { grantRows, grantWords, grantsSchema } from './client-grants';
import type { PortalService, PreviewSpec } from './portal-service';
import { checkOneWayIn, temporaryPasswordFor, wayInFields } from '../users/way-in';

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
    const { sendWelcome, password, generatePassword, inviteDays, ...body } = createSchema.parse(req.body ?? {});
    checkOneWayIn({ sendWelcome, password, generatePassword });
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
    return reply.status(201).send({ data: created, meta: { welcome } });
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
    const view = async (req: FastifyRequest) => {
      const spec = previewBody.parse(req.body ?? {}) as PreviewSpec;
      return { spec, viewer: await portal.previewViewer(spec) };
    };
    const params = (req: FastifyRequest) => req.params as { projectId: string; taskId: string; meetingId: string };
    const marked = (data: unknown) => ({ data, meta: { preview: true } });
    app.post('/clients/preview/me', adminOnly, async (req) => {
      const { spec, viewer } = await view(req);
      const data = await portal.home(viewer);
      await deps.audit?.record({
        userId: req.user!.id,
        ip: req.ip ?? null,
        module: 'clients',
        action: 'client.preview',
        entityId: spec.clientId ?? null,
        newValue: { clientId: spec.clientId ?? null, unsaved: Boolean(spec.projects), ...(spec.projects ? { projects: grantRows(spec.projects).map((r) => ({ projectId: r.projectId, access: grantWords(r) })) } : {}) },
      });
      return marked(data);
    });
    app.post('/clients/preview/projects/:projectId', adminOnly, async (req) => marked(await portal.project((await view(req)).viewer, params(req).projectId)));
    app.post('/clients/preview/projects/:projectId/tasks/:taskId', adminOnly, async (req) => marked(await portal.task((await view(req)).viewer, params(req).projectId, params(req).taskId)));
    app.post('/clients/preview/projects/:projectId/meetings', adminOnly, async (req) => marked(await portal.meetings((await view(req)).viewer, params(req).projectId)));
    app.post('/clients/preview/projects/:projectId/meetings/:meetingId', adminOnly, async (req) => marked(await portal.meeting((await view(req)).viewer, params(req).projectId, params(req).meetingId)));
    app.post('/clients/preview/notifications', adminOnly, async (req) => marked(await portal.notices((await view(req)).viewer)));
    app.post('/clients/preview/settings', adminOnly, async (req) => marked(await portal.settings((await view(req)).viewer)));
  }

  // "Clients with access" on a project's page: anyone who can see the project reads it; only
  // administrators change it (on the Clients page or in User Management).
  app.get('/projects/:id/clients', { preHandler: guard.authenticate }, async (req) => {
    const { id } = req.params as { id: string };
    const roles = req.user!.roles ?? [];
    if (!(await deps.canViewProject(req.user!.id, roles, id))) throw new NotFoundError('Project not found.');
    return { data: { clients: await accounts.forProject(id), canChange: roles.includes('ADMIN') } };
  });
}
