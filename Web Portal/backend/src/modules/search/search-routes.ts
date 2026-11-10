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
import { savedSearchBody, type SavedSearches, type SavedSearchView } from './saved-searches';
import { READER_CHIP_KEYS, readQuery, type ReaderChip, type ReaderChipKey, type ReaderContext, type ReaderFilters } from './search-reader';

/** 1.23 Search everything: the engine, the person's scope and the AI panel (see search-engine, search-ai). */
export interface SearchEverythingDeps {
  engine: {
    search(input: SearchAllInput): Promise<SearchAllResult>;
    /** 1.23.6: how many items a search finds (the top bar's "→ 7", a saved search's count). */
    count?(input: SearchAllInput): Promise<{ total: number; capped: boolean }>;
  };
  scope: { forViewer(viewer: SearchViewer, pick: string | null): Promise<SearchScopeAll> };
  /**
   * 1.23.6 The built-in reader's context for this person: today, the week's first day, and the projects
   * and people they may see (`people`: those they may find, null = everyone). Absent: nothing is read.
   */
  reader?: (viewer: SearchViewer, pick: string | null, scope: SearchScopeAll, people: () => Promise<ReadonlySet<string> | null>) => Promise<ReaderContext>;
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
/** 1.23.6: the reader's chips taken off ("off=due,project"). */
const offList = csv(READER_CHIP_KEYS);
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

/** A cursor the API can't read: a 400 VALIDATION naming `cursor` (a real Error, like a failed check's). */
export const badCursor = (): z.ZodError => new z.ZodRealError([{ code: 'custom', path: ['cursor'], message: 'Invalid cursor.' }]);

/** The next page's cursor: where it starts, opaque to clients. */
export const encodeCursor = (offset: number): string => Buffer.from(`o:${offset}`, 'utf8').toString('base64url');
function decodeCursor(cursor: string | undefined): number {
  if (!cursor) return 0;
  const m = /^o:(\d{1,7})$/.exec(Buffer.from(cursor, 'base64url').toString('utf8'));
  if (!m) throw badCursor();
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
  /** 1.23.6 Saved searches (with `everything`: their counts too). */
  savedSearches?: SavedSearches;
}

/** 1.23.6: a saved search's count is kept this long (the side menu's pinned searches ask every minute). */
export const SAVED_COUNT_TTL_MS = 60_000;
/** At most this many saved searches are counted in one request. */
export const MAX_COUNTED = 10;

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
    // The search everything scope, worked out once for this request (review M9).
    let everyScope: Promise<SearchScopeAll> | null = null;
    const scopeOf = () => (everyScope ??= everything!.scope.forViewer(viewer, pick));
    // 1.23.6: what the reader understood, and how many items that finds ("Tasks · Overdue · MICO · Assigned to me → 7").
    const understood = everything?.reader && everything.engine.count ? understoodRow(everything, viewer, pick, q, scopeOf).catch(() => undefined) : Promise.resolve(undefined);
    // 1.23: the top bar also shows the best few notes, minutes, files and inspections (never holding it up on a failure).
    const [found, more, row] = await Promise.all([
      // 1.23.1: the task search failing leaves the rest (`tasksUnavailable`, recorded once).
      searchService.search(q, { allowedProjectIds, userId: viewer.id, pick, admin: admin && !mineOnly, people, companyIds }, { onTasksFailed: partFailed(req, 'tasks') }),
      everything && parseTaskQuery(q).terms.length
        ? scopeOf()
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
      understood,
    ]);
    return { data: { ...found, ...(more ? { more } : {}), ...(row ? { understood: row } : {}) } };
  });

  /** The top bar's first row: only when something was read. */
  /**
   * 1.23.6 Saved searches: the person's own and those shared with their teams; save, rename, re-save,
   * delete, share with a team (owner only), pin (up to 5), and each one's count — the saved search run
   * for whoever asks, kept for a minute.
   */
  function registerSaved(saved: SavedSearches, everything: SearchEverythingDeps): void {
    const own = { preHandler: guard.authenticate };
    const viewerOf = (req: FastifyRequest) => ({ id: req.user!.id, roles: req.user!.roles ?? [] });
    const idParam = z.object({ id: z.string().min(1).max(64) });
    app.get('/search/saved', own, async (req) => ({ data: await saved.list(viewerOf(req)) }));
    // Review I1: the picked company (checked first — a company the person isn't in is refused) narrows it.
    app.get('/search/saved/share-options', own, async (req) => ({ data: await saved.shareOptions(viewerOf(req), await pickOf(req)) }));
    app.post('/search/saved', own, async (req, reply) => {
      const created = await saved.create(viewerOf(req), savedSearchBody.parse(req.body ?? {}));
      reply.code(201);
      return { data: created };
    });
    app.patch('/search/saved/:id', own, async (req) => {
      const { id } = idParam.parse(req.params);
      return { data: await saved.update(viewerOf(req), id, savedSearchBody.partial().parse(req.body ?? {})) };
    });
    app.delete('/search/saved/:id', own, async (req, reply) => {
      const { id } = idParam.parse(req.params);
      await saved.remove(viewerOf(req), id);
      reply.code(204);
      return null;
    });
    app.put('/search/saved/:id/share', own, async (req) => {
      const { id } = idParam.parse(req.params);
      const { projectId } = z.object({ projectId: z.string().min(1).max(64).nullable() }).parse(req.body ?? {});
      return { data: await saved.share(viewerOf(req), id, projectId) };
    });
    app.put('/search/saved/:id/pin', own, async (req) => {
      const { id } = idParam.parse(req.params);
      const { pinned } = z.object({ pinned: z.boolean() }).parse(req.body ?? {});
      return { data: await saved.pin(viewerOf(req), id, pinned) };
    });

    const kept = new Map<string, { at: number; value: { total: number; capped: boolean } }>();
    const countOf = async (viewer: SearchViewer, pick: string | null, s: SavedSearchView, scopeOf: () => Promise<SearchScopeAll>): Promise<{ total: number; capped: boolean }> => {
      const key = `${viewer.id}|${pick ?? ''}|${s.id}|${s.updatedAt}`;
      const hit = kept.get(key);
      if (hit && Date.now() - hit.at < SAVED_COUNT_TTL_MS) return hit.value;
      const scope = await scopeOf();
      const f = s.filters;
      const read = await readFor(everything, viewer, pick, scope, s.q, f.off ?? [], f.plain ?? false);
      const input = engineInput(everything.timeZone, read?.ctx ?? null, viewer.id, { q: s.q, ...(f.type ? { type: [f.type] } : {}), projectId: f.projectId, ...(f.status ? { status: [f.status] } : {}), done: f.done, person: f.person, from: f.from, to: f.to, archived: f.archived }, read);
      const value = everything.engine.count && (input.browse || parseTaskQuery(input.q).terms.length) ? await everything.engine.count({ ...input, scope, viewerId: viewer.id, limit: 1 }) : { total: 0, capped: false };
      if (kept.size >= 5000) kept.clear();
      kept.set(key, { at: Date.now(), value });
      return value;
    };
    const idsQuery = z.object({
      ids: z
        .string()
        .max(800)
        .transform((v) => [...new Set(v.split(',').map((x) => x.trim()).filter(Boolean))])
        .pipe(z.array(z.string().min(1).max(64)).min(1).max(MAX_COUNTED)),
    });
    /** Counts of these saved searches (the side menu's pinned ones): one the person may not use is left out. */
    app.get('/search/saved/counts', searchRoute, async (req) => {
      // Review I1: the pick first (a company the person isn't in is refused before anything else).
      const pick = await pickOf(req);
      const { ids } = idsQuery.parse(req.query);
      const viewer = viewerOf(req);
      const out: Record<string, { total: number; capped: boolean }> = {};
      // Review M7: the person's searches read once, and their scope once, for every id asked.
      const list = await saved.list(viewer);
      const usable = new Map([...list.mine, ...list.shared].map((s) => [s.id, s]));
      let scope: Promise<SearchScopeAll> | null = null;
      const scopeOf = () => (scope ??= everything.scope.forViewer(viewer, pick));
      for (const id of ids) {
        const s = usable.get(id);
        if (s) out[id] = await countOf(viewer, pick, s, scopeOf);
      }
      return { data: out };
    });
  }

  async function understoodRow(everything: SearchEverythingDeps, viewer: SearchViewer, pick: string | null, q: string, scopeOf: () => Promise<SearchScopeAll>): Promise<(Understood & { total: number; capped: boolean }) | undefined> {
    if (!q.trim()) return undefined;
    const scope = await scopeOf();
    const read = await readFor(everything, viewer, pick, scope, q, [], false);
    if (!read || read.understood.chips.length === 0) return undefined;
    const input = engineInput(everything.timeZone, read.ctx, viewer.id, { q }, read);
    const counted = await everything.engine.count!({ ...input, scope, viewerId: viewer.id, limit: 1 });
    return { ...read.understood, total: counted.total, capped: counted.capped };
  }

  /** The reader's reading of the words, for this person (null: not read — plain words asked for, or no reader). */
  async function readFor(everything: SearchEverythingDeps, viewer: SearchViewer, pick: string | null, scope: SearchScopeAll, q: string, off: readonly ReaderChipKey[], plain: boolean): Promise<Reading | null> {
    if (plain || !everything.reader || !q.trim()) return null;
    const ctx = await everything.reader(viewer, pick, scope, () => (deps.peopleFor ? deps.peopleFor(viewer, pick) : Promise.resolve(null)));
    const all = readQuery(q, ctx);
    const read = off.length ? readQuery(q, ctx, { off }) : all;
    return {
      ctx,
      read,
      understood: { chips: read.chips, words: read.words, removed: all.chips.filter((c) => off.includes(c.key)).map((c) => ({ key: c.key, label: c.label })), ...(read.filters.kinds?.length ? { kinds: read.filters.kinds } : {}) },
    };
  }

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

    const allQuery = z.object({
      q: z.string().max(MAX_QUERY).default(''),
      ...allFilters,
      done: flag.optional(),
      archived: flag.optional(),
      // 1.23.6: the reader's chips taken off, and "Search the words instead".
      off: offList,
      plain: flag.optional(),
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
      const pick = await pickOf(req);
      const scope = await everything.scope.forViewer(viewer, pick); // companies: the pick
      // 1.23.6: the words as typed are read (unless plain words were asked for); the engine gets what is left.
      const read = await readFor(everything, viewer, pick, scope, p.q, p.off ?? [], p.plain ?? false);
      const result = await everything.engine.search({
        ...engineInput(tz, read?.ctx ?? null, viewer.id, p, read),
        scope,
        viewerId: viewer.id,
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
        ...(first ? { understood: read ? read.understood : null } : {}),
      };
    });

    if (deps.savedSearches) registerSaved(deps.savedSearches, everything);

    const ai = everything.ai;
    if (!ai) return;
    /** Is the AI panel on (a chat model set up), and is meaning search on (an embedding model)? */
    app.get('/search/ai/status', { preHandler: guard.authenticate }, async () => ({ data: await ai.status() }));

    const askBody = z.object({
      q: z.string().trim().min(2).max(300),
      // 1.23.6: as the results page reads the question (its chips taken off, or plain words).
      off: z.array(z.enum(READER_CHIP_KEYS)).max(READER_CHIP_KEYS.length).optional(),
      plain: z.boolean().optional(),
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
      const pick = await pickOf(req);
      const scope = await everything.scope.forViewer(viewer, pick);
      // 1.23.6: the AI is given what the reader read as filters (the whole question still goes to it).
      const read = await readFor(everything, viewer, pick, scope, b.q, b.off ?? [], b.plain ?? false);
      const { q: _words, browse: _browse, ...filters } = engineInput(tz, read?.ctx ?? null, viewer.id, { ...b, type }, read);
      void _words;
      void _browse;
      return { data: await ai.ask({ q: b.q, viewer, scope, filters }) };
    });
  }
}

