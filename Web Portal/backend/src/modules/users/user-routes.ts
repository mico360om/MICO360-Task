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

// Password strength (8+ chars, a letter and a digit) is enforced by the service for every endpoint.
const password = z.string().min(1).max(200);
const name = z.string().trim().min(1).max(191);
const createSchema = z.object({
  email: z.string().trim().email().max(191),
  username: name,
  password,
  firstName: name,
  lastName: name,
  departmentId: z.string().optional(),
  roleNames: z.array(z.string()).min(1).optional(),
});
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
      data: users.map((u) => ({ id: u.id, username: u.username, firstName: u.firstName, lastName: u.lastName, avatarUrl: u.avatarUrl, lastActiveAt: u.lastActiveAt ?? null })),
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

  app.post('/users', adminOnly, async (req, reply) => {
    const body = createSchema.parse(req.body);
    const created = await userService.createUser(body);
    // Never log the password — only non-secret identifying fields.
    await logAudit(req, 'user.create', created.id, { email: body.email, username: body.username, roleNames: created.roles });
    return reply.status(201).send({ data: created });
  });

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
