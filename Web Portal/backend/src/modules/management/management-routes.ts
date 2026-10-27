import { z } from 'zod';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { AuthGuard } from '../auth/auth-guard';
import { HttpError, ValidationError } from '../../lib/http-errors';
import { DEFAULT_STATUSES, PERIOD_WEEKS, PROJECT_STATUSES, type ProjectStatus } from './management-rules';
import type { ManagementFilters, ManagementService, ManagementViewer } from './management-service';
import { buildManagementPdf, managementPdfFileName } from './management-pdf';

export interface ManagementRouteDeps {
  service: ManagementService;
  guard: AuthGuard;
  /** The company time zone (the PDF's "generated at"). */
  timeZone: string;
  /** Who made a PDF (it says so). */
  userName?: (userId: string) => Promise<string | null>;
  /** PDFs per signed-in person a minute (default 10): a PDF takes real work to make. */
  pdfsPerMinute?: number;
  /** Overviews and lists per signed-in person a minute (default 120: plenty for refreshes on focus and opening lists). */
  readsPerMinute?: number;
}

const ID = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_PROJECTS = 100;
const idParam = z.string().regex(ID, 'Use a valid id.');
const list = (v: string | undefined) => [...new Set((v ?? '').split(',').map((x) => x.trim()).filter(Boolean))];

const filterQuery = z.object({
  projectIds: z.string().max(MAX_PROJECTS * 66).optional(),
  ownerId: idParam.optional().or(z.literal('')),
  status: z.string().max(200).optional(),
  weeks: z.string().optional(),
});

/** The page's filters from the address: chosen projects, owner, project statuses and the period (4, 12 or 26 weeks). */
export function parseManagementFilters(query: unknown): ManagementFilters {
  const parsed = filterQuery.safeParse(query ?? {});
  if (!parsed.success) throw new ValidationError('Those filters aren’t right.', parsed.error.flatten());
  const q = parsed.data;
  const projectIds = list(q.projectIds);
  if (projectIds.length > MAX_PROJECTS) throw new ValidationError(`Choose at most ${MAX_PROJECTS} projects.`);
  if (projectIds.some((id) => !ID.test(id))) throw new ValidationError('Those projects aren’t right.');
  const statuses = list(q.status);
  if (statuses.some((s) => !PROJECT_STATUSES.includes(s as ProjectStatus))) throw new ValidationError(`Status: choose from ${PROJECT_STATUSES.join(', ')}.`);
  const weeks = q.weeks === undefined || q.weeks === '' ? 12 : Number(q.weeks);
  if (!(PERIOD_WEEKS as readonly number[]).includes(weeks)) throw new ValidationError(`Weeks: choose ${PERIOD_WEEKS.join(', ')}.`);
  return {
    projectIds,
    ownerId: q.ownerId ? q.ownerId : null,
    statuses: statuses.length ? PROJECT_STATUSES.filter((s) => statuses.includes(s)) : [...DEFAULT_STATUSES],
    weeks,
  };
}

const itemQuery = z.object({
  metric: z.string().min(1, 'Say which list.').max(40),
  projectId: idParam.optional(),
  personId: idParam.optional(),
  formId: idParam.optional(),
  itemId: z.string().min(1).max(40).optional(),
  rag: z.enum(['RED', 'AMBER', 'GREEN']).optional(),
  failed: z
    .enum(['1', 'true'])
    .optional()
    .transform((v) => (v ? true : undefined)),
});

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
 * The Management page over HTTP. Everyone signed in may ask whether they may see it (the sidebar
 * link); the page itself, its lists and its PDF answer administrators (every project) and the people
 * who run a project (theirs) — anyone else gets a 403, and a project outside the caller's scope a 404.
 */
export async function registerManagementRoutes(app: FastifyInstance, deps: ManagementRouteDeps): Promise<void> {
  const { service, guard } = deps;
  const auth = { preHandler: guard.authenticate };
  const viewer = (req: FastifyRequest): ManagementViewer => ({ id: req.user!.id, roles: req.user!.roles ?? [] });

  app.get('/management/access', auth, async (req) => ({ data: await service.access(viewer(req)) }));

  // Each overview is some twenty grouped queries: counted per person (after the sign-in check).
  const allowRead = perMinute(deps.readsPerMinute ?? 120);
  const tooMany = () => new HttpError('Too many requests in a minute. Please wait a moment and try again.', 'RATE_LIMITED', 429);

  app.get('/management/overview', auth, async (req) => {
    const who = viewer(req);
    if (!allowRead(who.id)) throw tooMany();
    return { data: await service.overview(who, parseManagementFilters(req.query)) };
  });

  app.get('/management/items', auth, async (req) => {
    if (!allowRead(req.user!.id)) throw tooMany();
    const filters = parseManagementFilters(req.query);
    const parsed = itemQuery.safeParse(req.query ?? {});
    if (!parsed.success) throw new ValidationError('Say which list to show.', parsed.error.flatten());
    return { data: await service.items(viewer(req), filters, parsed.data) };
  });

  // A PDF takes real work to make: each person gets `pdfsPerMinute` a minute (counted after the
  // sign-in check, so per person — a whole office shares one address).
  const allowPdf = perMinute(deps.pdfsPerMinute ?? 10);

  app.get('/management/overview.pdf', auth, async (req, reply) => {
    const who = viewer(req);
    const filters = parseManagementFilters(req.query);
    if (!allowPdf(who.id)) throw new HttpError('Too many PDFs in a minute. Please wait a moment and try again.', 'RATE_LIMITED', 429);
    const overview = await service.overview(who, filters);
    const generatedBy = (await deps.userName?.(who.id).catch(() => null)) ?? null;
    const pdf = buildManagementPdf(overview, { generatedBy });
    return reply
      .header('Content-Type', 'application/pdf')
      .header('Content-Disposition', `attachment; filename="${managementPdfFileName(overview)}"`)
      .header('Cache-Control', 'no-store')
      .send(pdf);
  });
}
