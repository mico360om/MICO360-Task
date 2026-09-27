import { z } from 'zod';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { ReportFilter, ReportService } from './report-service';
import type { AuthGuard } from '../auth/auth-guard';
import { toCsv } from '../../lib/csv';
import { toSpreadsheetXml } from '../../lib/xlsx';
import { toSimplePdf } from '../../lib/pdf';
import { ValidationError } from '../../lib/http-errors';
import { shiftDayKey, todayKey } from '../../lib/due-date';
import { calendarDay, idString } from '../tasks/validation';
import { defaultCompanyTimeZone } from '../tasks/task-status';

export interface ReportRouteDeps {
  reportService: ReportService;
  guard: AuthGuard;
}

interface ReportDef {
  key: string; // url segment
  title: string; // human title / sheet name
  file: string; // base filename
  columns: string[];
  load: (svc: ReportService, filter: ReportFilter) => Promise<Record<string, unknown>[]>;
}

const REPORTS: ReportDef[] = [
  {
    key: 'status',
    title: 'Status Breakdown',
    file: 'status-breakdown',
    columns: ['category', 'count'],
    load: async (svc, filter) => Object.entries(await svc.taskStatusReport(filter)).map(([category, count]) => ({ category, count })),
  },
  {
    key: 'projects',
    title: 'Project Performance',
    file: 'project-performance',
    columns: ['projectId', 'projectName', 'total', 'completed', 'overdue', 'completionPct'],
    load: async (svc, filter) => (await svc.projectPerformanceReport(filter)) as unknown as Record<string, unknown>[],
  },
  {
    key: 'workload',
    title: 'User Workload',
    file: 'user-workload',
    columns: ['userId', 'username', 'assigned', 'completed', 'overdue'],
    load: async (svc, filter) => (await svc.workloadReport(filter)) as unknown as Record<string, unknown>[],
  },
];

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

function download(reply: FastifyReply, contentType: string, filename: string, body: string | Buffer): FastifyReply {
  return reply
    .header('Content-Type', contentType)
    .header('Content-Disposition', `attachment; filename="${filename}"`)
    .send(body);
}

export async function registerReportRoutes(app: FastifyInstance, deps: ReportRouteDeps): Promise<void> {
  const { reportService, guard } = deps;
  const adminOnly = { preHandler: guard.requireRoles('ADMIN') };
  const timeZone = reportService.timeZone ?? defaultCompanyTimeZone();

  app.get('/reports/status', adminOnly, async (req) => ({ data: await reportService.taskStatusReport(resolveFilter(req.query)) }));
  app.get('/reports/projects', adminOnly, async (req) => ({ data: await reportService.projectPerformanceReport(resolveFilter(req.query)) }));
  app.get('/reports/workload', adminOnly, async (req) => ({ data: await reportService.workloadReport(resolveFilter(req.query)) }));
  app.get('/reports/completion', adminOnly, async (req) => ({ data: await reportService.completionReport(resolveFilter(req.query)) }));

  // Time series (completion / overdue trend, burndown, velocity) over a ?from&to[&projectId&userId] range.
  app.get('/reports/timeseries', adminOnly, async (req) => ({ data: await reportService.timeSeriesReport(resolveRange(req.query, timeZone)) }));

  // Time-series exports honour the same range and filter params; rows are the daily points.
  const timeSeriesRows = async (req: { query: unknown }): Promise<Record<string, unknown>[]> =>
    (await reportService.timeSeriesReport(resolveRange(req.query, timeZone))).points as unknown as Record<string, unknown>[];
  app.get('/reports/timeseries.csv', adminOnly, async (req, reply) =>
    download(reply, 'text/csv; charset=utf-8', 'completion-trend.csv', toCsv(await timeSeriesRows(req), TIME_SERIES_COLUMNS)),
  );
  app.get('/reports/timeseries.xls', adminOnly, async (req, reply) =>
    download(reply, 'application/vnd.ms-excel; charset=utf-8', 'completion-trend.xls', toSpreadsheetXml('Completion Trend', TIME_SERIES_COLUMNS, await timeSeriesRows(req))),
  );
  app.get('/reports/timeseries.pdf', adminOnly, async (req, reply) =>
    download(reply, 'application/pdf', 'completion-trend.pdf', toSimplePdf({ title: 'Completion Trend', columns: TIME_SERIES_COLUMNS, rows: await timeSeriesRows(req) })),
  );

  // Export each report as CSV, Excel (SpreadsheetML) or PDF (T12.2), with the same filters as on screen.
  for (const def of REPORTS) {
    app.get(`/reports/${def.key}.csv`, adminOnly, async (req, reply) => {
      const rows = await def.load(reportService, resolveFilter(req.query));
      return download(reply, 'text/csv; charset=utf-8', `${def.file}.csv`, toCsv(rows, def.columns));
    });
    app.get(`/reports/${def.key}.xls`, adminOnly, async (req, reply) => {
      const rows = await def.load(reportService, resolveFilter(req.query));
      return download(reply, 'application/vnd.ms-excel; charset=utf-8', `${def.file}.xls`, toSpreadsheetXml(def.title, def.columns, rows));
    });
    app.get(`/reports/${def.key}.pdf`, adminOnly, async (req, reply) => {
      const rows = await def.load(reportService, resolveFilter(req.query));
      return download(reply, 'application/pdf', `${def.file}.pdf`, toSimplePdf({ title: def.title, columns: def.columns, rows }));
    });
  }
}
