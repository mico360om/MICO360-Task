import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import type { AuthGuard } from '../auth/auth-guard';
import { ForbiddenError } from '../../lib/http-errors';

/**
 * A person's own settings. The date ones: `null` means the company's — its time zone and its week
 * start (both set by an administrator — the week start is the system setting `company.weekStart`,
 * Sunday until changed, shown to the apps in /config).
 */
export interface UserPreferences {
  timeZone: string | null;
  /** 0 = Sunday, 1 = Monday, 6 = Saturday. */
  weekStart: 0 | 1 | 6 | null;
  /**
   * "Show my projects only" (1.22, an administrator's own; off by default): their lists everywhere
   * show only the projects they own, manage or are on the team of (companies/company-access.ts).
   */
  myProjectsOnly: boolean;
  /**
   * Compact / comfortable rows (1.23.0, anyone's own; comfortable by default): compact makes the
   * website's lists, tables and boards denser. Phones and touch screens always stay comfortable.
   */
  density: Density;
  /**
   * 1.23.8: the website's side menu folded to its icons on a desktop screen (false = open, the default).
   * Tablets always show the icons; phones keep the ☰ menu.
   */
  sidebarCollapsed: boolean;
  /** 1.23.8: how wide the Kanban board's columns are for this person (Normal by default). */
  boardColumnWidth: BoardColumnWidth;
}

/**
 * Row modes: comfortable (today's look), compact (1.23.0: denser, desktop only) and detailed (1.23.8: more
 * on each card and row — the description's first line, checklist count, tags, project, everyone on it —
 * and titles never cut; phones too).
 */
export const DENSITIES = ['comfortable', 'compact', 'detailed'] as const;
export type Density = (typeof DENSITIES)[number];

export const BOARD_COLUMN_WIDTHS = ['narrow', 'normal', 'wide'] as const;
export type BoardColumnWidth = (typeof BOARD_COLUMN_WIDTHS)[number];

/** Said to someone who isn't an administrator asking to turn "Show my projects only" on. */
export const MY_PROJECTS_ONLY_REFUSED = 'Only administrators have this setting.';

export interface PreferencesRepository {
  get(userId: string): Promise<UserPreferences>;
  set(userId: string, patch: Partial<UserPreferences>): Promise<UserPreferences>;
}

const NONE: UserPreferences = { timeZone: null, weekStart: null, myProjectsOnly: false, density: 'comfortable', sidebarCollapsed: false, boardColumnWidth: 'normal' };

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
    myProjectsOnly: z.boolean().optional(),
    density: z.enum(DENSITIES).optional(),
    sidebarCollapsed: z.boolean().optional(),
    boardColumnWidth: z.enum(BOARD_COLUMN_WIDTHS).optional(),
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
  type Row = { preferredTimeZone: string | null; weekStart: number | null; myProjectsOnly: boolean; density: string; sidebarCollapsed: boolean; boardColumnWidth: string };
  // An unexpected stored word reads as the default.
  const toPrefs = (u: Row | null): UserPreferences => ({
    timeZone: u?.preferredTimeZone ?? null,
    weekStart: u?.weekStart === 0 || u?.weekStart === 1 || u?.weekStart === 6 ? u.weekStart : null,
    myProjectsOnly: u?.myProjectsOnly === true,
    density: (DENSITIES as readonly string[]).includes(u?.density ?? '') ? (u!.density as Density) : 'comfortable',
    sidebarCollapsed: u?.sidebarCollapsed === true,
    boardColumnWidth: (BOARD_COLUMN_WIDTHS as readonly string[]).includes(u?.boardColumnWidth ?? '') ? (u!.boardColumnWidth as BoardColumnWidth) : 'normal',
  });
  const select = { preferredTimeZone: true, weekStart: true, myProjectsOnly: true, density: true, sidebarCollapsed: true, boardColumnWidth: true } as const;
  return {
    async get(userId) {
      return toPrefs(await prisma.user.findUnique({ where: { id: userId }, select }));
    },
    async set(userId, patch) {
      const data: { preferredTimeZone?: string | null; weekStart?: number | null; myProjectsOnly?: boolean; density?: Density; sidebarCollapsed?: boolean; boardColumnWidth?: BoardColumnWidth } = {};
      if (patch.timeZone !== undefined) data.preferredTimeZone = patch.timeZone;
      if (patch.weekStart !== undefined) data.weekStart = patch.weekStart;
      if (patch.myProjectsOnly !== undefined) data.myProjectsOnly = patch.myProjectsOnly;
      if (patch.density !== undefined) data.density = patch.density;
      if (patch.sidebarCollapsed !== undefined) data.sidebarCollapsed = patch.sidebarCollapsed;
      if (patch.boardColumnWidth !== undefined) data.boardColumnWidth = patch.boardColumnWidth;
      return toPrefs(await prisma.user.update({ where: { id: userId }, data, select }));
    },
  };
}

/**
 * GET / PUT /users/me/preferences — each person's own; a PUT changes only what it names. Turning on
 * "Show my projects only" is an administrator's alone (anyone may send it off); the row mode, the collapsed
 * menu and the board column width (1.23.8) are anyone's.
 */
export async function registerPreferenceRoutes(app: FastifyInstance, deps: { repo: PreferencesRepository; guard: AuthGuard }): Promise<void> {
  const { repo, guard } = deps;
  app.get('/users/me/preferences', { preHandler: guard.authenticate }, async (req) => ({ data: await repo.get(req.user!.id) }));
  app.put('/users/me/preferences', { preHandler: guard.authenticate }, async (req) => {
    const patch = patchSchema.parse(req.body ?? {});
    if (patch.myProjectsOnly === true && !(req.user!.roles ?? []).includes('ADMIN')) throw new ForbiddenError(MY_PROJECTS_ONLY_REFUSED);
    return { data: await repo.set(req.user!.id, patch as Partial<UserPreferences>) };
  });
}
