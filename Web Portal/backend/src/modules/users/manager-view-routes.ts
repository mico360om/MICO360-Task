import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import type { AuthGuard } from '../auth/auth-guard';
import { isAdminRoles } from '../auth/manager-view';
import { ValidationError } from '../../lib/http-errors';

/** An administrator's Manager View switch, saved on their account (users.managerView). */
export interface ManagerViewStore {
  get(userId: string): Promise<boolean>;
  set(userId: string, on: boolean): Promise<boolean>;
}

export function createMemoryManagerViewStore(): ManagerViewStore {
  const on = new Map<string, boolean>();
  return {
    async get(userId) {
      return on.get(userId) === true;
    },
    async set(userId, value) {
      on.set(userId, value);
      return value;
    },
  };
}

export function createPrismaManagerViewStore(prisma: PrismaClient): ManagerViewStore {
  return {
    async get(userId) {
      const u = await prisma.user.findUnique({ where: { id: userId }, select: { managerView: true } });
      return u?.managerView === true;
    },
    async set(userId, value) {
      const u = await prisma.user.update({ where: { id: userId }, data: { managerView: value }, select: { managerView: true } });
      return u.managerView;
    },
  };
}

interface AuditLike {
  record(entry: { userId: string | null; ip: string | null; module: string; action: string; entityId: string | null; oldValue?: unknown; newValue?: unknown }): Promise<unknown>;
}

const switchSchema = z.object({ on: z.boolean() }).strict();

/**
 * GET / PUT /users/me/manager-view (owner, 10 Nov): an administrator's own switch. `available` says
 * whether the person has it at all (administrators only); for anyone else a PUT is ignored. A change is
 * recorded in the audit log and takes effect at once: the guard's cached account state is forgotten, so
 * the very next request is judged with it. The PUT is never refused by Manager View (manager-view.ts),
 * so the last active administrator can always turn it off.
 */
export async function registerManagerViewRoutes(app: FastifyInstance, deps: { store: ManagerViewStore; guard: AuthGuard; audit?: AuditLike }): Promise<void> {
  const { store, guard } = deps;

  app.get('/users/me/manager-view', { preHandler: guard.authenticate }, async (req) => {
    const available = isAdminRoles(req.user!.roles ?? []);
    return { data: { available, managerView: available && (await store.get(req.user!.id)) } };
  });

  app.put('/users/me/manager-view', { preHandler: guard.authenticate }, async (req) => {
    const parsed = switchSchema.safeParse(req.body ?? {});
    if (!parsed.success) throw new ValidationError('Send { "on": true } or { "on": false }.');
    const userId = req.user!.id;
    if (!isAdminRoles(req.user!.roles ?? [])) return { data: { available: false, managerView: false } };
    const before = await store.get(userId);
    const on = parsed.data.on;
    if (before !== on) {
      await store.set(userId, on);
      await deps.audit?.record({
        userId,
        ip: req.ip ?? null,
        module: 'users',
        action: on ? 'user.manager_view.on' : 'user.manager_view.off',
        entityId: userId,
        oldValue: { managerView: before },
        newValue: { managerView: on },
      });
    }
    // The next request is judged with the account as it is now (also when it was already so: a change
    // made elsewhere is picked up at once).
    guard.forgetUser(userId);
    return { data: { available: true, managerView: on } };
  });
}
