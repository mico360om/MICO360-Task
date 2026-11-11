import { z } from 'zod';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { ReportFilter, ReportService } from './report-service';
import type { AuthGuard } from '../auth/auth-guard';
import { toCsv } from '../../lib/csv';
import { toSpreadsheetXml } from '../../lib/xlsx';
import { buildXlsx, XLSX_CONTENT_TYPE } from '../../lib/xlsx-writer';
import { BRAND } from '../../lib/export-format';
import { ValidationError } from '../../lib/http-errors';
import { ALL_SECTIONS, loadReportBundle, reportFileName, reportPdf, reportSheets, type ReportMeta, type ReportSection } from './report-export';
import { shiftDayKey, todayKey } from '../../lib/due-date';
import { calendarDay, idString } from '../tasks/validation';
import { defaultCompanyTimeZone } from '../tasks/task-status';
import { NO_PICK, type PickOf } from '../companies/company-pick';
import type { PdfBrand } from '../companies/company-branding';

/** Names for the exported documents: the filters' project and member, and who generated it. */
export interface ReportNames {
  project(id: string): Promise<string | null>;
  user(id: string): Promise<string | null>;
}

export interface ReportRouteDeps {
  reportService: ReportService;
  guard: AuthGuard;
  names?: ReportNames;
  /** companies: the request's picked company (X-Company-Id); every report and export follows it. Absent: no pick. */
  pickOf?: PickOf;
  /** companies: the project ids an administrator's pick covers (that company's projects). */
  accessibleProjectIds?: (userId: string, roles: string[], pick?: string | null) => Promise<string[] | null>;
  /** 1.22: does this administrator list like a team member ("Show my projects only")? Then the workload shows who has tasks there. */
  myProjectsOnly?: (viewer: { id: string; roles: string[] }) => Promise<boolean>;
  /** companies: a company's people (its active members) — the workload rows with a pick. */
  companyPeople?: (companyId: string) => Promise<string[]>;
  /**
   * Companies: the PDF's company brand — the filtered project's main company, else the picked
   * company, else the reader's primary company; absent: the site's.
   */
  pdfBrand?: (req: FastifyRequest, projectId: string | null) => Promise<PdfBrand>;
}

interface ReportDef {
  key: string; // url segment
  title: string; // human title / sheet name
  file: string; // base filename
  /** The section the branded .xlsx / .pdf export shows. */
  section: ReportSection;
  columns: string[];
  load: (svc: ReportService, filter: ReportFilter) => Promise<Record<string, unknown>[]>;
}

const REPORTS: ReportDef[] = [
  {
    key: 'status',
    title: 'Status Breakdown',
    file: 'status-breakdown',
    section: 'status',
    columns: ['category', 'count'],
    load: async (svc, filter) => Object.entries(await svc.taskStatusReport(filter)).map(([category, count]) => ({ category, count })),
  },
  {
    key: 'projects',
    title: 'Project Performance',
    file: 'project-performance',
    section: 'projects',
    columns: ['projectId', 'projectName', 'total', 'completed', 'overdue', 'completionPct'],
    load: async (svc, filter) => (await svc.projectPerformanceReport(filter)) as unknown as Record<string, unknown>[],
  },
  {
    key: 'workload',
    title: 'User Workload',
    file: 'user-workload',
    section: 'workload',
    columns: ['userId', 'username', 'name', 'assigned', 'completed', 'overdue'],
    load: async (svc, filter) => (await svc.workloadReport(filter)) as unknown as Record<string, unknown>[],
  },
];

/** 'Project Performance' → 'Project performance' (sentence case, like the apps' headings). */
const titleCase = (t: string): string => t.charAt(0) + t.slice(1).toLowerCase();

const DAY_MS = 86_400_000;
const DEFAULT_WINDOW_DAYS = 30;
const MAX_WINDOW_DAYS = 366;

/** The on-screen filters, accepted by every report endpoint and export: ?projectId & ?userId (team member). */
const filterQuery = z.object({ projectId: idString.optional(), userId: idString.optional() });
const rangeQuery = filterQuery.extend({ from: calendarDay.optional(), to: calendarDay.optional() });

function resolveFilter(query: unknown): ReportFilter {
  const { projectId, userId } = filterQuery.parse(query ?? {});
  return { ...(projectId ? { projectId } : {}), ...(userId ? { userId } : {}) };
}

