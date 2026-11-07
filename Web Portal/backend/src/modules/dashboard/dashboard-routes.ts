import { z } from 'zod';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { AuthGuard } from '../auth/auth-guard';
import type { AuditService } from '../audit/audit-service';
import type { Logger } from '../../lib/logger';
import { ValidationError } from '../../lib/http-errors';
import { NO_PICK, type PickOf } from '../companies/company-pick';
import { queryBoolean } from '../tasks/validation';
import type { PrioritiesService } from './priorities-service';
import type { DashboardLayoutStore } from './dashboard-layout-store';
import {
  allowedWidgets,
  BUILT_IN_DEFAULTS,
  groupOf,
  groupWidgets,
  layoutInput,
  LAYOUT_GROUPS,
  normalizeLayout,
  type DashboardLayout,
  type LayoutGroup,
  type WidgetId,
} from './dashboard-layout';

/** Said when a save names a widget the person (or the group) may not see. */
export const WIDGET_NOT_ALLOWED = 'That widget isn’t available here.';

export interface DashboardRouteDeps {
  guard: AuthGuard;
  /** "My Priorities Today" (absent: the route answers nothing — unit tests of other parts). */
  priorities?: Pick<PrioritiesService, 'get'>;
  layouts?: DashboardLayoutStore;
  /** May this person approve some project's tasks (the Approvals widget)? */
  canApprove?: (viewer: { id: string; roles: string[] }) => Promise<boolean>;
  /** companies: the request's picked company (X-Company-Id); the priorities follow it. */
  pickOf?: PickOf;
  audit?: AuditService;
  logger?: Pick<Logger, 'error'>;
}

const prioritiesQuery = z.object({ fresh: queryBoolean.optional() });
const ownBody = z.object({ layout: layoutInput.nullable() }).strict();
const defaultBody = z.object({ group: z.enum(['admins', 'everyone']), layout: layoutInput.nullable() }).strict();

/**
 * 1.23.4 Smarter Dashboard (staff only; a client account's session is refused by the guard):
 *   GET /dashboard/priorities              the person's "My Priorities Today" (list: the picked company)
 *   GET|PUT /users/me/dashboard-layout     their own widget arrangement (own); a PUT of null = Reset to default
 *   GET|PUT /settings/dashboard-default    the two defaults (administrators; every change audited)
 */
export async function registerDashboardRoutes(app: FastifyInstance, deps: DashboardRouteDeps): Promise<void> {
  const { guard } = deps;
  const viewerOf = (req: FastifyRequest) => ({ id: req.user!.id, roles: req.user!.roles ?? [] });

  if (deps.priorities) {
    const priorities = deps.priorities;
    app.get('/dashboard/priorities', { preHandler: guard.authenticate }, async (req) => {
      const { fresh } = prioritiesQuery.parse(req.query ?? {});
      const pick = await (deps.pickOf ?? NO_PICK)(req);
      return { data: await priorities.get(viewerOf(req), pick, { fresh: fresh === true }) };
    });
  }

  if (!deps.layouts) return;
  const store = deps.layouts;

  /** A group's default as it applies now: the administrator's saved one, else the built-in one. */
  async function defaultsNow(): Promise<Record<LayoutGroup, DashboardLayout>> {
    const saved = await store.getDefaults();
    return {
      admins: normalizeLayout(saved.admins ?? BUILT_IN_DEFAULTS.admins, BUILT_IN_DEFAULTS.admins, groupWidgets('admins')),
      everyone: normalizeLayout(saved.everyone ?? BUILT_IN_DEFAULTS.everyone, BUILT_IN_DEFAULTS.everyone, groupWidgets('everyone')),
    };
  }

  async function allowedFor(viewer: { id: string; roles: string[] }): Promise<WidgetId[]> {
    const admin = viewer.roles.includes('ADMIN');
    return allowedWidgets({ admin, canApprove: admin || (deps.canApprove ? await deps.canApprove(viewer) : false) });
  }

  /** The person's arrangement now: their own (new widgets at the default's place), else their group's default. */
  async function ownAnswer(viewer: { id: string; roles: string[] }) {
    const group = groupOf(viewer.roles);
    const [allowed, raw, defaults] = await Promise.all([allowedFor(viewer), store.getOwn(viewer.id), defaultsNow()]);
    const base = defaults[group];
    const defaultLayout = normalizeLayout(base, base, allowed);
    const customized = raw !== null && raw !== undefined;
    return { layout: customized ? normalizeLayout(raw, base, allowed) : defaultLayout, customized, group, widgets: allowed, defaultLayout };
  }

  const refuseUnless = (layout: DashboardLayout | null, allowed: readonly WidgetId[]) => {
    if (layout && layout.widgets.some((w) => !allowed.includes(w.id))) throw new ValidationError(WIDGET_NOT_ALLOWED);
  };

  app.get('/users/me/dashboard-layout', { preHandler: guard.authenticate }, async (req) => ({ data: await ownAnswer(viewerOf(req)) }));

  app.put('/users/me/dashboard-layout', { preHandler: guard.authenticate }, async (req) => {
    const viewer = viewerOf(req);
    const { layout } = ownBody.parse(req.body ?? {});
    refuseUnless(layout, await allowedFor(viewer));
    await store.setOwn(viewer.id, layout);
    return { data: await ownAnswer(viewer) };
  });

  app.get('/settings/dashboard-default', { preHandler: guard.requireRoles('ADMIN') }, async () => ({ data: { ...(await defaultsNow()), groups: LAYOUT_GROUPS } }));

  app.put('/settings/dashboard-default', { preHandler: guard.requireRoles('ADMIN') }, async (req) => {
    const { group, layout } = defaultBody.parse(req.body ?? {});
    refuseUnless(layout, groupWidgets(group));
    const before = (await defaultsNow())[group];
    await store.setDefault(group, layout);
    const after = await defaultsNow();
    try {
      await deps.audit?.record({ userId: req.user!.id, ip: req.ip ?? null, module: 'settings', action: 'dashboard.default.update', entityId: group, oldValue: before, newValue: layout ? after[group] : { reset: true, ...after[group] } });
    } catch (err) {
      deps.logger?.error('dashboard default: the audit log line failed', { err, group });
    }
    return { data: { ...after, groups: LAYOUT_GROUPS } };
  });
}
