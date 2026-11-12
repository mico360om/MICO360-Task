import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import { createMemoryIdempotencyStore, registerIdempotency, PENDING_STATUS } from './idempotency';

async function makeApp() {
  const store = createMemoryIdempotencyStore();
  const app = Fastify();
  registerIdempotency(app, { store, userIdOf: (req) => (req.headers['x-user'] as string | undefined) ?? null });
  let created = 0;
  app.post('/items', async (_req, reply) => reply.status(201).send({ data: { id: `item-${++created}` } }));
  app.post('/other', async () => ({ data: 'other' }));
  app.post('/fail', async () => {
    throw new Error('boom');
  });
  app.post('/empty', async (_req, reply) => reply.status(204).send());
  // 1.23.6: an answer carrying a one-time secret (a temporary password made on the server).
  let secrets = 0;
  app.post('/secret', async (_req, reply) => reply.status(201).send({ data: { id: `s-${++secrets}` }, meta: { temporaryPassword: `Kite-Mango-Fern-Ripple-${secrets}` } }));
  return { app, store, count: () => created };
}

const post = (app: Awaited<ReturnType<typeof makeApp>>['app'], url: string, headers: Record<string, string>) =>
  app.inject({ method: 'POST', url, headers, payload: {} });

describe('Idempotency-Key', () => {
  it('runs a keyed request once and replays the stored response on retry', async () => {
    const { app, count } = await makeApp();
    const h = { 'x-user': 'u1', 'idempotency-key': 'k-1' };
    const first = await post(app, '/items', h);
    const retry = await post(app, '/items', h);
    expect(first.statusCode).toBe(201);
    expect(retry.statusCode).toBe(201);
    expect(retry.json()).toEqual(first.json());
    expect(retry.headers['idempotent-replay']).toBe('true');
    expect(count()).toBe(1);
  });

  it('scopes keys per user and ignores requests without a key', async () => {
    const { app, count } = await makeApp();
    await post(app, '/items', { 'x-user': 'u1', 'idempotency-key': 'same' });
    await post(app, '/items', { 'x-user': 'u2', 'idempotency-key': 'same' });
    await post(app, '/items', { 'x-user': 'u1' });
    await post(app, '/items', { 'x-user': 'u1' });
    expect(count()).toBe(4);
  });

  it('rejects a key reused for a different endpoint', async () => {
    const { app } = await makeApp();
    await post(app, '/items', { 'x-user': 'u1', 'idempotency-key': 'k-2' });
    const res = await post(app, '/other', { 'x-user': 'u1', 'idempotency-key': 'k-2' });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('IDEMPOTENCY_KEY_REUSED');
  });

  it('answers 409 while the original request is still in progress', async () => {
    const { app, store } = await makeApp();
    await store.reserve({ userId: 'u1', key: 'busy', method: 'POST', path: '/items' });
    expect((await store.find('u1', 'busy'))?.statusCode).toBe(PENDING_STATUS);
    const res = await post(app, '/items', { 'x-user': 'u1', 'idempotency-key': 'busy' });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('IDEMPOTENCY_IN_PROGRESS');
  });

  it('releases the key after a server error so a later retry can run', async () => {
    const { app, store } = await makeApp();
    const h = { 'x-user': 'u1', 'idempotency-key': 'k-fail' };
    expect((await post(app, '/fail', h)).statusCode).toBe(500);
    expect(await store.find('u1', 'k-fail')).toBeNull();
  });

  it('replays empty 204 responses', async () => {
    const { app } = await makeApp();
    const h = { 'x-user': 'u1', 'idempotency-key': 'k-204' };
    expect((await post(app, '/empty', h)).statusCode).toBe(204);
    const retry = await post(app, '/empty', h);
    expect(retry.statusCode).toBe(204);
    expect(retry.headers['idempotent-replay']).toBe('true');
  });

  it('rejects over-long keys', async () => {
    const { app } = await makeApp();
    const res = await post(app, '/items', { 'x-user': 'u1', 'idempotency-key': 'x'.repeat(200) });
    expect(res.statusCode).toBe(400);
  });

  it('1.23.6: an answer holding a temporary password is never stored (a retry runs again; nothing to replay)', async () => {
    const { app, store } = await makeApp();
    const h = { 'x-user': 'u1', 'idempotency-key': 'k-secret' };
    const first = await post(app, '/secret', h);
    expect(first.statusCode).toBe(201);
    expect(await store.find('u1', 'k-secret')).toBeNull();
    const retry = await post(app, '/secret', h);
    expect(retry.headers['idempotent-replay']).toBeUndefined();
    expect(retry.json().meta.temporaryPassword).not.toBe(first.json().meta.temporaryPassword);
  });
});

