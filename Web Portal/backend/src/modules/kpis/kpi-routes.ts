import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { AuthGuard } from '../auth/auth-guard';
import { HttpError, NotFoundError, ValidationError } from '../../lib/http-errors';
import { XLSX_CONTENT_TYPE } from '../../lib/xlsx-writer';
import { parseManagementFilters } from '../management/management-routes';
import { NO_PICK, type PickOf } from '../companies/company-pick';
import type { PdfBrand } from '../companies/company-branding';
import { PERIOD_KINDS, type PeriodAsk } from './kpi-defs';
import type { KpiService, KpiViewer } from './kpi-service';
import { buildManagementKpiPdf, buildManagementKpiXlsx, buildProjectKpiPdf, buildProjectKpiXlsx, managementKpiFileName, projectKpiFileName } from './kpi-export';

export interface KpiRouteDeps {
  service: KpiService;
  guard: AuthGuard;
  /** May this person see this project (its owner, named manager, team, or an administrator)? */
  canViewProject: (userId: string, roles: string[], projectId: string) => Promise<boolean>;
  pickOf?: PickOf;
  /** Who made a file (it says so). */
  userName?: (userId: string) => Promise<string | null>;
  /** The PDF's company brand: the project's main company, else the pick's, else the reader's. */
  pdfBrand?: (req: FastifyRequest, projectId: string | null) => Promise<PdfBrand>;
  /** KPI pages per signed-in person a minute (default 120); files a minute (default 10). */
  readsPerMinute?: number;
  filesPerMinute?: number;
}

const ID = /^[A-Za-z0-9_-]{1,64}$/;
const MONTH = /^\d{4}-\d{2}$/;

/** ?period=week|month|quarter|custom&from=&to= (this month when none). */
export function parsePeriod(query: unknown): PeriodAsk {
  const q = (query ?? {}) as Record<string, unknown>;
  const kind = typeof q.period === 'string' && q.period ? q.period : 'month';
  if (!(PERIOD_KINDS as readonly string[]).includes(kind)) throw new ValidationError(`Period: choose ${PERIOD_KINDS.join(', ')}.`);
  if (kind === 'custom') return { kind, from: typeof q.from === 'string' ? q.from : '', to: typeof q.to === 'string' ? q.to : '' };
  return { kind: kind as 'week' | 'month' | 'quarter' };
}

/** Times per person within the last minute, kept in memory: false once `max` is reached. */
function perMinute(max: number) {
  const made = new Map<string, number[]>();
  return (userId: string): boolean => {
    const at = Date.now();
    const recent = (made.get(userId) ?? []).filter((t) => at - t < 60_000);
    if (recent.length >= max) {
      made.set(userId, recent);
      return false;
    }
    recent.push(at);
    made.set(userId, recent);
    if (made.size > 5000) for (const [k, v] of made) if (!v.some((t) => at - t < 60_000)) made.delete(k);
    return true;
  };
}

/**
 * Project KPIs and User KPIs over HTTP — staff only (a client account is refused by the guard's route
 * table before any of these run).
 *
 *   /kpis/projects/:id…   one project: anyone who may see it reads; whoever runs it (and administrators)
 *                         change its targets and its own KPIs (an archived project refuses: archive-guard).
 *                         A project the person can't see is a 404, never data.
 *   /kpis/management…     the Management page's KPI table: administrators and whoever runs a project.
 *   /kpis/people/…        a person's KPIs: themselves, administrators, and whoever runs a project they are
 *                         on (only those projects); anyone else 403.
 *   /kpis/targets         the company default targets: administrators.
 */
