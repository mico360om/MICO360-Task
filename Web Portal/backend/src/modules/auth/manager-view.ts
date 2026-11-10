import { HttpError } from '../../lib/http-errors';
import { ROUTE_CLASSES } from '../companies/route-classes';

/**
 * Manager View (owner, 10 Nov 2026): an administrator's own switch (users.managerView, Account menu).
 * While it is on they are treated as a non-administrator for settings and configuration — from the
 * website, the Android app and the extension alike — and stay an administrator for the work: every
 * project's tasks, boards and meetings, Reports, Management, the Recycle Bin, their own settings.
 *
 * ONE central check, asked by the auth guard on every signed-in request from the route's own pattern
 * (auth-guard.ts), so a route can't forget it:
 *
 *   refuse            every administrator-only route — the companies table's `admin` class (route-classes.ts)
 *                     or a `requireRoles('ADMIN')` guard — answers 403 MANAGER_VIEW (reads and writes), unless
 *                     reviewed into MANAGER_VIEW_ALLOWED below with a reason. A route added later is refused
 *                     by default: manager-view.test.ts scans the source.
 *   project-settings  a project's settings (its details, picture, archive, columns, team, client links) open
 *                     only for a project they run — its owner, named manager or a MANAGER member of its team
 *                     (the team rule alone: an administrator needn't belong to the project's company) — and
 *                     there with their usual rights. Project payloads say so too (`canManage`, project-routes).
 *   open              everything else, as an administrator.
 *
 * The switch itself (MANAGER_VIEW_SWITCH) is never refused: the last active administrator can always turn it
 * off. For anyone who isn't an administrator the stored switch means nothing.
 *
 * Later lanes: an administrator-only page's routes (e.g. Guest contacts) are refused here as soon as they are
 * in the `admin` class or guarded by requireRoles('ADMIN') — nothing to add. An administrator-only action that
 * is WORK, not a setting (e.g. the Recycle Bin's "Delete forever"), must be reviewed into MANAGER_VIEW_ALLOWED.
 */

export const MANAGER_VIEW_CODE = 'MANAGER_VIEW';

export const MANAGER_VIEW_WORDS = {
  /** Every refusal (the website shows its own page for an admin page's address). */
  refused: 'Manager View is on — turn it off to change settings.',
  /** Said to someone who isn't an administrator (the switch is ignored for them). */
  adminsOnly: 'Only administrators have Manager View.',
} as const;

/** Turning Manager View on or off: never refused. */
export const MANAGER_VIEW_SWITCH = 'PUT /users/me/manager-view';

/** Administrator-only routes Manager View leaves open, each with why (reviewed one by one). */
export const MANAGER_VIEW_ALLOWED: Readonly<Record<string, string>> = {
  'GET /reports/status': 'Reports (owner: they still see Reports)',
  'GET /reports/projects': 'Reports (owner: they still see Reports)',
  'GET /reports/workload': 'Reports (owner: they still see Reports)',
  'GET /reports/completion': 'Reports (owner: they still see Reports)',
  'GET /reports/timeseries': 'Reports (owner: they still see Reports)',
  'GET /reports/timeseries.csv': 'Reports export (owner: they still see Reports)',
  'GET /reports/timeseries.xls': 'Reports export (owner: they still see Reports)',
  'GET /reports/timeseries.pdf': 'Reports export (owner: they still see Reports)',
  'GET /reports/timeseries.xlsx': 'Reports export (owner: they still see Reports)',
  'GET /reports/${def.key}.csv': 'Reports export (owner: they still see Reports)',
  'GET /reports/${def.key}.xls': 'Reports export (owner: they still see Reports)',
  'GET /reports/${def.key}.pdf': 'Reports export (owner: they still see Reports)',
  'GET /reports/${def.key}.xlsx': 'Reports export (owner: they still see Reports)',
  'GET /reports/export.${format}': 'Reports export (owner: they still see Reports)',
};

/** Routes outside the `admin` class that are refused all the same (an administrator's alone, even for a project's managers). */
export const MANAGER_VIEW_ALWAYS_REFUSED: readonly string[] = ['DELETE /projects/:id'];

/** Where a project-settings route names its project: a route parameter that is the project, or a column of it. */
export type ProjectOfRoute = { project: string } | { column: string };

