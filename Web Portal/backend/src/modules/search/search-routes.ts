import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import type { SearchService } from './search-service';
import type { AuthGuard } from '../auth/auth-guard';
import { TASK_STATUSES, type TaskSearchEngine } from './task-search-engine';
import { createTaskSearchScope } from './task-search-scope';
import { parseTaskQuery } from './task-search-query';

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
  /** Project ids a user may see (`null` = admin, unscoped) — scopes task/project results. */
  accessibleProjectIds?: (userId: string, roles: string[]) => Promise<string[] | null>;
  /** The full task search (GET /search/tasks). */
  taskSearch?: Pick<TaskSearchEngine, 'search'>;
}

export async function registerSearchRoutes(app: FastifyInstance, deps: SearchRouteDeps): Promise<void> {
  const { searchService, guard } = deps;
  app.get('/search', { preHandler: guard.authenticate }, async (req) => {
    const { q } = querySchema.parse(req.query);
    // Object-level scope: a non-admin only ever finds tasks/projects in projects they belong to.
    const allowedProjectIds = deps.accessibleProjectIds ? await deps.accessibleProjectIds(req.user!.id, req.user!.roles ?? []) : null;
    return { data: await searchService.search(q, { allowedProjectIds, userId: req.user!.id }) };
  });

  const taskSearch = deps.taskSearch;
  if (!taskSearch) return;
  const scopes = createTaskSearchScope({ accessibleProjectIds: deps.accessibleProjectIds });
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
      scope: await scopes.forViewer({ id: user.id, roles: user.roles ?? [] }),
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
