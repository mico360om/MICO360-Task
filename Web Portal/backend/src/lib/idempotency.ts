import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { PrismaClient } from '@prisma/client';

/**
 * Idempotent POSTs for clients that retry (offline queues, flaky mobile networks).
 *
 * A client sends a unique `Idempotency-Key` header. The first request reserves the key per user
 * before the handler runs, and its response is stored when it completes. A retry with the same
 * key gets the stored response (marked `Idempotent-Replay: true`) instead of creating a duplicate;
 * a retry that arrives while the first is still running gets 409; server errors release the key
 * so a later retry can run again.
 */

export interface IdempotencyRecord {
  userId: string;
  key: string;
  method: string;
  path: string;
  /** 0 while the original request is still running. */
  statusCode: number;
  responseBody: string;
}

export interface IdempotencyStore {
  find(userId: string, key: string): Promise<IdempotencyRecord | null>;
  /** Reserve a key for a new request. Resolves false if the key already exists. */
  reserve(rec: { userId: string; key: string; method: string; path: string }): Promise<boolean>;
  complete(userId: string, key: string, statusCode: number, responseBody: string): Promise<void>;
  release(userId: string, key: string): Promise<void>;
  purgeOlderThan(cutoff: Date): Promise<void>;
}

export const PENDING_STATUS = 0;
/** How long a stored response stays replayable. */
export const IDEMPOTENCY_RETENTION_MS = 24 * 60 * 60 * 1000;
const MAX_KEY_LENGTH = 128;

declare module 'fastify' {
  interface FastifyRequest {
    idempotency?: { userId: string; key: string } | null;
  }
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 'P2002';
}

export function createPrismaIdempotencyStore(prisma: PrismaClient): IdempotencyStore {
  return {
    async find(userId, key) {
      const row = await prisma.idempotencyKey.findUnique({ where: { userId_key: { userId, key } } });
      return row ? { userId: row.userId, key: row.key, method: row.method, path: row.path, statusCode: row.statusCode, responseBody: row.responseBody } : null;
    },
    async reserve(rec) {
      try {
        await prisma.idempotencyKey.create({ data: { ...rec, path: rec.path.slice(0, 191), statusCode: PENDING_STATUS, responseBody: '' } });
      } catch (err) {
        if (isUniqueViolation(err)) return false;
        throw err;
      }
      // Opportunistic cleanup keeps the table small without a dedicated job.
      if (Math.random() < 0.02) {
        await prisma.idempotencyKey.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - IDEMPOTENCY_RETENTION_MS) } } });
      }
      return true;
    },
    async complete(userId, key, statusCode, responseBody) {
      await prisma.idempotencyKey.updateMany({ where: { userId, key }, data: { statusCode, responseBody } });
    },
    async release(userId, key) {
      await prisma.idempotencyKey.deleteMany({ where: { userId, key, statusCode: PENDING_STATUS } });
    },
    async purgeOlderThan(cutoff) {
      await prisma.idempotencyKey.deleteMany({ where: { createdAt: { lt: cutoff } } });
    },
  };
}

/** In-memory store for tests and single-process development. */
export function createMemoryIdempotencyStore(): IdempotencyStore & { size(): number } {
  const rows = new Map<string, IdempotencyRecord & { createdAt: number }>();
  const id = (userId: string, key: string) => `${userId}\u0000${key}`;
  return {
    async find(userId, key) {
      const row = rows.get(id(userId, key));
      return row ? { ...row } : null;
    },
    async reserve(rec) {
      if (rows.has(id(rec.userId, rec.key))) return false;
      rows.set(id(rec.userId, rec.key), { ...rec, statusCode: PENDING_STATUS, responseBody: '', createdAt: Date.now() });
      return true;
    },
    async complete(userId, key, statusCode, responseBody) {
      const row = rows.get(id(userId, key));
      if (row) Object.assign(row, { statusCode, responseBody });
    },
    async release(userId, key) {
      const row = rows.get(id(userId, key));
      if (row && row.statusCode === PENDING_STATUS) rows.delete(id(userId, key));
    },
    async purgeOlderThan(cutoff) {
      for (const [k, row] of rows) if (row.createdAt < cutoff.getTime()) rows.delete(k);
    },
    size: () => rows.size,
  };
}

export interface IdempotencyOptions {
  store: IdempotencyStore;
  /** The verified user id of the request, or null when unauthenticated. */
  userIdOf: (req: FastifyRequest) => string | null;
}

/** Register the Idempotency-Key hooks on an app (applies to every POST route). */
export function registerIdempotency(app: FastifyInstance, { store, userIdOf }: IdempotencyOptions): void {
  app.decorateRequest('idempotency', null);

  app.addHook('preHandler', async (req, reply) => {
    if (req.method !== 'POST') return;
    const raw = req.headers['idempotency-key'];
    const key = typeof raw === 'string' ? raw.trim() : '';
    if (!key) return;
    if (key.length > MAX_KEY_LENGTH) {
      return reply.status(400).send({ error: { code: 'VALIDATION', message: 'Idempotency-Key must be at most 128 characters.' } });
    }
    const userId = userIdOf(req);
    if (!userId) return; // the route's own auth check rejects the request
    const path = req.url.split('?')[0] ?? req.url;

    for (let attempt = 0; attempt < 2; attempt++) {
      const existing = await store.find(userId, key);
      if (existing) {
        if (existing.method !== req.method || existing.path !== path.slice(0, 191)) {
          return reply.status(422).send({
            error: { code: 'IDEMPOTENCY_KEY_REUSED', message: 'This Idempotency-Key was already used for a different request.' },
          });
        }
        if (existing.statusCode === PENDING_STATUS) {
          return reply.status(409).send({
            error: { code: 'IDEMPOTENCY_IN_PROGRESS', message: 'The original request is still being processed. Retry shortly.' },
          });
        }
        reply.header('idempotent-replay', 'true');
        if (existing.statusCode === 204 || existing.responseBody === '') return reply.status(existing.statusCode).send();
        return reply.status(existing.statusCode).type('application/json; charset=utf-8').send(existing.responseBody);
      }
      if (await store.reserve({ userId, key, method: req.method, path })) {
        req.idempotency = { userId, key };
        return;
      }
      // Lost a race with a concurrent request using the same key: look again.
    }
  });

  app.addHook('onSend', async (req, reply, payload) => {
    const idem = req.idempotency;
    if (!idem) return payload;
    req.idempotency = null;
    const status = reply.statusCode;
    const contentType = String(reply.getHeader('content-type') ?? '');
    if (status >= 500) {
      await store.release(idem.userId, idem.key);
    } else if (payload === undefined || payload === null || payload === '') {
      await store.complete(idem.userId, idem.key, status, '');
    } else if (typeof payload === 'string' && contentType.includes('json')) {
      await store.complete(idem.userId, idem.key, status, payload);
    } else {
      // Streams / non-JSON bodies aren't stored; let a retry run the request again.
      await store.release(idem.userId, idem.key);
    }
    return payload;
  });

  // Safety net: a request that ended without onSend (aborted connection) must not keep its key reserved.
  app.addHook('onResponse', async (req) => {
    const idem = req.idempotency;
    if (!idem) return;
    req.idempotency = null;
    await store.release(idem.userId, idem.key);
  });
}