/** A project's settings — open in Manager View only for a project they run. */
export const PROJECT_SETTINGS_ROUTES: Readonly<Record<string, ProjectOfRoute>> = {
  'PUT /projects/:id': { project: 'id' },
  'POST /projects/:id/archive': { project: 'id' },
  'POST /projects/:id/image': { project: 'id' },
  'DELETE /projects/:id/image': { project: 'id' },
  'POST /projects/:id/columns': { project: 'id' },
  'PUT /columns/:columnId': { column: 'columnId' },
  'DELETE /columns/:columnId': { column: 'columnId' },
  'POST /projects/:id/members': { project: 'id' },
  'PATCH /projects/:id/members/:userId': { project: 'id' },
  'DELETE /projects/:id/members/:userId': { project: 'id' },
  'GET /projects/:id/client-shares': { project: 'id' },
  'POST /projects/:id/client-shares': { project: 'id' },
  'DELETE /projects/:id/client-shares/:shareId': { project: 'id' },
  'POST /projects/:id/client-shares/:shareId/resend': { project: 'id' },
};

export type ManagerViewRule = 'refuse' | 'project-settings' | 'open';

/**
 * A few routes are registered at the root with their full path ('GET /api/v1/metrics') and keep it in the
 * companies table, while the guard's key has the API prefix off ('GET /metrics'): look them up both ways.
 */
const withApiPrefix = (key: string): string => {
  const at = key.indexOf(' ');
  return `${key.slice(0, at)} /api/v1${key.slice(at + 1)}`;
};

/** What Manager View does with a route (`${METHOD} ${pattern}`, the API prefix off). */
export function managerViewRule(key: string): ManagerViewRule {
  if (key === MANAGER_VIEW_SWITCH) return 'open';
  if (key in MANAGER_VIEW_ALLOWED) return 'open';
  if (key in PROJECT_SETTINGS_ROUTES) return 'project-settings';
  // (A requireRoles('ADMIN') route outside the `admin` class must be listed in MANAGER_VIEW_ALWAYS_REFUSED or
  // MANAGER_VIEW_ALLOWED — manager-view.test.ts scans the guards and fails otherwise.)
  if (ROUTE_CLASSES[key] === 'admin' || ROUTE_CLASSES[withApiPrefix(key)] === 'admin' || MANAGER_VIEW_ALWAYS_REFUSED.includes(key)) return 'refuse';
  return 'open';
}

export interface ManagerViewSubject {
  roles: readonly string[];
  /** The stored switch (users.managerView). */
  managerView?: boolean;
}

export const isAdminRoles = (roles: readonly string[]): boolean => roles.includes('ADMIN');

/** An administrator with Manager View on (the switch means nothing for anyone else). */
export function inManagerView(user: ManagerViewSubject): boolean {
  return isAdminRoles(user.roles) && user.managerView === true;
}

/** The "effective administrator": role ADMIN and Manager View off. Every settings check asks this. */
export function isEffectiveAdmin(user: ManagerViewSubject): boolean {
  return isAdminRoles(user.roles) && user.managerView !== true;
}

/** The roles a settings check should see: ADMIN taken off while Manager View is on. */
export function effectiveRoles(user: ManagerViewSubject): string[] {
  return inManagerView(user) ? user.roles.filter((r) => r !== 'ADMIN') : [...user.roles];
}

export class ManagerViewError extends HttpError {
  constructor() {
    super(MANAGER_VIEW_WORDS.refused, MANAGER_VIEW_CODE, 403);
  }
}

/**
 * What the project-settings rule needs: does this person run the project — its owner, named manager or a
 * MANAGER member (project-managers' `managedProjectsWhere`, without the company condition: an administrator
 * sees every company's projects without belonging to them) — and a column's project.
 */
export interface ManagerViewLookup {
  runsProject(userId: string, projectId: string): Promise<boolean>;
  /** Of these projects, the ones they run (one lookup for a list). */
  runsAmong(userId: string, projectIds: string[]): Promise<string[]>;
  projectIdOfColumn(columnId: string): Promise<string | null>;
}

/**
 * The central check, for one signed-in request already known to be by an administrator in Manager View.
 * Throws ManagerViewError when refused; anything it lets through goes on with their usual rights.
 */
export async function assertManagerView(
  input: { key: string; userId: string; params: Record<string, unknown> | undefined },
  lookup: ManagerViewLookup | undefined,
): Promise<void> {
  const rule = managerViewRule(input.key);
  if (rule === 'open') return;
  if (rule === 'refuse' || !lookup) throw new ManagerViewError();
  const where = PROJECT_SETTINGS_ROUTES[input.key]!;
  const raw = 'project' in where ? input.params?.[where.project] : input.params?.[where.column];
  if (typeof raw !== 'string' || !raw) throw new ManagerViewError();
  const projectId = 'project' in where ? raw : await lookup.projectIdOfColumn(raw);
  if (!projectId || !(await lookup.runsProject(input.userId, projectId))) throw new ManagerViewError();
}
