import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * 1.23.29 — saving the same thing twice at once (a double click, two people together) just works.
 *
 * The live database (MariaDB 11.8 with innodb_snapshot_isolation ON) refuses a write to a row that another
 * request changed after this one's transaction first read (error 1020 "Record has changed since last read").
 * Prisma's own update()/upsert()/delete() run BEGIN, SELECT, UPDATE, so two saves of one row at the same moment
 * made one of them a 500. Deadlocks (1213, Prisma's P2034) are the same kind of "try again" answer. The server's
 * client (lib/prisma.ts) gets this layer:
 *
 * - A call outside a transaction that hits a save conflict is tried again as a whole: 3 tries in all, after a
 *   short random pause that grows (15–30 ms, then 30–60 ms). A retry waits its turn behind other retries of the
 *   same table (one at a time, in this process): a burst of the same save then queues instead of colliding
 *   again. A first try never waits.
 * - `$transaction(async (tx) => …)` and `$transaction([…])` are tried again WHOLE on a save conflict (Prisma has
 *   rolled the try back), with the same limits; one retried transaction at a time. A statement inside a
 *   transaction is never retried on its own — the transaction is the unit.
 * - Anything started inside a try the layer runs (or inside `withoutSaveRetry`) is not retried by the layer
 *   again: an outer retry owns it, so retries never multiply (and a nested transaction never waits for a turn
 *   its own outer try holds).
 * - Only save conflicts are retried (`saveConflict`): 1020, 1213, P2034 — read from the error's shape, never from
 *   its words (a validation error quotes the saved values). Plus one narrow case: an upsert that lost its
 *   insert race (P2002 — Prisma's upsert is read-then-insert on MySQL/MariaDB): its next try finds the row and
 *   updates it. Everything else (a unique clash on create, not found, validation…) is thrown at once, as before.
 * - No isolation level is ever set (the live binary log refuses READ COMMITTED writes: error 1665).
 * - One quiet line per conflicted save: model, operation, tries, the conflict and the outcome — never the
 *   query's values. A save that still fails after its last try throws the database's own error, as before
 *   (it reaches the Error log through the request's usual path); a retry that saved leaves no Error-log row.
 */

export type SaveConflict = '1020' | '1213' | 'P2034';

/** Tries in all, for one call or one transaction. */
export const SAVE_ATTEMPTS = 3;

/** The engine's own server error inside an unknown request error, as Prisma 5.22 prints it on MySQL 8 and MariaDB. */
const SERVER_ERROR = /\b(?:Mysql|Server)Error \{ code: (\d+),/;
const CONFLICT_CODES = new Set(['1020', '1213']);

/** A save conflict worth trying again, by the error's shape; null for anything else. */
export function saveConflict(err: unknown): SaveConflict | null {
  if (!err || typeof err !== 'object') return null;
  const e = err as { name?: unknown; code?: unknown; meta?: unknown; message?: unknown };
  if (e.code === 'P2034') return 'P2034';
  if (e.code === 'P2010') {
    // Raw SQL ($executeRaw / $queryRaw): the server's code is in meta.
    const code = e.meta && typeof e.meta === 'object' ? String((e.meta as { code?: unknown }).code ?? '') : '';
    return CONFLICT_CODES.has(code) ? (code as SaveConflict) : null;
  }
  if (e.code !== undefined) return null; // any other known error (P2002, P2025…) is what it says
  if (e.name !== 'PrismaClientUnknownRequestError') return null; // validation and plain errors never
  const m = typeof e.message === 'string' ? SERVER_ERROR.exec(e.message) : null;
  return m && CONFLICT_CODES.has(m[1]!) ? (m[1] as SaveConflict) : null;
}

const isUniqueClash = (err: unknown) => !!err && typeof err === 'object' && (err as { code?: unknown }).code === 'P2002';

/** The pause before try `attempt + 1` (ms): 15–30 after the first try, 30–60 after the second. */
export function savePauseMs(attempt: number, random: () => number = Math.random): number {
  const base = 15 * attempt;
  return base + Math.floor(random() * base);
}

interface Scope {
  /** Why nothing in here is retried by the layer: an outer try owns it, or the code opted out. */
  why: 'outer try' | 'opted out';
}
const scope = new AsyncLocalStorage<Scope>();

/**
 * The named opt-out: nothing started inside `work` is retried by the layer — a transaction whose work does
 * something a re-run would repeat (files, streams, statements that commit on their own), or code that keeps its
 * own retry loop (its tries stay its own: never 4 × 3).
 */
export function withoutSaveRetry<T>(work: () => T): T {
  return scope.run({ why: 'opted out' }, work);
}

/** Retries wait their turn, one at a time per lane (a table, or transactions), in this process. */
function createLanes() {
  const tails = new Map<string, Promise<void>>();
  return async function inLane<T>(lane: string, work: () => Promise<T>): Promise<T> {
    const before = tails.get(lane) ?? Promise.resolve();
    let release!: () => void;
    const mine = new Promise<void>((r) => (release = r));
    const tail = before.then(() => mine);
    tails.set(lane, tail);
    await before;
    try {
      return await work();
    } finally {
      release();
      if (tails.get(lane) === tail) tails.delete(lane);
    }
  };
}

export interface SaveRetryLogger {
  info(message: string, ctx?: Record<string, unknown>): void;
  warn(message: string, ctx?: Record<string, unknown>): void;
}

export interface SaveRetryOptions {
  /** Where the one line per conflicted save goes (info when it saved, warn when it still failed). */
  logger?: SaveRetryLogger;
  /** Waits (injectable for tests). */
  pause?: (ms: number) => Promise<void>;
  random?: () => number;
}

type Next = (params: MiddlewareParams) => Promise<unknown>;
interface MiddlewareParams {
  model?: string;
  action: string;
  runInTransaction: boolean;
}
/** What is needed of Prisma's client: its middleware and $transaction (Prisma 5.x). */
interface Retryable {
  $use?: (middleware: (params: MiddlewareParams, next: Next) => Promise<unknown>) => void;
  $transaction?: (...args: unknown[]) => unknown;
}
const INSTALLED = Symbol.for('mico360.saveRetries');

/**
 * Puts the save retry layer on a Prisma client (once; the client keeps its type). It must be the LAST
 * middleware: Prisma's `next` runs the query again only past the last one, so a later $use is refused.
 */
export function withSaveRetries<C extends object>(client: C, opts: SaveRetryOptions = {}): C {
  const c = client as unknown as Retryable & { [INSTALLED]?: true };
  if (c[INSTALLED] || typeof c.$use !== 'function') return client;
  const pause = opts.pause ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const random = opts.random ?? Math.random;
  const logger = opts.logger;
  const inLane = createLanes();

  /** One unit (a call or a transaction), tried up to SAVE_ATTEMPTS times; `retryUnique`: an upsert's lost insert race. */
  async function tried<T>(what: { model?: string; operation: string }, lane: string, run: () => Promise<T>, retryUnique = false): Promise<T> {
    let conflict: SaveConflict | 'P2002' | null = null;
    for (let attempt = 1; ; attempt++) {
      try {
        const out = attempt === 1 ? await run() : await inLane(lane, run);
        if (conflict) logger?.info('save conflict', { ...(what.model ? { model: what.model } : {}), operation: what.operation, attempts: attempt, conflict, outcome: 'saved' });
        return out;
      } catch (err) {
        const now = saveConflict(err) ?? (retryUnique && isUniqueClash(err) ? 'P2002' : null);
        if (now && attempt < SAVE_ATTEMPTS) {
          conflict = now;
          await pause(savePauseMs(attempt, random));
          continue;
        }
        if (conflict) logger?.warn('save conflict', { ...(what.model ? { model: what.model } : {}), operation: what.operation, attempts: attempt, conflict, outcome: 'failed' });
        throw err;
      }
    }
  }

  c.$use((params, next) => {
    // Inside a transaction the transaction is the unit; inside a try the layer runs (or an opt-out), the
    // outer one decides.
    if (params.runInTransaction || scope.getStore()) return next(params);
    const model = params.model;
    return tried({ model, operation: params.action }, `model:${model ?? params.action}`, () => next(params), params.action === 'upsert');
  });
  c.$use = () => {
    throw new Error('Add Prisma middlewares before withSaveRetries: a retry runs the query again only past the last middleware.');
  };

  const transaction = c.$transaction;
  if (typeof transaction === 'function') {
    c.$transaction = function retriedTransaction(this: unknown, ...args: unknown[]) {
      if (scope.getStore()) return transaction.apply(this, args);
      const operation = Array.isArray(args[0]) ? 'batch transaction' : 'transaction';
      // Each try runs inside the layer's own scope: what it starts is not retried again on its own.
      return tried({ operation }, '$transaction', () => scope.run({ why: 'outer try' }, () => Promise.resolve(transaction.apply(this, args))));
    };
  }
  c[INSTALLED] = true;
  return client;
}
