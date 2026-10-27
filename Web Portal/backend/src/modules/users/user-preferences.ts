import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import type { AuthGuard } from '../auth/auth-guard';

/**
 * A person's own date settings. `null` means the company's: its time zone and its week start (both
 * set by an administrator — the week start is the system setting `company.weekStart`, Sunday until
 * changed, shown to the apps in /config).
 */
export interface UserPreferences {
  timeZone: string | null;
  /** 0 = Sunday, 1 = Monday, 6 = Saturday. */
  weekStart: 0 | 1 | 6 | null;
}

export interface PreferencesRepository {
  get(userId: string): Promise<UserPreferences>;
  set(userId: string, patch: Partial<UserPreferences>): Promise<UserPreferences>;
}

const NONE: UserPreferences = { timeZone: null, weekStart: null };

/** True when the runtime knows `tz` as an IANA time zone. */
function isTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const patchSchema = z
  .object({
    timeZone: z.string().max(64).refine(isTimeZone, 'Unknown time zone.').nullable().optional(),
    weekStart: z.union([z.literal(0), z.literal(1), z.literal(6)]).nullable().optional(),
  })
  .strict();

export function createMemoryPreferences(): PreferencesRepository {
  const rows = new Map<string, UserPreferences>();
  return {
    async get(userId) {
      return { ...(rows.get(userId) ?? NONE) };
    },
    async set(userId, patch) {
      const next = { ...(rows.get(userId) ?? NONE), ...patch };
      rows.set(userId, next);
      return { ...next };
    },
  };
}

export function createPrismaPreferences(prisma: PrismaClient): PreferencesRepository {
  const toPrefs = (u: { preferredTimeZone: string | null; weekStart: number | null } | null): UserPreferences => ({
    timeZone: u?.preferredTimeZone ?? null,
    weekStart: u?.weekStart === 0 || u?.weekStart === 1 || u?.weekStart === 6 ? u.weekStart : null,
  });
  const select = { preferredTimeZone: true, weekStart: true } as const;
  return {
    async get(userId) {
      return toPrefs(await prisma.user.findUnique({ where: { id: userId }, select }));
    },
    async set(userId, patch) {
      const data: { preferredTimeZone?: string | null; weekStart?: number | null } = {};
      if (patch.timeZone !== undefined) data.preferredTimeZone = patch.timeZone;
      if (patch.weekStart !== undefined) data.weekStart = patch.weekStart;
      return toPrefs(await prisma.user.update({ where: { id: userId }, data, select }));
    },
  };
}

/** GET / PUT /users/me/preferences — each person's own; a PUT changes only what it names. */
export async function registerPreferenceRoutes(app: FastifyInstance, deps: { repo: PreferencesRepository; guard: AuthGuard }): Promise<void> {
  const { repo, guard } = deps;
  app.get('/users/me/preferences', { preHandler: guard.authenticate }, async (req) => ({ data: await repo.get(req.user!.id) }));
  app.put('/users/me/preferences', { preHandler: guard.authenticate }, async (req) => {
    const patch = patchSchema.parse(req.body ?? {});
    return { data: await repo.set(req.user!.id, patch as Partial<UserPreferences>) };
  });
}
