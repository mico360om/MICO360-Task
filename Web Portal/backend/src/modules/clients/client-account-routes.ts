import { z } from 'zod';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { AuthGuard } from '../auth/auth-guard';
import { NotFoundError } from '../../lib/http-errors';
import { WELCOME_REFUSAL_WHY, WelcomeEmailUnavailableError, type WelcomeOutcome, type WelcomeService } from '../users/welcome-service';
import type { ClientAccounts } from './client-accounts';
import { grantsSchema } from './client-grants';

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
}

const name = z.string().trim().min(1).max(191);
const optionalText = (max: number) => z.string().trim().max(max).nullable().optional();
const createSchema = z
  .object({
    firstName: name,
    lastName: name,
    username: name,
    email: z.string().trim().email().max(191),
    password: z.string().max(200).optional(),
    sendWelcome: z.boolean().optional(),
    organisation: optionalText(160),
    phone: optionalText(40),
    projects: grantsSchema.optional(),
  })
  .superRefine((b, ctx) => {
    if (!b.sendWelcome && !b.password) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['password'], message: 'Required' });
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
    const { sendWelcome, ...body } = createSchema.parse(req.body ?? {});
    // Asked for a welcome email that can't be sent: say so before making an account no one can use.
    if (sendWelcome && !deps.welcome?.isConfigured()) throw new WelcomeEmailUnavailableError();
    let created = await accounts.create(body, actor(req));
    if (!sendWelcome || !deps.welcome) return reply.status(201).send({ data: created });
    let welcome: WelcomeOutcome;
    try {
      welcome = await deps.welcome.send(created.id, {
        onSent: async (out) => {
          await deps.audit?.record({ userId: req.user!.id, ip: req.ip ?? null, module: 'users', action: 'user.welcome_email', entityId: out.userId, newValue: { to: out.email, username: out.username, bulk: false } });
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

  // "Clients with access" on a project's page: anyone who can see the project reads it; only
  // administrators change it (on the Clients page or in User Management).
  app.get('/projects/:id/clients', { preHandler: guard.authenticate }, async (req) => {
    const { id } = req.params as { id: string };
    const roles = req.user!.roles ?? [];
    if (!(await deps.canViewProject(req.user!.id, roles, id))) throw new NotFoundError('Project not found.');
    return { data: { clients: await accounts.forProject(id), canChange: roles.includes('ADMIN') } };
  });
}
