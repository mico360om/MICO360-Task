import { Prisma, type PrismaClient } from '@prisma/client';
import { ADMIN_ROLE } from './two-step';

/**
 * Owner decision (18 Nov 2026), release 1.24.0: two-step sign-in starts with every administrator signing in again.
 * Each administrator's existing sessions (website, and any app/extension ones still renewing) end ONCE: their
 * session version (tokenVersion) is raised, so an access token from before is refused on its next request, and
 * their live refresh tokens are revoked, so no renewal brings it back. Their next sign-in is password + code.
 * Staff, managers (employees) and clients are untouched.
 *
 * Never twice: `auth.adminSignOut124` = { at, admins } in system settings is written in the SAME transaction as
 * the change, before it; a later start-up (or a second server starting at the same moment, which waits on that
 * key and then finds it taken) does nothing. Database writes only (no isolation statement, no side effects), so
 * the save-retry layer may run it again whole. Start-up runs it before the server takes requests, so a sign-in
 * made under 1.24.0 is not ended by it (only if that first try fails — database away — the retry, at the database's
 * return and then every 10 minutes, may also end a sign-in made in between). While two-step sign-in is off it waits.
 */
export const ADMIN_SIGN_OUT_KEY = 'auth.adminSignOut124';
export const ADMIN_SIGN_OUT_ACTION = 'auth.two_step.admins_signed_out';

export interface AdminSignOutRun {
  /** It had run before: nothing was changed. */
  already: boolean;
  /** Two-step sign-in is off (ADMIN_TWO_STEP=off, or no email): nothing changed or recorded — it runs once it is on. */
  waiting: boolean;
  /** The administrators whose sessions it ended (empty when already). */
  userIds: string[];
}

export interface AdminSignOutDeps {
  prisma: PrismaClient;
  now?: () => Date;
  /**
   * Is two-step sign-in on? While it is off, ending the sessions would only let administrators straight back in with
   * a password, and recording it would mean those sessions are never ended once it comes on (review I1).
   */
  twoStepOn: () => boolean;
}

const isUniqueClash = (err: unknown) => (err as { code?: string })?.code === 'P2002';

export function createAdminSignOutOnce(deps: AdminSignOutDeps): { run(): Promise<AdminSignOutRun> } {
  const { prisma } = deps;
  const now = deps.now ?? (() => new Date());
  return {
    async run() {
      if (await prisma.systemSetting.findUnique({ where: { key: ADMIN_SIGN_OUT_KEY }, select: { key: true } })) return { already: true, waiting: false, userIds: [] };
      if (!deps.twoStepOn()) return { already: false, waiting: true, userIds: [] };
      const at = now();
      try {
        const userIds = await prisma.$transaction(async (tx) => {
          // The record first: a second server's insert waits here, then fails on the key (nothing done twice).
          await tx.systemSetting.create({ data: { key: ADMIN_SIGN_OUT_KEY, value: { at: at.toISOString(), admins: 0 } as Prisma.InputJsonValue } });
          const ids = (await tx.user.findMany({ where: { roles: { some: { role: { name: ADMIN_ROLE } } } }, select: { id: true }, orderBy: { id: 'asc' } })).map((u) => u.id);
          if (ids.length) {
            await tx.user.updateMany({ where: { id: { in: ids } }, data: { tokenVersion: { increment: 1 } } });
            await tx.refreshToken.updateMany({ where: { userId: { in: ids }, revokedAt: null }, data: { revokedAt: at } });
          }
          await tx.systemSetting.updateMany({ where: { key: ADMIN_SIGN_OUT_KEY }, data: { value: { at: at.toISOString(), admins: ids.length } as Prisma.InputJsonValue } });
          await tx.auditLog.create({ data: { userId: null, module: 'auth', action: ADMIN_SIGN_OUT_ACTION, entityId: null, newValue: { admins: ids.length } } });
          return ids;
        });
        return { already: false, waiting: false, userIds };
      } catch (err) {
        // Another server did it at the same moment: theirs is the record.
        if (isUniqueClash(err)) return { already: true, waiting: false, userIds: [] };
        throw err;
      }
    },
  };
}
