import { z } from 'zod';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { UserService } from './user-service';
import type { AuthGuard } from '../auth/auth-guard';
import type { AuditService } from '../audit/audit-service';
import type { DataExporter } from './data-export';
import { zonedDayKey } from '../../lib/due-date';
import type { AttachmentStorage } from '../tasks/attachment-repository';
import { storeImageUpload } from '../../lib/image-upload';
import { ValidationError } from '../../lib/http-errors';
import { WELCOME_REFUSAL_WHY, WelcomeEmailUnavailableError, type WelcomeOutcome, type WelcomeRefusal, type WelcomeService } from './welcome-service';

// Password strength (8+ chars, a letter and a digit) is enforced by the service for every endpoint.
const password = z.string().min(1).max(200);
const name = z.string().trim().min(1).max(191);
// With "Send a welcome email" the temporary password is optional (the person sets theirs with the
// link); without it, a temporary password is required, as before.
const createSchema = z
  .object({
    email: z.string().trim().email().max(191),
    username: name,
    password: z.string().max(200).optional(),
    firstName: name,
    lastName: name,
    departmentId: z.string().optional(),
    roleNames: z.array(z.string()).min(1).optional(),
    sendWelcome: z.boolean().optional(),
  })
  .superRefine((b, ctx) => {
    if (!b.sendWelcome && !b.password) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['password'], message: 'Required' });
  });
/** Welcome emails to several people: at most this many a send. */
const MAX_WELCOME_BATCH = 100;
const welcomeBatchSchema = z.object({ userIds: z.array(z.string().min(1).max(64)).min(1).max(MAX_WELCOME_BATCH) });
/** One bulk send per administrator this often. */
const WELCOME_BATCH_GAP_MS = 60_000;

/** A refused single send: its HTTP status (the words come from the outcome). */
const REFUSAL_STATUS: Record<WelcomeRefusal, number> = {
  NOT_FOUND: 404,
  ACCOUNT_INACTIVE: 409,
  ACCOUNT_SUSPENDED: 409,
  ACCOUNT_LOCKED: 409,
  NO_EMAIL: 409,
  EMAIL_BLOCKED: 409,
  TOO_SOON: 429,
  DELIVERY_FAILED: 502,
  SERVER_ERROR: 500,
};
const updateSchema = z.object({
  firstName: name.optional(),
  lastName: name.optional(),
  email: z.string().trim().email().max(191).optional(),
  username: name.optional(),
  departmentId: z.string().nullable().optional(),
  roleNames: z.array(z.string()).min(1).optional(),
});
const statusSchema = z.object({ status: z.enum(['ACTIVE', 'INACTIVE', 'SUSPENDED']) });
const adminPasswordSchema = z.object({ password });
const changePasswordSchema = z.object({ currentPassword: z.string().min(1).max(200), newPassword: password });

export interface UserRouteDeps {
  userService: UserService;
  guard: AuthGuard;
  /** Records important account changes to the audit log. */
  audit?: AuditService;
  /** File storage for profile images; when absent, the avatar upload endpoint is disabled. */
  storage?: AttachmentStorage;
  avatarMaxBytes?: number;
  /** "Download my data"; when absent, GET /users/me/export isn't offered. */
  exportData?: DataExporter;
  /** Company time zone — dates the export file name. */
  timeZone?: string;
  /** Welcome emails ("Set your password" links); when absent, they aren't offered. */
  welcome?: WelcomeService;
}