export async function registerKpiRoutes(app: FastifyInstance, deps: KpiRouteDeps): Promise<void> {
  const { service, guard } = deps;
  const auth = { preHandler: guard.authenticate };
  const admin = { preHandler: guard.requireRoles('ADMIN') };
  const viewer = (req: FastifyRequest): KpiViewer => ({ id: req.user!.id, roles: req.user!.roles ?? [] });
  const pickOf = deps.pickOf ?? NO_PICK;
  const allowRead = perMinute(deps.readsPerMinute ?? 120);
  const allowFile = perMinute(deps.filesPerMinute ?? 10);
  const tooMany = (what: string) => new HttpError(`Too many ${what} in a minute. Please wait a moment and try again.`, 'RATE_LIMITED', 429);
  const read = (req: FastifyRequest) => {
    if (!allowRead(req.user!.id)) throw tooMany('requests');
  };
  const file = (req: FastifyRequest) => {
    if (!allowFile(req.user!.id)) throw tooMany('files');
  };
  const nameOf = async (req: FastifyRequest) => (await deps.userName?.(req.user!.id).catch(() => null)) ?? null;
  const brandOf = async (req: FastifyRequest, projectId: string | null) => (deps.pdfBrand ? await deps.pdfBrand(req, projectId).catch(() => null) : null);

  async function visibleProject(req: FastifyRequest): Promise<string> {
    const { id } = req.params as { id?: string };
    const v = viewer(req);
    if (typeof id !== 'string' || !ID.test(id) || !(await deps.canViewProject(v.id, v.roles, id))) throw new NotFoundError('Project not found.');
    return id;
  }
  const kpiIdOf = (req: FastifyRequest) => {
    const { kpiId } = req.params as { kpiId?: string };
    if (typeof kpiId !== 'string' || !ID.test(kpiId)) throw new NotFoundError('KPI not found.');
    return kpiId;
  };
  const monthOf = (req: FastifyRequest) => {
    const { month } = req.params as { month?: string };
    if (typeof month !== 'string' || !MONTH.test(month)) throw new ValidationError('Choose a month.');
    return month;
  };
  const metricOf = (req: FastifyRequest) => {
    const m = (req.query as Record<string, unknown> | undefined)?.metric;
    if (typeof m !== 'string' || !m || m.length > 40) throw new ValidationError('Say which list.');
    return m;
  };
  const userIdOf = (req: FastifyRequest) => {
    const { userId } = req.params as { userId?: string };
    if (typeof userId !== 'string' || !ID.test(userId)) throw new NotFoundError('Person not found.');
    return userId;
  };

  // ── One project ───────────────────────────────────────────────────────────
  app.get('/kpis/projects/:id', auth, async (req) => {
    read(req);
    const id = await visibleProject(req);
    return { data: await service.projectKpis(viewer(req), id, parsePeriod(req.query)) };
  });

  app.get('/kpis/projects/:id/items', auth, async (req) => {
    read(req);
    const id = await visibleProject(req);
    return { data: await service.projectItems(id, metricOf(req), parsePeriod(req.query)) };
  });

  app.get('/kpis/projects/:id/export.pdf', auth, async (req, reply) => {
    const id = await visibleProject(req);
    file(req);
    const k = await service.projectKpis(viewer(req), id, parsePeriod(req.query));
    const pdf = buildProjectKpiPdf(k, { generatedBy: await nameOf(req), company: await brandOf(req, id) });
    return reply.header('Content-Type', 'application/pdf').header('Content-Disposition', `attachment; filename="${projectKpiFileName(k, 'pdf')}"`).header('Cache-Control', 'no-store').send(pdf);
  });

  app.get('/kpis/projects/:id/export.xlsx', auth, async (req, reply) => {
    const id = await visibleProject(req);
    file(req);
    const k = await service.projectKpis(viewer(req), id, parsePeriod(req.query));
    const body = buildProjectKpiXlsx(k, { generatedBy: await nameOf(req) });
    return reply.header('Content-Type', XLSX_CONTENT_TYPE).header('Content-Disposition', `attachment; filename="${projectKpiFileName(k, 'xlsx')}"`).header('Cache-Control', 'no-store').send(body);
  });

  app.get('/kpis/projects/:id/targets', auth, async (req) => {
    const id = await visibleProject(req);
    return { data: await service.projectTargets(id) };
  });

  app.put('/kpis/projects/:id/targets', auth, async (req) => {
    const id = await visibleProject(req);
    return { data: await service.saveProjectTargets(viewer(req), id, (req.body as { targets?: unknown } | null)?.targets) };
  });

  app.post('/kpis/projects/:id/custom', auth, async (req, reply) => {
    const id = await visibleProject(req);
    return reply.status(201).send({ data: await service.addCustom(viewer(req), id, req.body) });
  });

  app.patch('/kpis/projects/:id/custom/:kpiId', auth, async (req) => {
    const id = await visibleProject(req);
    return { data: await service.editCustom(viewer(req), id, kpiIdOf(req), req.body) };
  });

  app.delete('/kpis/projects/:id/custom/:kpiId', auth, async (req) => {
    const id = await visibleProject(req);
    return { data: await service.removeCustom(viewer(req), id, kpiIdOf(req)) };
  });

  app.put('/kpis/projects/:id/custom/:kpiId/values/:month', auth, async (req) => {
    const id = await visibleProject(req);
    return { data: await service.setCustomValue(viewer(req), id, kpiIdOf(req), monthOf(req), req.body) };
  });

  app.delete('/kpis/projects/:id/custom/:kpiId/values/:month', auth, async (req) => {
    const id = await visibleProject(req);
    return { data: await service.clearCustomValue(viewer(req), id, kpiIdOf(req), monthOf(req)) };
  });

  // ── The Management page's KPI table ──────────────────────────────────────
  app.get('/kpis/management', auth, async (req) => {
    read(req);
    return { data: await service.managementKpis(viewer(req), parseManagementFilters(req.query), await pickOf(req), parsePeriod(req.query)) };
  });

  app.get('/kpis/management.xlsx', auth, async (req, reply) => {
    file(req);
    const t = await service.managementKpis(viewer(req), parseManagementFilters(req.query), await pickOf(req), parsePeriod(req.query));
    const body = buildManagementKpiXlsx(t, { generatedBy: await nameOf(req) });
    return reply.header('Content-Type', XLSX_CONTENT_TYPE).header('Content-Disposition', `attachment; filename="${managementKpiFileName(t, 'xlsx')}"`).header('Cache-Control', 'no-store').send(body);
  });

  app.get('/kpis/management.pdf', auth, async (req, reply) => {
    file(req);
    const v = viewer(req);
    const filters = parseManagementFilters(req.query);
    const pick = await pickOf(req);
    const period = parsePeriod(req.query);
    const t = await service.managementKpis(v, filters, pick, period);
    const pages = [];
    for (const r of t.rows) pages.push(await service.projectKpis(v, r.project.id, period));
    const one = t.rows.length === 1 ? t.rows[0]!.project.id : null;
    const pdf = buildManagementKpiPdf(t, pages, { generatedBy: await nameOf(req), company: await brandOf(req, one) });
    return reply.header('Content-Type', 'application/pdf').header('Content-Disposition', `attachment; filename="${managementKpiFileName(t, 'pdf')}"`).header('Cache-Control', 'no-store').send(pdf);
  });

  // ── People ────────────────────────────────────────────────────────────────
  app.get('/kpis/people/me', auth, async (req) => {
    read(req);
    return { data: await service.personKpis(viewer(req), req.user!.id, parsePeriod(req.query)) };
  });

  app.get('/kpis/people/:userId', auth, async (req) => {
    read(req);
    return { data: await service.personKpis(viewer(req), userIdOf(req), parsePeriod(req.query)) };
  });

  app.get('/kpis/people/:userId/items', auth, async (req) => {
    read(req);
    return { data: await service.personItems(viewer(req), userIdOf(req), metricOf(req), parsePeriod(req.query)) };
  });

  // ── Company default targets (administrators) ──────────────────────────────
  app.get('/kpis/targets', admin, async (req) => {
    const c = (req.query as Record<string, unknown> | undefined)?.companyId;
    const companyId = typeof c === 'string' && c ? c : null;
    if (companyId && !ID.test(companyId)) throw new NotFoundError('Company not found.');
    return { data: await service.companyTargets(companyId ?? (await service.companyTargets(null)).companies[0]?.id ?? null) };
  });

  app.put('/kpis/targets', admin, async (req) => {
    const b = (req.body ?? {}) as { companyId?: unknown; targets?: unknown };
    const companyId = typeof b.companyId === 'string' && b.companyId ? b.companyId : null;
    if (companyId && !ID.test(companyId)) throw new NotFoundError('Company not found.');
    return { data: await service.saveCompanyTargets(viewer(req), companyId, b.targets) };
  });
}