/** Parse ?from/?to plus the filters, defaulting to the last 30 company-time days and clamping the span. */
function resolveRange(query: unknown, timeZone: string): { from: string; to: string } & ReportFilter {
  const { from, to } = rangeQuery.parse(query ?? {});
  const toKey = to ?? todayKey(timeZone);
  const fromKey = from ?? shiftDayKey(toKey, -(DEFAULT_WINDOW_DAYS - 1));
  if (fromKey > toKey) throw new ValidationError('`from` must be on or before `to`.');
  // Clamp overly wide windows so a series never grows unbounded.
  const span = Math.round((Date.parse(`${toKey}T00:00:00Z`) - Date.parse(`${fromKey}T00:00:00Z`)) / DAY_MS);
  const clampedFrom = span > MAX_WINDOW_DAYS - 1 ? shiftDayKey(toKey, -(MAX_WINDOW_DAYS - 1)) : fromKey;
  return { from: clampedFrom, to: toKey, ...resolveFilter(query) };
}

const TIME_SERIES_COLUMNS = ['date', 'created', 'completed', 'overdue', 'remaining', 'ideal'];

/** ?sections=summary,tasks — which parts of the full report to include (default: all). */
const sectionsQuery = z.object({
  sections: z
    .string()
    .max(200)
    .optional()
    .transform((v, ctx) => {
      if (!v) return ALL_SECTIONS;
      const picked = v.split(',').map((x) => x.trim()).filter(Boolean);
      if (picked.length === 0 || picked.some((x) => !ALL_SECTIONS.includes(x as ReportSection))) {
        ctx.addIssue({ code: 'custom', message: `sections: choose from ${ALL_SECTIONS.join(', ')}` });
        return z.NEVER;
      }
      return ALL_SECTIONS.filter((x) => picked.includes(x));
    }),
});

function download(reply: FastifyReply, contentType: string, filename: string, body: string | Buffer): FastifyReply {
  return reply
    .header('Content-Type', contentType)
    .header('Content-Disposition', `attachment; filename="${filename}"`)
    .header('Cache-Control', 'no-store')
    .send(body);
}

