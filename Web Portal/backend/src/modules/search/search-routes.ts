import { z } from 'zod';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { SearchService } from './search-service';
import type { AuthGuard } from '../auth/auth-guard';
import { TASK_STATUSES, type TaskSearchEngine } from './task-search-engine';
import { createTaskSearchScope } from './task-search-scope';
import { parseTaskQuery } from './task-search-query';
import { NO_PICK, type PickOf } from '../companies/company-pick';
import { shiftDayKey, zonedStartOfDay } from '../../lib/due-date';
import { SEARCH_KINDS, type SearchHit, type SearchKind } from './search-types';
import type { SearchAllInput, SearchAllResult } from './search-engine';
import type { SearchScopeAll } from './search-scope';
import type { AiSearchAnswer, AiSearchFilters } from './search-ai';
import type { SearchViewer } from './task-search-scope';

/** 1.23 Search everything: the engine, the person's scope and the AI panel (see search-engine, search-ai). */
export interface SearchEverythingDeps {
  engine: { search(input: SearchAllInput): Promise<SearchAllResult> };
  scope: { forViewer(viewer: SearchViewer, pick: string | null): Promise<SearchScopeAll> };
  ai?: {
    status(): Promise<{ ready: boolean; semantic: boolean }>;
    ask(input: { q: string; viewer: SearchViewer; scope: SearchScopeAll; filters: AiSearchFilters }): Promise<AiSearchAnswer>;
  };
  /** Company time zone: "from 1 Nov" starts at midnight there. */
  timeZone: string;
}

/** The top-bar search's other kinds (notes, minutes, files, inspections): its best few. */
export const GLOBAL_MORE_LIMIT = 5;
/** Results per page of search everything (at most 50). */
export const ALL_PAGE_SIZE = 20;
/** Search everything pages go this deep at most (the counts stop at 1000 too). */
export const MAX_ALL_OFFSET = 1000;

const csv = <T extends string>(values: readonly [T, ...T[]]) =>
  z
    .string()
    .optional()
    .transform((v) => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : undefined))
    .pipe(z.array(z.enum(values)).optional());
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'A date like 2026-11-03.').optional();
const allFilters = {
  type: csv(SEARCH_KINDS),
  projectId: z.string().min(1).max(64).optional(),
  status: csv(['BACKLOG', 'TODO', 'IN_PROGRESS', 'BLOCKED', 'REVIEW', 'DONE'] as const),
  person: z.string().min(1).max(64).optional(),
  from: day,
  to: day,
};

/**
 * The longest query read — one cap for every search here: the top bar's words are cut to it (1.22.5,
 * the 1.23 security review's cap too: never a pattern as long as an address can be), the full task
 * search and search everything refuse more.
 */
export const MAX_QUERY = 200;

/**
 * At most MAX_QUERY characters of a query (1.22.5): the website, the app and the extension send
 * whatever was typed or pasted, so a longer text is cut, never refused — and never between the two
 * halves of a letter written as two (an emoji).
 */
export function cutQuery(q: string): string {
  if (q.length <= MAX_QUERY) return q;
  const cut = q.slice(0, MAX_QUERY);
  return /[\uD800-\uDBFF]$/.test(cut) ? cut.slice(0, -1) : cut;
}

const querySchema = z.object({ q: z.string().default('').transform(cutQuery) });

/** Results per page of the full task search (at most 50). */
export const TASK_PAGE_SIZE = 20;

