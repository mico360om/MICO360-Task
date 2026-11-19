import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AuthGuard } from '../auth/auth-guard';
import { NotFoundError } from '../../lib/http-errors';
import { buildXlsx, XLSX_CONTENT_TYPE } from '../../lib/xlsx-writer';
import { APPRECIATION_ANIMATIONS, APPRECIATION_ICONS, APPRECIATION_STATUSES, APPRECIATION_THEMES, LIMITS, dayWords, normaliseTheme } from './appreciation-rules';
import type { AppreciationService, ListFilters, ManagedRow } from './appreciation-service';

/**
 * Employee Appreciation over HTTP (staff only: a client account's session is refused by the route table).
 *
 *   /appreciations/me…             the person's own: today's (Dashboard theme, banner, popup), accept, close the
 *                                  popup, My appreciations
 *   /appreciations/manage/…        administrators and Appreciation managers (the service checks): templates,
 *                                  people and companies to pick, send, history (+ Excel), edit and cancel
 */
export interface AppreciationRouteDeps {
  service: AppreciationService;
  guard: AuthGuard;
}

const ID = /^[A-Za-z0-9_-]{1,64}$/;
const text = (max: number) => z.string().trim().min(1, 'Required.').max(max, `At most ${max} characters.`);
const content = {
  title: text(LIMITS.title),
  message: text(LIMITS.message),
  // A theme's name, or (1.24.4) a custom colour #rrggbb, kept in lower case.
  theme: z.string().transform((v, ctx) => {
    const t = normaliseTheme(v);
    if (t) return t;
    ctx.addIssue({ code: 'custom', message: `Choose a colour theme (${APPRECIATION_THEMES.join(', ')}) or a colour like #1e6091.` });
    return z.NEVER;
  }),
  icon: z.enum(APPRECIATION_ICONS),
  animation: z.enum(APPRECIATION_ANIMATIONS),
};
const templateBody = z.object({ name: text(LIMITS.name), ...content }).strict();
const scheduleBody = z
  .object({
    recipientIds: z.array(z.string().regex(ID)).min(1, 'Choose at least one person.').max(LIMITS.recipients, `At most ${LIMITS.recipients} people at once.`),
    templateId: z.string().regex(ID).nullable().optional(),
    day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose a day.'),
    ...content,
  })
  .strict();
