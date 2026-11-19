import { z } from 'zod';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { AuthGuard } from '../auth/auth-guard';
import { HttpError, NotFoundError, ValidationError } from '../../lib/http-errors';
import { validationDetails } from '../../lib/validation-errors';
import { todayKey } from '../../lib/due-date';
import { COMPANY_HEADER } from '../companies/company-pick';
import type { PdfBrand } from '../companies/company-branding';
import { cleanFilterWords, pagePdfFileName, type PdfMeta } from './page-pdf-kit';
import { buildPerformancePdf, type PersonKpisWire } from './performance-pdf';
import { buildWorkloadPdf, type WorkloadWire } from './workload-pdf';
import { buildTimelinePdf, type TimelineTasksWire, type TimelineWire } from './timeline-pdf';
import { buildCalendarPdf, type CalendarDayAsk, type CalendarRangeWire, type MeetingWire } from './calendar-pdf';
import { buildProjectsPdf, type ProjectOverviewWire } from './projects-pdf';
import { buildBoardPdf, type BoardColumnAsk, type ColumnWire } from './board-pdf';
import { buildMyTasksPdf, type MyTasksGroupAsk } from './my-tasks-pdf';
import type { ProjectRef, TaskWire } from './task-wire';

export interface PagePdfRouteDeps {
  guard: AuthGuard;
  /** Company time zone: the file's day and the footer's "Printed …". */
  timeZone: string;
  /** Who made a PDF (the footer says so). */
  userName?: (userId: string) => Promise<string | null>;
  /** The PDF's company brand: the one project's main company, else the pick's, else the reader's. */
  pdfBrand?: (req: FastifyRequest, projectId: string | null) => Promise<PdfBrand>;
  /** PDFs per signed-in person a minute (default 10): a PDF takes real work to make. */
  pdfsPerMinute?: number;
  /** The time now (tests pin it). */
  now?: () => Date;
}

const ID = /^[A-Za-z0-9_-]{1,64}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MONTH = /^\d{4}-\d{2}$/;
const idText = z.string().regex(ID);
const words = z.array(z.string().max(400)).max(20).optional();

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

function parse<T>(schema: z.ZodType<T>, value: unknown, what: string): T {
  const parsed = schema.safeParse(value ?? {});
  if (!parsed.success) throw new ValidationError(what, validationDetails(parsed.error));
  return parsed.data;
}

const qs = (params: Record<string, string | undefined | null | false>) => {
  const out = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) out.set(k, v);
  const s = out.toString();
  return s ? `?${s}` : '';
};

const performanceQuery = z.object({ period: z.string().max(20).optional(), from: z.string().max(10).optional(), to: z.string().max(10).optional() });
const workloadQuery = z.object({ week: z.string().max(10).optional(), projectId: z.string().max(191).optional(), q: z.string().max(200).optional() });
const timelineQuery = z.object({
  from: z.string().max(10).optional(),
  to: z.string().max(10).optional(),
  weekStart: z.string().max(1).optional(),
  owner: z.string().max(64).optional(),
  show: z.enum(['', 'late', 'at-risk']).optional(),
  sort: z.enum(['attention', 'name', 'target']).optional(),
  /** The projects whose task rows are open on the page (comma-separated, at most 20). */
  expanded: z.string().max(20 * 65).optional(),
});
const calendarBody = z.object({
  view: z.enum(['month', 'week', 'day', 'agenda']),
  from: z.string().regex(DAY),
  to: z.string().regex(DAY),
  team: z.boolean().optional(),
  filters: words,
  days: z
    .array(
      z.object({
        day: z.string().regex(DAY),
        items: z.array(z.object({ kind: z.enum(['task', 'meeting']), id: idText, status: z.string().max(20).optional() })).max(2000),
      }),
    )
    .max(62),
});
const projectsBody = z.object({ all: z.boolean().optional(), tab: z.string().max(20).optional(), ids: z.array(idText).max(10000), filters: words });
const boardBody = z
  .object({
    projectId: z.union([idText, z.literal('all')]),
    date: z.string().regex(DAY).optional(),
    month: z.string().regex(MONTH).optional(),
    columns: z.array(z.object({ id: z.string().max(80), keys: z.array(z.string().max(40)).max(10000) })).max(40),
    filters: words,
  })
  .refine((b) => !(b.date && b.month), 'Ask for a day or a month, not both.');