export async function registerReportRoutes(app: FastifyInstance, deps: ReportRouteDeps): Promise<void> {
  const { reportService, guard } = deps;
  const adminOnly = { preHandler: guard.requireRoles('ADMIN') };
  const timeZone = reportService.timeZone ?? defaultCompanyTimeZone();
  const names = deps.names;

  /**
   * companies: what a picked company limits every report to — its projects' tasks, and on the
   * workload its people plus whoever has a task there. Without a pick: everything, as before —
   * 1.22: unless the administrator turned on "Show my projects only": their projects' tasks, and the
   * people with tasks there (a list call: the pick named, null).
   */
  async function pickScopeOf(req: FastifyRequest): Promise<Pick<ReportFilter, 'projectIds' | 'peopleIds'>> {
    const pick = await (deps.pickOf ?? NO_PICK)(req);
    if (!pick) {
      const mine = deps.accessibleProjectIds ? await deps.accessibleProjectIds(req.user!.id, req.user!.roles ?? [], null) : null;
      return mine ? { projectIds: mine, peopleIds: [] } : {};
    }
    const viewer = { id: req.user!.id, roles: req.user!.roles ?? [] };
    const mineOnly = deps.myProjectsOnly ? await deps.myProjectsOnly(viewer) : false;
    const [projectIds, peopleIds] = await Promise.all([
      deps.accessibleProjectIds ? deps.accessibleProjectIds(viewer.id, viewer.roles, pick) : Promise.resolve([]),
      deps.companyPeople && !mineOnly ? deps.companyPeople(pick) : Promise.resolve([]),
    ]);
    return { projectIds: projectIds ?? [], peopleIds };
  }
  const filterOf = async (req: FastifyRequest): Promise<ReportFilter> => ({ ...resolveFilter(req.query), ...(await pickScopeOf(req)) });
  const rangeOf = async (req: FastifyRequest) => ({ ...resolveRange(req.query, timeZone), ...(await pickScopeOf(req)) });

  /** What a branded export says about itself: the filters by name, the period, who and when. */
  async function metaFor(req: FastifyRequest, title: string): Promise<{ meta: ReportMeta; range: ReturnType<typeof resolveRange> }> {
    const range = resolveRange(req.query, timeZone);
    const [projectName, memberName, generatedBy] = await Promise.all([
      range.projectId ? (names?.project(range.projectId) ?? null) : null,
      range.userId ? (names?.user(range.userId) ?? null) : null,
      req.user ? (names?.user(req.user.id) ?? null) : null,
    ]);
    return {
      range,
      meta: {
        title,
        generatedAt: new Date(),
        timeZone,
        generatedBy,
        projectName: range.projectId ? (projectName ?? 'Selected project') : null,
        memberName: range.userId ? (memberName ?? 'Selected member') : null,
        from: range.from,
        to: range.to,
      },
    };
  }

  async function exportReport(req: FastifyRequest, reply: FastifyReply, opts: { title: string; file: string; sections: ReportSection[]; format: 'xlsx' | 'pdf' }) {
    const { meta, range } = await metaFor(req, opts.title);
    const filter = { ...(range.projectId ? { projectId: range.projectId } : {}), ...(range.userId ? { userId: range.userId } : {}), ...(await pickScopeOf(req)) };
    const bundle = await loadReportBundle(reportService, { filter, from: range.from, to: range.to });
    if (opts.format === 'xlsx') {
      const body = buildXlsx(reportSheets(bundle, meta, opts.sections), { title: opts.title, brand: BRAND }, meta.generatedAt);
      return download(reply, XLSX_CONTENT_TYPE, reportFileName(opts.file, meta, 'xlsx'), body);
    }
    const company = deps.pdfBrand ? await deps.pdfBrand(req, range.projectId ?? null).catch(() => null) : null;
    return download(reply, 'application/pdf', reportFileName(opts.file, meta, 'pdf'), reportPdf(bundle, meta, opts.sections, company));
  }

  /** A CSV / .xls download's name, like the other exports: report + filters + the company day. */
  const fileName = async (req: FastifyRequest, file: string, ext: string) => reportFileName(file, (await metaFor(req, file)).meta, ext);

  // The full report (every section, or ?sections=…), with the on-screen filters and trend period.
  for (const format of ['xlsx', 'pdf'] as const) {
    app.get(`/reports/export.${format}`, adminOnly, async (req, reply) => {
      const { sections } = sectionsQuery.parse(req.query ?? {});
      return exportReport(req, reply, { title: 'Tasks report', file: 'tasks-report', sections, format });
    });
  }

  app.get('/reports/status', adminOnly, async (req) => ({ data: await reportService.taskStatusReport(await filterOf(req)) }));
  app.get('/reports/projects', adminOnly, async (req) => ({ data: await reportService.projectPerformanceReport(await filterOf(req)) }));
  app.get('/reports/workload', adminOnly, async (req) => ({ data: await reportService.workloadReport(await filterOf(req)) }));
  app.get('/reports/completion', adminOnly, async (req) => ({ data: await reportService.completionReport(await filterOf(req)) }));

  // Time series (completion / overdue trend, burndown, velocity) over a ?from&to[&projectId&userId] range.
  app.get('/reports/timeseries', adminOnly, async (req) => ({ data: await reportService.timeSeriesReport(await rangeOf(req)) }));

  // Time-series exports honour the same range and filter params; rows are the daily points.
  const timeSeriesRows = async (req: FastifyRequest): Promise<Record<string, unknown>[]> =>
    (await reportService.timeSeriesReport(await rangeOf(req))).points as unknown as Record<string, unknown>[];
  app.get('/reports/timeseries.csv', adminOnly, async (req, reply) =>
    download(reply, 'text/csv; charset=utf-8', await fileName(req, 'completion-trend', 'csv'), toCsv(await timeSeriesRows(req), TIME_SERIES_COLUMNS)),
  );
  app.get('/reports/timeseries.xls', adminOnly, async (req, reply) =>
    download(reply, 'application/vnd.ms-excel; charset=utf-8', await fileName(req, 'completion-trend', 'xls'), toSpreadsheetXml('Completion Trend', TIME_SERIES_COLUMNS, await timeSeriesRows(req))),
  );
  app.get('/reports/timeseries.pdf', adminOnly, async (req, reply) =>
    exportReport(req, reply, { title: 'Completion trend', file: 'completion-trend', sections: ['trend'], format: 'pdf' }),
  );
  app.get('/reports/timeseries.xlsx', adminOnly, async (req, reply) =>
    exportReport(req, reply, { title: 'Completion trend', file: 'completion-trend', sections: ['trend'], format: 'xlsx' }),
  );

  // Export each report as CSV, Excel (.xlsx; .xls is the older SpreadsheetML kept for old links) or a
  // branded PDF (T12.2), with the same filters as on screen.
  for (const def of REPORTS) {
    app.get(`/reports/${def.key}.csv`, adminOnly, async (req, reply) => {
      const rows = await def.load(reportService, await filterOf(req));
      return download(reply, 'text/csv; charset=utf-8', await fileName(req, def.file, 'csv'), toCsv(rows, def.columns));
    });
    app.get(`/reports/${def.key}.xls`, adminOnly, async (req, reply) => {
      const rows = await def.load(reportService, await filterOf(req));
      return download(reply, 'application/vnd.ms-excel; charset=utf-8', await fileName(req, def.file, 'xls'), toSpreadsheetXml(def.title, def.columns, rows));
    });
    app.get(`/reports/${def.key}.pdf`, adminOnly, async (req, reply) =>
      exportReport(req, reply, { title: titleCase(def.title), file: def.file, sections: [def.section], format: 'pdf' }),
    );
    app.get(`/reports/${def.key}.xlsx`, adminOnly, async (req, reply) =>
      exportReport(req, reply, { title: titleCase(def.title), file: def.file, sections: [def.section], format: 'xlsx' }),
    );
  }
}