/** 1.23.6: what the reader understood, as the page shows it — and the chips taken off ("Show 2 hidden filters"). */
export interface Understood {
  chips: ReaderChip[];
  words: string;
  removed: { key: ReaderChipKey; label: string }[];
  /** The kinds the kind chip reads as (the page shows that type chip pressed). */
  kinds?: SearchKind[];
}
interface Reading {
  ctx: ReaderContext;
  read: { chips: ReaderChip[]; words: string; filters: ReaderFilters };
  understood: Understood;
}

/** The page's own filters (GET /search/all, the AI panel's body). */
interface PageFilters {
  q: string;
  type?: SearchKind[];
  projectId?: string;
  status?: string[];
  done?: boolean;
  person?: string;
  from?: string;
  to?: string;
  archived?: boolean;
}

/**
 * 1.23.6 What the engine is asked: the words left by the reader (or as typed), the page's own filters,
 * and the reader's where the page sets none — "me" is whoever searches. A chip the page's filter
 * overrides is not shown. With no words but a filter, every item the filters hold (`browse`).
 */
export function engineInput(timeZone: string, ctx: ReaderContext | null, viewerId: string, p: PageFilters, reading: Reading | null): Omit<SearchAllInput, 'scope' | 'viewerId' | 'limit'> & AiSearchFilters & { q: string } {
  const f: ReaderFilters = reading?.read.filters ?? {};
  const startOf = (dayKey: string) => zonedStartOfDay(dayKey, timeZone);
  const utcDay = (dayKey: string) => new Date(`${dayKey}T00:00:00Z`);
  const me = (ids: string[]) => [...new Set(ids.map((id) => (id === 'me' ? viewerId : id)))];
  // A chip the page's own filter overrides is left out of what was understood.
  if (reading) {
    const overridden = new Set<ReaderChipKey>([
      ...(p.type?.length ? (['kind'] as const) : []),
      ...(p.projectId ? (['project'] as const) : []),
      ...(p.status?.length ? (['status'] as const) : []),
      ...(p.done !== undefined ? (['done'] as const) : []),
      ...(p.person ? (['mine'] as const) : []),
      ...(p.from || p.to ? (['when'] as const) : []),
    ]);
    // (What the kind chip read stays in `kinds`, review M5: the page's "All" then takes it off.)
    reading.understood.chips = reading.understood.chips.filter((c) => !overridden.has(c.key));
  }
  const from = p.from || p.to ? p.from : f.from;
  const to = p.from || p.to ? p.to : f.to;
  const due = f.due === 'overdue' && ctx ? { before: utcDay(ctx.today), open: true } : f.due === 'none' ? { none: true } : f.due && typeof f.due === 'object' ? { ...(f.due.from ? { from: utcDay(f.due.from) } : {}), ...(f.due.to ? { before: utcDay(shiftDayKey(f.due.to, 1)) } : {}) } : undefined;
  const kinds = p.type?.length ? p.type : f.kinds;
  const statuses = p.status?.length ? p.status : f.statuses;
  const projectId = p.projectId ?? f.projectId;
  const done = p.done ?? f.done;
  const personId = p.person ? (p.person === 'me' ? viewerId : p.person) : f.mine ? viewerId : undefined;
  const q = reading ? reading.read.words : p.q;
  const out = {
    q,
    ...(kinds?.length ? { kinds } : {}),
    ...(projectId ? { projectId } : {}),
    ...(statuses?.length ? { taskStatuses: statuses } : {}),
    ...(done !== undefined ? { done } : {}),
    ...(personId ? { personId } : {}),
    // Company days: "to 7 Nov" includes all of 7 Nov; a task's due date by its calendar day (UTC midnight).
    ...(from ? { from: startOf(from), dueFrom: utcDay(from) } : {}),
    ...(to ? { to: startOf(shiftDayKey(to, 1)), dueTo: utcDay(shiftDayKey(to, 1)) } : {}),
    ...(p.archived ? { includeArchived: true } : {}),
    ...(due ? { due } : {}),
    ...(f.priorities?.length ? { priorities: f.priorities } : {}),
    ...(f.approval ? { approval: true } : {}),
    ...(Array.isArray(f.assignee) && f.assignee.length ? { assigneeIds: me(f.assignee) } : {}),
    ...(f.assignee === 'none' ? { unassigned: true } : {}),
    ...(f.creator?.length ? { creatorIds: me(f.creator) } : {}),
    ...(f.organizer?.length ? { organizerIds: me(f.organizer) } : {}),
  };
  const filtered = Object.keys(out).some((k) => k !== 'q' && k !== 'includeArchived');
  return { ...out, ...(parseTaskQuery(q).terms.length === 0 && filtered ? { browse: true } : {}) };
}

/** Search everything's next page: where it starts, and whether it is in the extra passes' list. */
export const encodeAllCursor = (next: { offset: number; extra: boolean }): string => Buffer.from(`${next.extra ? 'x' : 'o'}:${next.offset}`, 'utf8').toString('base64url');
function decodeAllCursor(cursor: string | undefined): { offset: number; extra: boolean } {
  if (!cursor) return { offset: 0, extra: false };
  const m = /^([ox]):(\d{1,7})$/.exec(Buffer.from(cursor, 'base64url').toString('utf8'));
  // At most MAX_ALL_OFFSET deep (review M11): a page further on would make every match be sorted.
  if (!m || Number(m[2]) > MAX_ALL_OFFSET) throw badCursor();
  return { offset: Number(m[2]), extra: m[1] === 'x' };
}