const editBody = z
  .object({ day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose a day.'), ...content })
  .partial()
  .strict()
  .refine((b) => Object.keys(b).length > 0, 'Nothing to change.');

// 1.24.1: Accept may carry an optional note for the manager (plain text, trimmed, up to 500 characters).
const acceptBody = z
  .object({ note: z.string().trim().max(LIMITS.note, `A note can be at most ${LIMITS.note} characters.`).nullable().optional() })
  .nullable()
  .optional();

const listQuery = z.object({
  id: z.string().regex(ID).optional(),
  personId: z.string().regex(ID).optional(),
  status: z.enum(APPRECIATION_STATUSES).optional(),
  templateId: z.string().regex(ID).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  page: z.coerce.number().int().min(1).max(10_000).optional(),
  pageSize: z.coerce.number().int().min(1).max(200).optional(),
});

const STATUS_WORDS: Record<string, string> = { SCHEDULED: 'Scheduled', ACTIVE: 'Active', ACCEPTED: 'Accepted', EXPIRED: 'Expired', CANCELLED: 'Cancelled' };

/** The history as a workbook: one row per person appreciated. */
export function appreciationXlsx(rows: ManagedRow[], timeZone: string, now: Date = new Date()): Buffer {
  const at = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-GB', { timeZone, day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');
  return buildXlsx(
    [
      {
        name: 'Appreciations',
        title: 'Employee appreciations',
        notes: [`Generated ${at(now.toISOString())}`],
        columns: [
          { header: 'Day', kind: 'date' },
          { header: 'Person' },
          { header: 'Company' },
          { header: 'Title' },
          { header: 'Message', wrap: true },
          { header: 'Template' },
          { header: 'Status' },
          { header: 'Accepted at' },
          { header: 'Note', wrap: true },
          { header: 'Sent by' },
        ],
        rows: rows.map((r) => [{ date: r.day }, r.recipient.name, r.company.name, r.title, r.message, r.templateName ?? '', STATUS_WORDS[r.status] ?? r.status, at(r.acceptedAt), r.acceptNote ?? '', r.sender.name]),
      },
    ],
    { title: 'Employee appreciations', brand: '#B91C1C' },
    now,
  );
}

export async function registerAppreciationRoutes(app: FastifyInstance, deps: AppreciationRouteDeps & { timeZone: string }): Promise<void> {
  const { service, guard } = deps;
  const auth = { preHandler: guard.authenticate };
  const me = (req: FastifyRequest) => req.user!.id;
  const idOf = (req: FastifyRequest) => {
    const { id } = req.params as { id?: string };
    if (typeof id !== 'string' || !ID.test(id)) throw new NotFoundError('That appreciation was not found.');
    return id;
  };
  const filters = (req: FastifyRequest): ListFilters => listQuery.parse(req.query ?? {}) as ListFilters;

  // ── The person's own ────────────────────────────────────────────────────────
  app.get('/appreciations/me', auth, async (req) => ({ data: await service.me(me(req)) }));
  app.get('/appreciations/me/history', auth, async (req) => ({ data: await service.mine(me(req)) }));
  app.post('/appreciations/me/:id/accept', auth, async (req) => {
    const id = idOf(req);
    const note = acceptBody.parse(req.body ?? undefined)?.note || null;
    return { data: await service.accept(me(req), id, note, req.ip) };
  });
  app.post('/appreciations/me/:id/close', auth, async (req) => ({ data: await service.closePopup(me(req), idOf(req)) }));

  // ── Managing ────────────────────────────────────────────────────────────────
  app.get('/appreciations/manage/templates', auth, async (req) => {
    const archived = (req.query as Record<string, unknown> | undefined)?.archived === '1';
    return { data: await service.templates(me(req), { archived }) };
  });
  app.post('/appreciations/manage/templates', auth, async (req, reply) => reply.code(201).send({ data: await service.createTemplate(me(req), templateBody.parse(req.body), req.ip) }));
  app.put('/appreciations/manage/templates/:id', auth, async (req) => ({ data: await service.updateTemplate(me(req), idOf(req), templateBody.partial().parse(req.body), req.ip) }));
  app.post('/appreciations/manage/templates/:id/copy', auth, async (req, reply) => reply.code(201).send({ data: await service.duplicateTemplate(me(req), idOf(req), req.ip) }));
  app.post('/appreciations/manage/templates/:id/archive', auth, async (req) => ({ data: await service.archiveTemplate(me(req), idOf(req), true, req.ip) }));
  app.post('/appreciations/manage/templates/:id/unarchive', auth, async (req) => ({ data: await service.archiveTemplate(me(req), idOf(req), false, req.ip) }));

  app.get('/appreciations/manage/companies', auth, async (req) => ({ data: await service.companies(me(req)) }));
  app.get('/appreciations/manage/people', auth, async (req) => {
    const q = z.object({ search: z.string().max(80).optional(), companyId: z.string().regex(ID).optional() }).parse(req.query ?? {});
    return { data: await service.people(me(req), q) };
  });

  app.post('/appreciations/manage', auth, async (req, reply) => {
    const body = scheduleBody.parse(req.body);
    return reply.code(201).send({ data: await service.schedule(me(req), { ...body, templateId: body.templateId ?? null }, req.ip) });
  });
  app.get('/appreciations/manage', auth, async (req) => ({ data: await service.list(me(req), filters(req)) }));
  app.get('/appreciations/manage/export.xlsx', auth, async (req, reply) => {
    const rows = await service.exportRows(me(req), filters(req));
    const day = service.today();
    return reply
      .header('Content-Type', XLSX_CONTENT_TYPE)
      .header('Content-Disposition', `attachment; filename="Appreciations ${dayWords(day)}.xlsx"`)
      .header('Cache-Control', 'no-store')
      .send(appreciationXlsx(rows, deps.timeZone));
  });
  app.patch('/appreciations/manage/:id', auth, async (req) => ({ data: await service.update(me(req), idOf(req), editBody.parse(req.body), req.ip) }));
  app.post('/appreciations/manage/:id/cancel', auth, async (req) => ({ data: await service.cancel(me(req), idOf(req), req.ip) }));
}