const flag = z.enum(['true', 'false']).transform((v) => v === 'true');
const taskQuerySchema = z.object({
  q: z.string().max(MAX_QUERY).default(''),
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
  /** 1.23 Search everything (GET /search/all, the AI panel; GET /search's `more`). */
  everything?: SearchEverythingDeps;
  /**
   * Security review (1.23): searches a person may make a minute, each route on its own (the top bar, the
   * results page, the task search, the AI panel). Default SEARCHES_PER_MINUTE.
   */
  perMinute?: number;
  /** 1.23.1: a part of a search that failed while the rest was shown is recorded here (the Error log). */
  logger?: { error(message: string, ctx?: Record<string, unknown>): void };
}

/** A person's searches a minute on each search route: well above typing in the top bar (a search per 250 ms pause). */
export const SEARCHES_PER_MINUTE = 120;

export async function registerSearchRoutes(app: FastifyInstance, deps: SearchRouteDeps): Promise<void> {
  const { searchService, guard } = deps;
  // The one place both searches' project scope comes from (task-search-scope), with the pick.
  const scopes = createTaskSearchScope({ accessibleProjectIds: deps.accessibleProjectIds });
  const pickOf = deps.pickOf ?? NO_PICK;
  // Per signed-in person (the site's own key: their user id), each route counted on its own.
  const searchRoute = { preHandler: guard.authenticate, config: { rateLimit: { max: deps.perMinute ?? SEARCHES_PER_MINUTE, timeWindow: '1 minute' } } };
  /**
   * 1.23.1: a part of a search that failed while the rest was shown (the live task search did, on its
   * database server) — recorded as a failed request is: its route pattern and the person, never the
   * address (it holds the words). Once per part and request, however many of its passes failed.
   */
  const partFailed = (req: FastifyRequest, part: 'tasks' | 'more') => {
    let told = false;
    return (err: unknown): void => {
      if (told) return;
      told = true;
      deps.logger?.error('search: a part of the search failed', { method: req.method, route: req.routeOptions?.url, part, err, userId: req.user?.id });
    };
  };
  app.get('/search', searchRoute, async (req) => {
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
    const everything = deps.everything;
    // 1.23: the top bar also shows the best few notes, minutes, files and inspections (never holding it up on a failure).
    const [found, more] = await Promise.all([
      // 1.23.1: the task search failing leaves the rest (`tasksUnavailable`, recorded once).
      searchService.search(q, { allowedProjectIds, userId: viewer.id, pick, admin: admin && !mineOnly, people, companyIds }, { onTasksFailed: partFailed(req, 'tasks') }),
      everything && parseTaskQuery(q).terms.length
        ? everything.scope
            .forViewer(viewer, pick)
            // Whole matches only: no spelling or some-words pass (security review) — they'd be dropped below anyway.
            .then((scope) => everything.engine.search({ q, scope, viewerId: viewer.id, kinds: ['note', 'minutes', 'file', 'inspection'], limit: GLOBAL_MORE_LIMIT, exactOnly: true }))
            // Only what holds every word (review M10): close and partial matches are for the results page, where they say so.
            .then(
              (r) => r.hits.filter((h) => !h.match),
              // 1.23.1: still never holding the rest up — but recorded, not dropped without a word.
              (err: unknown) => {
                partFailed(req, 'more')(err);
                return [] as SearchHit[];
              },
            )
        : Promise.resolve(null),
    ]);
    return { data: more ? { ...found, more } : found };
  });

  const taskSearch = deps.taskSearch;
  if (taskSearch) registerTaskSearch(taskSearch);
  if (deps.everything) registerEverything(deps.everything);

  function registerTaskSearch(taskSearch: Pick<TaskSearchEngine, 'search'>): void {
  /**
   * Every task matching the words that the person can open (see task-search-engine), a page at a
   * time: `nextCursor` asks for the next page; the first page also says how many there are
   * (`total`, counted up to 1000 — `totalCapped` beyond).
   */
  app.get('/search/tasks', searchRoute, async (req) => {
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

  function registerEverything(everything: SearchEverythingDeps): void {
    const tz = everything.timeZone;
    const startOf = (dayKey: string) => zonedStartOfDay(dayKey, tz);
    /** The page's filters, as the engine and the AI panel take them ("me" is the person). */
    const filtersOf = (p: { type?: SearchKind[]; projectId?: string; done?: boolean; person?: string; from?: string; to?: string; archived?: boolean }, userId: string): AiSearchFilters => ({
      ...(p.type?.length ? { kinds: p.type } : {}),
      ...(p.projectId ? { projectId: p.projectId } : {}),
      ...(p.done !== undefined ? { done: p.done } : {}),
      ...(p.person ? { personId: p.person === 'me' ? userId : p.person } : {}),
      // Company days: "to 7 Nov" includes all of 7 Nov; a task's due date by its calendar day (UTC midnight).
      ...(p.from ? { from: startOf(p.from), dueFrom: new Date(`${p.from}T00:00:00Z`) } : {}),
      ...(p.to ? { to: startOf(shiftDayKey(p.to, 1)), dueTo: new Date(`${shiftDayKey(p.to, 1)}T00:00:00Z`) } : {}),
      ...(p.archived ? { includeArchived: true } : {}),
    });

    const allQuery = z.object({
      q: z.string().max(MAX_QUERY).default(''),
      ...allFilters,
      done: flag.optional(),
      archived: flag.optional(),
      limit: z.coerce.number().int().min(1).max(50).default(ALL_PAGE_SIZE),
      cursor: z.string().max(40).optional(),
    });

    /**
     * Search everything: every kind of item the person may open that holds the words, a page at a time,
     * best first; the first page also counts each kind (`counts`, up to 1000 each) and says which
     * spelling corrections found results (`corrected`).
     */
    app.get('/search/all', searchRoute, async (req) => {
      const p = allQuery.parse(req.query);
      const { offset, extra } = decodeAllCursor(p.cursor);
      const first = offset === 0 && !extra;
      const viewer = { id: req.user!.id, roles: req.user!.roles ?? [] };
      const result = await everything.engine.search({
        q: p.q,
        scope: await everything.scope.forViewer(viewer, await pickOf(req)), // companies: the pick
        viewerId: viewer.id,
        ...filtersOf(p, viewer.id),
        ...(p.status?.length ? { taskStatuses: p.status } : {}),
        limit: p.limit,
        offset,
        extra,
        withCounts: first,
        // 1.23.1: the task half failing leaves the other kinds (`tasksUnavailable`, recorded once).
        onTasksFailed: partFailed(req, 'tasks'),
      });
      return {
        data: result.hits,
        nextCursor: result.next ? encodeAllCursor(result.next) : null,
        corrected: result.corrected,
        ...(result.counts ? { counts: result.counts, total: result.total ?? result.hits.length, totalCapped: result.totalCapped ?? false } : {}),
        ...(result.tasksUnavailable ? { tasksUnavailable: true } : {}),
      };
    });

    const ai = everything.ai;
    if (!ai) return;
    /** Is the AI panel on (a chat model set up), and is meaning search on (an embedding model)? */
    app.get('/search/ai/status', { preHandler: guard.authenticate }, async () => ({ data: await ai.status() }));

    const askBody = z.object({
      q: z.string().trim().min(2).max(300),
      type: z.union([z.array(z.enum(SEARCH_KINDS)), z.string()]).optional(),
      projectId: z.string().min(1).max(64).optional(),
      done: z.boolean().optional(),
      person: z.string().min(1).max(64).optional(),
      from: day,
      to: day,
      archived: z.boolean().optional(),
    });
    /** The AI panel: an answer from the items the person may open (one AI request off their limits). */
    app.post('/search/ai', searchRoute, async (req) => {
      const b = askBody.parse(req.body ?? {});
      const type = typeof b.type === 'string' ? z.array(z.enum(SEARCH_KINDS)).parse(b.type.split(',').map((s) => s.trim()).filter(Boolean)) : b.type;
      const viewer = { id: req.user!.id, roles: req.user!.roles ?? [] };
      const scope = await everything.scope.forViewer(viewer, await pickOf(req));
      return { data: await ai.ask({ q: b.q, viewer, scope, filters: filtersOf({ ...b, type }, viewer.id) }) };
    });
  }
}

/** Search everything's next page: where it starts, and whether it is in the extra passes' list. */
export const encodeAllCursor = (next: { offset: number; extra: boolean }): string => Buffer.from(`${next.extra ? 'x' : 'o'}:${next.offset}`, 'utf8').toString('base64url');
function decodeAllCursor(cursor: string | undefined): { offset: number; extra: boolean } {
  if (!cursor) return { offset: 0, extra: false };
  const m = /^([ox]):(\d{1,7})$/.exec(Buffer.from(cursor, 'base64url').toString('utf8'));
  // At most MAX_ALL_OFFSET deep (review M11): a page further on would make every match be sorted.
  if (!m || Number(m[2]) > MAX_ALL_OFFSET) throw new z.ZodError([{ code: 'custom', path: ['cursor'], message: 'Invalid cursor.' }]);
  return { offset: Number(m[2]), extra: m[1] === 'x' };
}
