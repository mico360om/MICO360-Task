import { z } from 'zod';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { UserService } from './user-service';
import type { AuthGuard } from '../auth/auth-guard';
import type { AuditService } from '../audit/audit-service';
import type { AttachmentStorage } from '../tasks/attachment-repository';
import { storeImageUpload } from '../../lib/image-upload';
import { ValidationError } from '../../lib/http-errors';

const createSchema = z.object({
  email: z.string().email(),
  username: z.string().min(1),
  password: z.string().min(6),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  departmentId: z.string().optional(),
  roleNames: z.array(z.string()).optional(),
});
const updateSchema = z.object({
  firstName: z.string().min(1).optional(),
  lastName: z.string().min(1).optional(),
  email: z.string().email().optional(),
  username: z.string().min(1).optional(),
  departmentId: z.string().nullable().optional(),
  roleNames: z.array(z.string()).optional(),
});
const statusSchema = z.object({ status: z.enum(['ACTIVE', 'INACTIVE', 'SUSPENDED']) });
const adminPasswordSchema = z.object({ password: z.string().min(6) });
const changePasswordSchema = z.object({ currentPassword: z.string().min(1), newPassword: z.string().min(6) });

export interface UserRouteDeps {
  userService: UserService;
  guard: AuthGuard;
  /** Records important account changes to the audit log. */
  audit?: AuditService;
  /** File storage for profile images; when absent, the avatar upload endpoint is disabled. */
  storage?: AttachmentStorage;
  avatarMaxBytes?: number;
}

export async function registerUserRoutes(app: FastifyInstance, deps: UserRouteDeps): Promise<void> {
  const { userService, guard } = deps;
  const adminOnly = { preHandler: guard.requireRoles('ADMIN') };
  const logAudit = (req: FastifyRequest, action: string, entityId: string | null, newValue?: unknown) =>
    deps.audit?.record({ userId: req.user?.id ?? null, ip: req.ip ?? null, module: 'users', action, entityId, newValue });

  app.get('/users', adminOnly, async () => ({ data: await userService.listUsers() }));

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

  // Change your own password (verifies the current password first).
  app.post('/users/me/password', { preHandler: guard.authenticate }, async (req, reply) => {
    const { currentPassword, newPassword } = changePasswordSchema.parse(req.body);
    await userService.changeOwnPassword(req.user!.id, currentPassword, newPassword);
    await logAudit(req, 'user.password.change', req.user!.id);
    return reply.status(204).send();
  });

  app.get('/users/:id', adminOnly, async (req) => {
    const { id } = req.params as { id: string };
    return { data: await userService.getUser(id) };
  });

  app.post('/users', adminOnly, async (req, reply) => {
    const body = createSchema.parse(req.body);
    const created = await userService.createUser(body);
    // Never log the password — only non-secret identifying fields.
    await logAudit(req, 'user.create', created.id, { email: body.email, username: body.username, roleNames: body.roleNames });
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
  app.post('/users/:id/password', adminOnly, async (req, reply) => {
    const { id } = req.params as { id: string };
    const { password } = adminPasswordSchema.parse(req.body);
    await userService.adminResetPassword(id, password);
    await logAudit(req, 'user.password.reset', id);
    return reply.status(204).send();
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