export async function registerUserRoutes(app: FastifyInstance, deps: UserRouteDeps): Promise<void> {
  const { userService, guard } = deps;
  const adminOnly = { preHandler: guard.requireRoles('ADMIN') };
  const logAudit = (req: FastifyRequest, action: string, entityId: string | null, newValue?: unknown) =>
    deps.audit?.record({ userId: req.user?.id ?? null, ip: req.ip ?? null, module: 'users', action, entityId, newValue });

  app.get('/users', adminOnly, async () => ({ data: await userService.listUsers() }));

  // "Download my data" — everything held about the signed-in person, as a JSON file.
  if (deps.exportData) {
    const exportData = deps.exportData;
    app.get('/users/me/export', { preHandler: guard.authenticate }, async (req, reply) => {
      const data = await exportData(req.user!.id);
      if (!data) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Account not found.' } });
      logAudit(req, 'user.data_exported', req.user!.id);
      return reply
        .header('Content-Type', 'application/json; charset=utf-8')
        .header('Content-Disposition', `attachment; filename="mico360-my-data-${zonedDayKey(new Date(data.exportedAt), deps.timeZone ?? 'Asia/Muscat')}.json"`)
        .header('Cache-Control', 'no-store')
        .send(JSON.stringify(data, null, 2));
    });
  }

  // A minimal, non-sensitive people directory (id + display name) for any signed-in user —
  // powers chat author names, @mention autocomplete and the DM people picker.
  app.get('/users/directory', { preHandler: guard.authenticate }, async () => {
    const users = await userService.listUsers();
    return {
      // `active`: inactive and suspended people keep their names in history, but pickers leave them out.
      data: users.map((u) => ({ id: u.id, username: u.username, firstName: u.firstName, lastName: u.lastName, avatarUrl: u.avatarUrl, lastActiveAt: u.lastActiveAt ?? null, active: u.status === 'ACTIVE' })),
    };
  });

  // Upload / remove the signed-in user's profile image (any authenticated user, self only).
  app.post('/users/me/avatar', { preHandler: guard.authenticate }, async (req) => {
    if (!deps.storage) throw new ValidationError('Uploads are not enabled.');
    const file = await req.file();
    if (!file) throw new ValidationError('No file uploaded.');
    const content = await file.toBuffer();
    const { url } = await storeImageUpload(
      deps.storage,
      { filename: file.filename, mimeType: file.mimetype, content },
      { maxBytes: deps.avatarMaxBytes ?? 5 * 1024 * 1024 },
    );
    const user = await userService.setAvatar(req.user!.id, url);
    await logAudit(req, 'user.avatar.set', user.id);
    return { data: user };
  });

  app.delete('/users/me/avatar', { preHandler: guard.authenticate }, async (req) => {
    const user = await userService.setAvatar(req.user!.id, null);
    await logAudit(req, 'user.avatar.clear', user.id);
    return { data: user };
  });

  // Change your own password (verifies the current password first). Every existing session is
  // ended, and the caller gets a fresh one in the response so they stay signed in here.
  app.post('/users/me/password', { preHandler: guard.authenticate }, async (req) => {
    const { currentPassword, newPassword } = changePasswordSchema.parse(req.body);
    const session = await userService.changeOwnPassword(req.user!.id, currentPassword, newPassword);
    await logAudit(req, 'user.password.change', req.user!.id);
    return { data: session ?? {} };
  });

  app.get('/users/:id', adminOnly, async (req) => {
    const { id } = req.params as { id: string };
    return { data: await userService.getUser(id) };
  });

  /**
   * A welcome email went: who sent it (the entry's user), to whom (the entry and address), when. Never
   * the link. Written by the welcome service as soon as each email has gone (so a batch cut short still
   * leaves every entry); a problem writing it is logged there and doesn't turn the send into an error.
   */
  const auditWelcome = (req: FastifyRequest, bulk: boolean) => async (out: WelcomeOutcome) => {
    await logAudit(req, 'user.welcome_email', out.userId, { to: out.email, username: out.username, bulk });
  };

  app.post('/users', adminOnly, async (req, reply) => {
    const { sendWelcome, password, ...body } = createSchema.parse(req.body);
    // Asked for a welcome email that can't be sent: say so before making an account no one can use.
    if (sendWelcome && !deps.welcome?.isConfigured()) throw new WelcomeEmailUnavailableError();
    let created = await userService.createUser({ ...body, ...(password ? { password } : {}) });
    // Never log the password — only non-secret identifying fields.
    await logAudit(req, 'user.create', created.id, { email: body.email, username: body.username, roleNames: created.roles, ...(sendWelcome !== undefined ? { welcomeEmail: sendWelcome } : {}) });
    if (!sendWelcome || !deps.welcome) return reply.status(201).send({ data: created });
    // The account stands whatever happens to the email: the answer is always 201 and says whether it went.
    let welcome: WelcomeOutcome;
    try {
      welcome = await deps.welcome.send(created.id, { onSent: auditWelcome(req, false) });
    } catch {
      welcome = {
        userId: created.id,
        username: created.username,
        name: `${created.firstName} ${created.lastName}`.trim() || created.username,
        email: created.email,
        sent: false,
        reason: 'SERVER_ERROR',
        why: WELCOME_REFUSAL_WHY.SERVER_ERROR,
      };
    }
    if (welcome.sent && welcome.sentAt) created = { ...created, welcomeSentAt: new Date(welcome.sentAt) };
    return reply.status(201).send({ data: created, meta: { welcome } });
  });

  const welcome = deps.welcome;
  if (welcome) {
    const lastBatch = new Map<string, number>();

    // "Send welcome emails": the chosen people (or everyone who has never signed in, chosen on the
    // page), each told apart in the answer. One send a minute per administrator, 100 people at most (it runs inside one request).
    app.post('/users/welcome-emails', adminOnly, async (req, reply) => {
      const { userIds } = welcomeBatchSchema.parse(req.body);
      if (!welcome.isConfigured()) throw new WelcomeEmailUnavailableError();
      const adminId = req.user!.id;
      const at = Date.now();
      if (at - (lastBatch.get(adminId) ?? -Infinity) < WELCOME_BATCH_GAP_MS) {
        return reply.status(429).send({ error: { code: 'TOO_SOON', message: 'Welcome emails were just sent. Wait a minute before sending more.' } });
      }
      lastBatch.set(adminId, at);
      const results = await welcome.sendMany(userIds, { onSent: auditWelcome(req, true) });
      const sent = results.filter((r) => r.sent).length;
      return { data: { sent, notSent: results.length - sent, results } };
    });

    // "Send welcome email" for one person.
    app.post('/users/:id/welcome-email', adminOnly, async (req, reply) => {
      const { id } = req.params as { id: string };
      const out = await welcome.send(id, { onSent: auditWelcome(req, false) });
      if (!out.sent) {
        const reason = out.reason ?? 'SERVER_ERROR';
        return reply.status(REFUSAL_STATUS[reason]).send({ error: { code: reason, message: `No welcome email was sent: ${out.why ?? WELCOME_REFUSAL_WHY[reason]}.` } });
      }
      return { data: out };
    });
  }

  app.put('/users/:id', adminOnly, async (req) => {
    const { id } = req.params as { id: string };
    const body = updateSchema.parse(req.body);
    const updated = await userService.updateUser(id, body);
    await logAudit(req, 'user.update', id, body);
    return { data: updated };
  });

  // Admin-only: reset a user's password to a new value (never logs the password itself).
  // Also lifts any lockout and ends the user's sessions.
  app.post('/users/:id/password', adminOnly, async (req, reply) => {
    const { id } = req.params as { id: string };
    const { password } = adminPasswordSchema.parse(req.body);
    await userService.adminResetPassword(id, password);
    await logAudit(req, 'user.password.reset', id);
    return reply.status(204).send();
  });

  // Admin-only: lift a lockout from too many failed sign-in attempts.
  app.post('/users/:id/unlock', adminOnly, async (req) => {
    const { id } = req.params as { id: string };
    const updated = await userService.unlockUser(id);
    await logAudit(req, 'user.unlock', id);
    return { data: updated };
  });

  app.patch('/users/:id/status', adminOnly, async (req) => {
    const { id } = req.params as { id: string };
    const { status } = statusSchema.parse(req.body);
    const updated = await userService.setUserStatus(id, status);
    await logAudit(req, 'user.status', id, { status });
    return { data: updated };
  });

  app.delete('/users/:id', adminOnly, async (req, reply) => {
    const { id } = req.params as { id: string };
    await userService.deleteUser(id);
    await logAudit(req, 'user.delete', id);
    return reply.status(204).send();
  });
}