const myTasksBody = z.object({ groups: z.array(z.object({ label: z.string().max(80), ids: z.array(idText).max(10000) })).max(10), filters: words });

/**
 * "Download PDF" on the Workspace pages (1.24.3). Each PDF asks the page's own data route — the same
 * route, query, viewer and picked company as the page (an internal request with the caller's own
 * session), so it has exactly the page's access: the page's 401/403/404 is the PDF's answer, a client
 * account is refused by the route table first, and nothing the page doesn't show this person can be
 * printed. A page that filters, searches, groups or orders in the browser names the rows it shows
 * (`ids`, a board's card keys, a calendar's day items); the PDF keeps only those of them the page's
 * answer holds, in that order, so it matches the screen and never widens it.
 */
export async function registerPagePdfRoutes(app: FastifyInstance, deps: PagePdfRouteDeps): Promise<void> {
  const { guard } = deps;
  const auth = { preHandler: guard.authenticate };
  // A big page (thousands of cards) names every row it shows: room for that in the body.
  const big = { preHandler: guard.authenticate, bodyLimit: 8 * 1024 * 1024 };
  const allow = perMinute(deps.pdfsPerMinute ?? 10);
  const now = () => deps.now?.() ?? new Date();
  const prefix = app.prefix;

  const limit = (req: FastifyRequest) => {
    if (!allow(req.user!.id)) throw new HttpError('Too many PDFs in a minute. Please wait a moment and try again.', 'RATE_LIMITED', 429);
  };

  /** The page's own data route, asked as this person (their session and picked company). Its refusal is ours. */
  async function read<T>(req: FastifyRequest, path: string): Promise<T> {
    const headers: Record<string, string> = {};
    if (typeof req.headers.authorization === 'string') headers.authorization = req.headers.authorization;
    const pick = req.headers[COMPANY_HEADER];
    if (typeof pick === 'string') headers[COMPANY_HEADER] = pick;
    const res = await app.inject({ method: 'GET', url: `${prefix}${path}`, headers });
    let body: { data?: T; error?: { code?: string; message?: string } } | null = null;
    try {
      body = res.json();
    } catch {
      body = null;
    }
    if (res.statusCode !== 200 || !body || !('data' in body)) {
      const status = res.statusCode >= 400 ? res.statusCode : 500;
      throw new HttpError(body?.error?.message ?? 'That couldn’t be read.', body?.error?.code ?? 'PAGE_DATA', status);
    }
    return body.data as T;
  }

  async function meta(req: FastifyRequest, projectId: string | null): Promise<PdfMeta> {
    const generatedBy = (await deps.userName?.(req.user!.id).catch(() => null)) ?? null;
    const company = deps.pdfBrand ? await deps.pdfBrand(req, projectId).catch(() => null) : null;
    return { generatedAt: now(), timeZone: deps.timeZone, generatedBy, company };
  }

  const today = () => todayKey(deps.timeZone, now());
  const send = (reply: import('fastify').FastifyReply, name: string, pdf: Buffer) =>
    reply
      .header('Content-Type', 'application/pdf')
      .header('Content-Disposition', `attachment; filename="${pagePdfFileName(name, today())}"`)
      .header('Cache-Control', 'no-store')
      .send(pdf);

  /** Projects by id for names and colours: the person's list, then (at most 40) the ones a row names that aren't on it (at most 10 more reads: each counts as one of the person's requests). */
  async function projectsFor(req: FastifyRequest, ids: Iterable<string>): Promise<Map<string, ProjectRef>> {
    const list = await read<ProjectRef[]>(req, '/projects').catch(() => [] as ProjectRef[]);
    const map = new Map((Array.isArray(list) ? list : []).map((p) => [p.id, p]));
    const missing = [...new Set(ids)].filter((id) => !map.has(id) && ID.test(id)).slice(0, 10);
    const extra = await Promise.all(missing.map((id) => read<ProjectRef>(req, `/projects/${encodeURIComponent(id)}`).catch(() => null)));
    for (const p of extra) if (p) map.set(p.id, p);
    return map;
  }

  // ── My performance and a person's performance ─────────────────────────────
  async function performance(req: FastifyRequest, who: string) {
    const q = parse(performanceQuery, req.query, 'Those filters aren’t right.');
    const data = await read<PersonKpisWire>(req, `/kpis/people/${who}${qs({ period: q.period, from: q.from, to: q.to })}`);
    return { data, self: who === 'me' || data.person.id === req.user!.id };
  }

  app.get('/kpis/people/me/export.pdf', auth, async (req, reply) => {
    limit(req);
    const { data } = await performance(req, 'me');
    return send(reply, 'My performance', buildPerformancePdf(data, { self: true }, await meta(req, null)));
  });

  app.get('/kpis/people/:userId/export.pdf', auth, async (req, reply) => {
    const { userId } = req.params as { userId?: string };
    if (typeof userId !== 'string' || !ID.test(userId)) throw new NotFoundError('Person not found.');
    limit(req);
    const { data, self } = await performance(req, encodeURIComponent(userId));
    return send(reply, self ? 'My performance' : 'Performance', buildPerformancePdf(data, { self }, await meta(req, null)));
  });

  // ── Workload ──────────────────────────────────────────────────────────────
  app.get('/workload.pdf', auth, async (req, reply) => {
    const q = parse(workloadQuery, req.query, 'Those filters aren’t right.');
    limit(req);
    const data = await read<WorkloadWire>(req, `/workload${qs({ week: q.week, projectId: q.projectId })}`);
    return send(reply, 'Workload', buildWorkloadPdf(data, { q: q.q ?? '' }, await meta(req, data.projectId)));
  });

  // ── Timeline ──────────────────────────────────────────────────────────────
  app.get('/timeline.pdf', auth, async (req, reply) => {
    const q = parse(timelineQuery, req.query, 'Those filters aren’t right.');
    limit(req);
    const data = await read<TimelineWire>(req, `/timeline${qs({ from: q.from, to: q.to, weekStart: q.weekStart })}`);
    const shown = new Set(data.projects.map((p) => p.id));
    const open = [...new Set((q.expanded ?? '').split(',').map((s) => s.trim()))].filter((id) => ID.test(id) && shown.has(id)).slice(0, 20);
    const tasks = new Map<string, TimelineTasksWire>();
    for (const id of open) {
      const rows = await read<TimelineTasksWire>(req, `/timeline/projects/${encodeURIComponent(id)}/tasks${qs({ from: data.from, to: data.to })}`).catch(() => null);
      if (rows) tasks.set(id, rows);
    }
    const pdf = buildTimelinePdf(data, { owner: q.owner ?? '', show: q.show ?? '', sort: q.sort ?? 'attention', tasks }, await meta(req, null));
    return send(reply, 'Timeline', pdf);
  });

  // ── Calendar ──────────────────────────────────────────────────────────────
  app.post('/calendar.pdf', big, async (req, reply) => {
    const body = parse(calendarBody, req.body, 'Say which days to print.');
    if (body.to < body.from) throw new ValidationError('Ask for days ending on or after the start.');
    limit(req);
    const range = await read<CalendarRangeWire>(req, `/calendar${qs({ from: body.from, to: body.to, team: body.team ? '1' : undefined })}`);
    // The meetings of the same days as the page asks for them (company time: a day either side, then each on its day).
    const meetings = await read<MeetingWire[]>(req, `/meetings${qs({ from: `${shiftKey(body.from, -1)}T00:00:00.000Z`, to: `${shiftKey(body.to, 2)}T00:00:00.000Z` })}`);
    const taskIds = [...range.tasks, ...(range.spanning ?? []), ...(range.series ?? [])].map((t) => t.projectId);
    const projects = await projectsFor(req, taskIds);
    const pdf = buildCalendarPdf(range, Array.isArray(meetings) ? meetings : [], body.days as CalendarDayAsk[], { view: body.view, from: body.from, to: body.to, today: today(), timeZone: deps.timeZone, filters: cleanFilterWords(body.filters), projects }, await meta(req, null));
    return send(reply, 'Calendar', pdf);
  });

  // ── Projects ──────────────────────────────────────────────────────────────
  app.post('/projects/overview.pdf', big, async (req, reply) => {
    const body = parse(projectsBody, req.body, 'Say which projects to print.');
    limit(req);
    const list = await read<ProjectOverviewWire[]>(req, `/projects/overview${qs({ all: body.all ? '1' : undefined })}`);
    const pdf = buildProjectsPdf(list, { ids: body.ids, tab: body.tab ?? 'all', filters: cleanFilterWords(body.filters), today: today(), timeZone: deps.timeZone }, await meta(req, brandProjectOf(list, body.ids)));
    return send(reply, 'Projects', pdf);
  });

  // ── Kanban Board ──────────────────────────────────────────────────────────
  app.post('/board.pdf', big, async (req, reply) => {
    const body = parse(boardBody, req.body, 'Say which board to print.');
    limit(req);
    const all = body.projectId === 'all';
    const tasks = await read<TaskWire[]>(
      req,
      `/tasks${qs({ projectId: all ? undefined : body.projectId, boardDate: body.date, month: body.month, undated: body.month ? 'true' : undefined })}`,
    );
    const columns = all ? null : await read<ColumnWire[]>(req, `/projects/${encodeURIComponent(body.projectId)}/columns`);
    const projects = await projectsFor(req, all ? tasks.map((t) => t.projectId) : [body.projectId]);
    const pdf = buildBoardPdf(tasks, columns, body.columns as BoardColumnAsk[], {
      project: all ? null : (projects.get(body.projectId) ?? null),
      projects,
      date: body.date ?? null,
      month: body.month ?? null,
      filters: cleanFilterWords(body.filters),
      today: today(),
      timeZone: deps.timeZone,
    }, await meta(req, all ? null : body.projectId));
    return send(reply, 'Kanban Board', pdf);
  });

  // ── My Tasks ──────────────────────────────────────────────────────────────
  app.post('/tasks/mine.pdf', big, async (req, reply) => {
    const body = parse(myTasksBody, req.body, 'Say which tasks to print.');
    limit(req);
    const tasks = await read<TaskWire[]>(req, '/tasks/mine');
    const projects = await projectsFor(req, tasks.map((t) => t.projectId));
    const pdf = buildMyTasksPdf(tasks, body.groups as MyTasksGroupAsk[], { projects, filters: cleanFilterWords(body.filters), today: today(), timeZone: deps.timeZone }, await meta(req, null));
    return send(reply, 'My Tasks', pdf);
  });
}

/** The one project a Projects PDF shows (its brand), only when the overview holds it for this person; else none. */
function brandProjectOf(list: ProjectOverviewWire[], ids: string[]): string | null {
  const held = new Set(list.map((p) => p.id));
  const shown = [...new Set(ids)].filter((id) => held.has(id));
  return shown.length === 1 ? shown[0]! : null;
}

/** A 'YYYY-MM-DD' day moved by whole days. */
function shiftKey(key: string, days: number): string {
  const d = new Date(`${key}T12:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
