import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import type { SearchService } from './search-service';
import type { AuthGuard } from '../auth/auth-guard';
import { TASK_STATUSES, type TaskSearchEngine } from './task-search-engine';
import { createTaskSearchScope } from './task-search-scope';
import { parseTaskQuery } from './task-search-query';
import { NO_PICK, type PickOf } from '../companies/company-pick';

const querySchema = z.object({ q: z.string().default('') });

/** Results per page of the full task search (at most 50). */
export const TASK_PAGE_SIZE = 20;

const flag = z.enum(['true', 'false']).transform((v) => v === 'true');
const taskQuerySchema = z.object({
  q: z.string().max(200).default(''),
  projectId: z.string().min(1).max(64).optional(),
  status: z
    .string()
    .optional()
    .transform((v) => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : undefined))
    .pipe(z.array(z.enum(TASK_STATUSES)).optional()),
  assigneeId: z.string().min(1).max(64).optional(),
  done: flag.optional(),
  archived: flag.optional(),
  limit: z.coerce.number().int().min(1).max(50).default(TASK_PAGE_SIZE),
  cursor: z.string().max(40).optional(),
});

/** The next page's cursor: where it starts, opaque to clients. */
export const encodeCursor = (offset: number): string => Buffer.from(`o:${offset}`, 'utf8').toString('base64url');
function decodeCursor(cursor: string | undefined): number {
  if (!cursor) return 0;
  const m = /^o:(\d{1,7})$/.exec(Buffer.from(cursor, 'base64url').toString('utf8'));
  if (!m) throw new z.ZodError([{ code: 'custom', path: ['cursor'], message: 'Invalid cursor.' }]);
  return Number(m[1]);
}

export interface SearchRouteDeps {
  searchService: SearchService;
  guard: AuthGuard;
  /** Project ids a user may see (`null` = admin, unscoped) — scopes task/project results; with a pick, that company's. */
  accessibleProjectIds?: (userId: string, roles: string[], pick?: string | null) => Promise<string[] | null>;
  /** The full task search (GET /search/tasks). */
  taskSearch?: Pick<TaskSearchEngine, 'search'>;
  /** companies: the request's picked company (X-Company-Id); both searches follow it. Absent: no pick. */
  pickOf?: PickOf;
  /** companies: the people this person may find (colleagues; with a pick, that company's); null = everyone (an admin). */
  peopleFor?: (viewer: { id: string; roles: string[] }, pick: string | null) => Promise<ReadonlySet<string> | null>;
  /** companies: this person's active companies (a meeting they were only invited to shows no notes). */
  companiesOf?: (userId: string) => Promise<string[]>;
  /** 1.22: does this administrator list like a team member ("Show my projects only")? Absent: never. */
  myProjectsOnly?: (viewer: { id: string; roles: string[] }) => Promise<boolean>;
}

export async function registerSearchRoutes(app: FastifyInstance, deps: SearchRouteDeps): Promise<void> {
  const { searchService, guard } = deps;
  // The one place both searches' project scope comes from (task-search-scope), with the pick.
  const scopes = createTaskSearchScope({ accessibleProjectIds: deps.accessibleProjectIds });
  const pickOf = deps.pickOf ?? NO_PICK;
  app.get('/search', { preHandler: guard.authenticate }, async (req) => {
    const { q } = querySchema.parse(req.query);
    // Object-level scope: a non-admin only ever finds tasks/projects in projects they belong to —
    // companies: in the picked company; people they may find; an invitation shows no notes.
    const viewer = { id: req.user!.id, roles: req.user!.roles ?? [] };
    const pick = await pickOf(req);
    const admin = viewer.roles.includes('ADMIN');
    const [{ projectIds: allowedProjectIds }, people, companyIds, mineOnly] = await Promise.all([
      scopes.forViewer(viewer, pick),
      deps.peopleFor ? deps.peopleFor(viewer, pick) : Promise.resolve(null),
      deps.companiesOf && !admin ? deps.companiesOf(viewer.id) : Promise.resolve(null),
      // 1.22: with "Show my projects only" an administrator's meetings follow the team rule too.
      admin && deps.myProjectsOnly ? deps.myProjectsOnly(viewer) : Promise.resolve(false),
    ]);
    return { data: await searchService.search(q, { allowedProjectIds, userId: viewer.id, pick, admin: admin && !mineOnly, people, companyIds }) };
  });

  const taskSearch = deps.taskSearch;
  if (!taskSearch) return;
  /**
   * Every task matching the words that the person can open (see task-search-engine), a page at a
   * time: `nextCursor` asks for the next page; the first page also says how many there are
   * (`total`, counted up to 1000 — `totalCapped` beyond).
   */
  app.get('/search/tasks', { preHandler: guard.authenticate }, async (req) => {
    const p = taskQuerySchema.parse(req.query);
    const offset = decodeCursor(p.cursor);
    const first = offset === 0;
    if (parseTaskQuery(p.q).terms.length === 0) return { data: [], nextCursor: null, ...(first ? { total: 0, totalCapped: false } : {}) };
    const user = req.user!;
    const result = await taskSearch.search({
      q: p.q,
      scope: await scopes.forViewer({ id: user.id, roles: user.roles ?? [] }, await pickOf(req)), // companies: the pick
      ...(p.projectId ? { projectId: p.projectId } : {}),
      ...(p.status?.length ? { statuses: p.status } : {}),
      ...(p.assigneeId ? { assigneeId: p.assigneeId === 'me' ? user.id : p.assigneeId } : {}),
      ...(p.done !== undefined ? { done: p.done } : {}),
      includeArchived: p.archived ?? false,
      limit: p.limit,
      offset,
      withTotal: first,
    });
    return {
      data: result.hits,
      nextCursor: result.nextOffset === null ? null : encodeCursor(result.nextOffset),
      ...(first ? { total: result.total ?? result.hits.length, totalCapped: result.totalCapped ?? false } : {}),
    };
  });
}
