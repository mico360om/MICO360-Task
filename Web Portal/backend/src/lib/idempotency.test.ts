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
});
