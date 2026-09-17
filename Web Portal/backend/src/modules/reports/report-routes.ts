import { z } from 'zod';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { ReportService } from './report-service';
import type { AuthGuard } from '../auth/auth-guard';
import { toCsv } from '../../lib/csv';
import { toSpreadsheetXml } from '../../lib/xlsx';
import { toSimplePdf } from '../../lib/pdf';
import { ValidationError } from '../../lib/http-errors';

export interface ReportRouteDeps {
  reportService: ReportService;
  guard: AuthGuard;
}

interface ReportDef {
  key: string; // url segment
  title: string; // human title / sheet name
  file: string; // base filename
  columns: string[];
  load: (svc: ReportService) => Promise<Record<string, unknown>[]>;
}

const REPORTS: ReportDef[] = [
  {
    key: 'status',
    title: 'Status Breakdown',
    file: 'status-breakdown',
    columns: ['category', 'count'],
    load: async (svc) => Object.entries(await svc.taskStatusReport()).map(([category, count]) => ({ category, count })),
  },
  {
    key: 'projects',
    title: 'Project Performance',
    file: 'project-performance',
    columns: ['projectId', 'projectName', 'total', 'completed', 'overdue', 'completionPct'],
    load: async (svc) => (await svc.projectPerformanceReport()) as unknown as Record<string, unknown>[],
  },
  {
    key: 'workload',
    title: 'User Workload',
    file: 'user-workload',
    columns: ['userId', 'username', 'assigned', 'completed', 'overdue'],
    load: async (svc) => (await svc.workloadReport()) as unknown as Record<string, unknown>[],
  },
];

const DAY_MS = 86_400_000;
const DEFAULT_WINDOW_DAYS = 30;
const MAX_WINDOW_DAYS = 366;
const rangeQuery = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  projectId: z.string().min(1).optional(),
});
const dayKey = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/** Parse ?from/?to/?projectId, defaulting to the last 30 days and clamping the span. */
function resolveRange(query: unknown): { from: string; to: string; projectId?: string } {
  const { from, to, projectId } = rangeQuery.parse(query);
  const toKey = to ?? dayKey(Date.now());
  const toMs = Date.parse(`${toKey}T00:00:00.000Z`);
  const fromKey = from ?? dayKey(toMs - (DEFAULT_WINDOW_DAYS - 1) * DAY_MS);
  let fromMs = Date.parse(`${fromKey}T00:00:00.000Z`);
  if (Number.isNaN(fromMs) || Number.isNaN(toMs)) throw new ValidationError('Invalid date in range.');
  if (fromMs > toMs) throw new ValidationError('`from` must be on or before `to`.');
  // Clamp overly wide windows so a series never grows unbounded.
  if ((toMs - fromMs) / DAY_MS > MAX_WINDOW_DAYS - 1) fromMs = toMs - (MAX_WINDOW_DAYS - 1) * DAY_MS;
  return { from: dayKey(fromMs), to: toKey, ...(projectId ? { projectId } : {}) };
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

  app.get('/reports/status', adminOnly, async () => ({ data: await reportService.taskStatusReport() }));
  app.get('/reports/projects', adminOnly, async () => ({ data: await reportService.projectPerformanceReport() }));
  app.get('/reports/workload', adminOnly, async () => ({ data: await reportService.workloadReport() }));
  app.get('/reports/completion', adminOnly, async () => ({ data: await reportService.completionReport() }));

  // Time series (completion / overdue trend, burndown, velocity) over a ?from&to[&projectId] range.
  app.get('/reports/timeseries', adminOnly, async (req) => ({ data: await reportService.timeSeriesReport(resolveRange(req.query)) }));

  // Time-series exports honour the same range params; rows are the daily points.
  const timeSeriesRows = async (req: { query: unknown }): Promise<Record<string, unknown>[]> =>
    (await reportService.timeSeriesReport(resolveRange(req.query))).points as unknown as Record<string, unknown>[];
  app.get('/reports/timeseries.csv', adminOnly, async (req, reply) =>
    download(reply, 'text/csv; charset=utf-8', 'completion-trend.csv', toCsv(await timeSeriesRows(req), TIME_SERIES_COLUMNS)),
  );
  app.get('/reports/timeseries.xls', adminOnly, async (req, reply) =>
    download(reply, 'application/vnd.ms-excel; charset=utf-8', 'completion-trend.xls', toSpreadsheetXml('Completion Trend', TIME_SERIES_COLUMNS, await timeSeriesRows(req))),
  );
  app.get('/reports/timeseries.pdf', adminOnly, async (req, reply) =>
    download(reply, 'application/pdf', 'completion-trend.pdf', toSimplePdf({ title: 'Completion Trend', columns: TIME_SERIES_COLUMNS, rows: await timeSeriesRows(req) })),
  );

  // Export each report as CSV, Excel (SpreadsheetML) or PDF (T12.2).
  for (const def of REPORTS) {
    app.get(`/reports/${def.key}.csv`, adminOnly, async (_req, reply) => {
      const rows = await def.load(reportService);
      return download(reply, 'text/csv; charset=utf-8', `${def.file}.csv`, toCsv(rows, def.columns));
    });
    app.get(`/reports/${def.key}.xls`, adminOnly, async (_req, reply) => {
      const rows = await def.load(reportService);
      return download(reply, 'application/vnd.ms-excel; charset=utf-8', `${def.file}.xls`, toSpreadsheetXml(def.title, def.columns, rows));
    });
    app.get(`/reports/${def.key}.pdf`, adminOnly, async (_req, reply) => {
      const rows = await def.load(reportService);
      return download(reply, 'application/pdf', `${def.file}.pdf`, toSimplePdf({ title: def.title, columns: def.columns, rows }));
    });
  }
}
