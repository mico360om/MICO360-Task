import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
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
  /** 1.23 Search everything (GET /search/all, the AI panel; GET /search's `more`). */
  everything?: SearchEverythingDeps;
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
    const everything = deps.everything;
    // 1.23: the top bar also shows the best few notes, minutes, files and inspections (never holding it up on a failure).
    const [found, more] = await Promise.all([
      searchService.search(q, { allowedProjectIds, userId: viewer.id, pick, admin: admin && !mineOnly, people, companyIds }),
      everything && parseTaskQuery(q).terms.length
        ? everything.scope
            .forViewer(viewer, pick)
            .then((scope) => everything.engine.search({ q, scope, viewerId: viewer.id, kinds: ['note', 'minutes', 'file', 'inspection'], limit: GLOBAL_MORE_LIMIT }))
            .then((r) => r.hits, () => [] as SearchHit[])
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

  function registerEverything(everything: SearchEverythingDeps): void {
    const tz = everything.timeZone;
    const startOf = (dayKey: string) => zonedStartOfDay(dayKey, tz);
    /** The page's filters, as the engine and the AI panel take them ("me" is the person). */
    const filtersOf = (p: { type?: SearchKind[]; projectId?: string; done?: boolean; person?: string; from?: string; to?: string; archived?: boolean }, userId: string): AiSearchFilters => ({
      ...(p.type?.length ? { kinds: p.type } : {}),
      ...(p.projectId ? { projectId: p.projectId } : {}),
      ...(p.done !== undefined ? { done: p.done } : {}),
      ...(p.person ? { personId: p.person === 'me' ? userId : p.person } : {}),
      // Company days: "to 7 Nov" includes all of 7 Nov.
      ...(p.from ? { from: startOf(p.from) } : {}),
      ...(p.to ? { to: startOf(shiftDayKey(p.to, 1)) } : {}),
      ...(p.archived ? { includeArchived: true } : {}),
    });

    const allQuery = z.object({
      q: z.string().max(200).default(''),
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
    app.get('/search/all', { preHandler: guard.authenticate }, async (req) => {
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
      });
      return {
        data: result.hits,
        nextCursor: result.next ? encodeAllCursor(result.next) : null,
        corrected: result.corrected,
        ...(result.counts ? { counts: result.counts, total: result.total ?? result.hits.length, totalCapped: result.totalCapped ?? false } : {}),
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
    app.post('/search/ai', { preHandler: guard.authenticate }, async (req) => {
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
  if (!m) throw new z.ZodError([{ code: 'custom', path: ['cursor'], message: 'Invalid cursor.' }]);
  return { offset: Number(m[2]), extra: m[1] === 'x' };
}
