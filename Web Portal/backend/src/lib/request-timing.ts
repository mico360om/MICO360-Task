import { AsyncLocalStorage } from 'node:async_hooks';
import { performance } from 'node:perf_hooks';
import type { FastifyInstance, FastifyRequest } from 'fastify';

/**
 * 1.23.3 — where a request's time went (the Error log's slow requests). Each API request measures the
 * server's whole time on it and the part spent in the database — every database call made for it,
 * waiting for a connection plus running — and says both in its answer as a Server-Timing header
 * (`app;dur=9912.3, db;dur=9700.1`, milliseconds), which the website sends with a slow-request report.
 *
 * The database's time is the time at least one of the request's calls was open: calls running side
 * by side (Promise.all) count once, so it never passes the server's time. A call the request started
 * but didn't wait for (work left running in the background) counts while it is open.
 */
export function createRequestTiming(clock: () => number = () => performance.now()) {
  const startedAt = clock();
  let open = 0;
  let busySince = 0;
  let dbMs = 0;
  let calls = 0;
  return {
    /** A database call began: returns what to call when it ends (counted once, however often it is called). */
    dbCall(): () => void {
      calls += 1;
      if (open++ === 0) busySince = clock();
      let ended = false;
      return () => {
        if (ended) return;
        ended = true;
        if (--open === 0) dbMs += clock() - busySince;
      };
    },
    /** The server's time so far, and the database's part of it (a call still open counted up to now). */
    read(): { serverMs: number; dbMs: number; calls: number } {
      const now = clock();
      return { serverMs: now - startedAt, dbMs: dbMs + (open > 0 ? now - busySince : 0), calls };
    },
  };
}

export type RequestTiming = ReturnType<typeof createRequestTiming>;

/** The request being answered (none in background jobs, start-up or scripts: nothing is measured then). */
export const requestTimingStorage = new AsyncLocalStorage<RequestTiming>();

const tenth = (ms: number) => Math.round(Math.max(0, ms) * 10) / 10;

/** The Server-Timing value: `app` is the server's whole time, `db` its time in the database (ms). */
export function serverTimingValue(t: { serverMs: number; dbMs: number }): string {
  return `app;dur=${tenth(t.serverMs)}, db;dur=${tenth(t.dbMs)}`;
}

type Next = (params: unknown) => Promise<unknown>;
/** What is needed of Prisma's client (its middleware, and $transaction). */
interface Trackable {
  $use?: (middleware: (params: unknown, next: Next) => Promise<unknown>) => void;
  $transaction?: (...args: unknown[]) => unknown;
}
const TRACKED = Symbol.for('mico360.requestTiming');

/**
 * Makes a Prisma client tell the current request's timing about each database call: a middleware
 * ($use — Prisma 5; every model call, raw SQL and the calls inside a transaction go through it) and
 * $transaction itself, whose own wait for a connection, BEGIN and COMMIT no middleware sees. The client
 * keeps its type and behaviour; outside a request nothing is measured. Put on a client once.
 */
export function trackDatabaseTime<C extends object>(client: C): C {
  const c = client as unknown as Trackable & { [TRACKED]?: true };
  if (c[TRACKED] || typeof c.$use !== 'function') return client;
  // $use is deprecated (Prisma 4.16) but kept in 5.x; client extensions would change the client's type.
  c.$use(async (params, next) => {
    const end = requestTimingStorage.getStore()?.dbCall();
    try {
      return await next(params);
    } finally {
      end?.();
    }
  });
  const transaction = c.$transaction;
  if (typeof transaction === 'function') {
    c.$transaction = function timedTransaction(this: unknown, ...args: unknown[]) {
      const end = requestTimingStorage.getStore()?.dbCall();
      if (!end) return transaction.apply(this, args);
      try {
        return Promise.resolve(transaction.apply(this, args)).finally(end);
      } catch (err) {
        end();
        throw err;
      }
    };
  }
  c[TRACKED] = true;
  return client;
}

const timings = new WeakMap<FastifyRequest, RequestTiming>();
const isApi = (url: string) => url.startsWith('/api/');

/**
 * Each API request is timed from its arrival, and its answer says so (Server-Timing). The request's
 * timing is the current one for everything it runs (AsyncLocalStorage). A body is read on the socket's
 * own events: Node 24 with Fastify 5 keeps the request's context across that, and should another Node
 * not, the request is entered again before its route runs (preValidation — nothing to do otherwise).
 */
export function registerRequestTiming(app: FastifyInstance, opts: { clock?: () => number } = {}): void {
  app.addHook('onRequest', (req, _reply, done) => {
    if (!isApi(req.url)) return done();
    const timing = createRequestTiming(opts.clock);
    timings.set(req, timing);
    requestTimingStorage.run(timing, () => done());
  });
  app.addHook('preValidation', (req, _reply, done) => {
    const timing = timings.get(req);
    if (!timing || requestTimingStorage.getStore() === timing) return done();
    requestTimingStorage.run(timing, () => done());
  });
  app.addHook('onSend', (req, reply, payload, done) => {
    const timing = timings.get(req);
    if (timing) reply.header('Server-Timing', serverTimingValue(timing.read()));
    done(null, payload);
  });
}