// Review fix #27 (13 Nov 2026): a request key must never stay "in progress" for good.
describe('Idempotency-Key — nothing stays stuck', () => {
  async function appWith(store: ReturnType<typeof createMemoryIdempotencyStore>, opts: { now?: () => number; errors?: string[] } = {}) {
    const app = Fastify();
    registerIdempotency(app, {
      store,
      userIdOf: (req) => (req.headers['x-user'] as string | undefined) ?? null,
      ...(opts.now ? { now: opts.now } : {}),
      onError: (_err, what) => void opts.errors?.push(what),
    });
    let created = 0;
    app.post('/items', async (_req, reply) => reply.status(201).send({ data: { id: `item-${++created}` } }));
    return { app, count: () => created };
  }

  it('a key left pending longer than its 10-minute lease (a server that stopped mid-request) is taken over by the retry', async () => {
    let clock = Date.parse('2026-11-13T08:00:00Z');
    const store = createMemoryIdempotencyStore(() => clock);
    const { app, count } = await appWith(store, { now: () => clock });
    await store.reserve({ userId: 'u1', key: 'k-crash', method: 'POST', path: '/items' }); // nothing ever completed it
    const h = { 'x-user': 'u1', 'idempotency-key': 'k-crash' };
    clock += 5 * 60_000;
    expect((await post(app, '/items', h)).statusCode).toBe(409); // still within the lease: maybe still running
    clock += 6 * 60_000;
    const retry = await post(app, '/items', h);
    expect(retry.statusCode).toBe(201);
    expect(count()).toBe(1);
    // …and from then on it replays like any finished request.
    const again = await post(app, '/items', h);
    expect(again.headers['idempotent-replay']).toBe('true');
    expect(count()).toBe(1);
  });

  it('a finished request is never taken over, however old', async () => {
    let clock = Date.parse('2026-11-13T08:00:00Z');
    const store = createMemoryIdempotencyStore(() => clock);
    const { app, count } = await appWith(store, { now: () => clock });
    const h = { 'x-user': 'u1', 'idempotency-key': 'k-done' };
    await post(app, '/items', h);
    clock += 60 * 60_000;
    expect((await post(app, '/items', h)).headers['idempotent-replay']).toBe('true');
    expect(count()).toBe(1);
  });

  it('a store that fails while saving the answer: the saved work still reaches the client (logged), never a 5xx', async () => {
    const mem = createMemoryIdempotencyStore();
    const errors: string[] = [];
    let fail = true;
    const store = {
      ...mem,
      async complete(u: string, k: string, s: number, b: string) {
        if (fail) {
          fail = false;
          throw Object.assign(new Error('Connection lost'), { code: 'P1017' });
        }
        return mem.complete(u, k, s, b);
      },
    };
    const { app, count } = await appWith(store as typeof mem, { errors });
    const res = await post(app, '/items', { 'x-user': 'u1', 'idempotency-key': 'k-blip' });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({ data: { id: 'item-1' } });
    expect(count()).toBe(1);
    expect(errors).toEqual(['saving the answer to a repeated request']);
  });

  it('a store that fails while letting a failed request go: the 5xx answer still goes out (logged)', async () => {
    const mem = createMemoryIdempotencyStore();
    const errors: string[] = [];
    const store = { ...mem, release: async () => { throw new Error('Connection lost'); } };
    const app = Fastify();
    registerIdempotency(app, { store, userIdOf: () => 'u1', onError: (_e, what) => void errors.push(what) });
    app.post('/fail', async () => {
      throw new Error('boom');
    });
    const res = await app.inject({ method: 'POST', url: '/fail', headers: { 'idempotency-key': 'k-x' }, payload: {} });
    expect(res.statusCode).toBe(500);
    expect(errors).toEqual(['releasing a repeated request’s key']);
  });

  it('purgeOlderThan removes old records of every kind (the daily clean-up)', async () => {
    let clock = Date.parse('2026-11-13T08:00:00Z');
    const store = createMemoryIdempotencyStore(() => clock);
    await store.reserve({ userId: 'u1', key: 'old', method: 'POST', path: '/items' });
    clock += 25 * 60 * 60_000;
    await store.reserve({ userId: 'u1', key: 'new', method: 'POST', path: '/items' });
    await store.purgeOlderThan(new Date(clock - 24 * 60 * 60_000));
    expect(await store.find('u1', 'old')).toBeNull();
    expect(await store.find('u1', 'new')).not.toBeNull();
  });
});
