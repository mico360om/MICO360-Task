import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import { PrismaClient } from '@prisma/client';
import { createRequestTiming, registerRequestTiming, requestTimingStorage, serverTimingValue, trackDatabaseTime } from './request-timing';

// 1.23.3 — the Error log's slow requests say where the time went: the server's whole time on a request
// and the part of it spent in the database, sent as a Server-Timing header the website reads.

/** A clock the test moves by hand (milliseconds). */
function manualClock(start = 1000) {
  const c = { t: start, now: () => c.t };
  return c;
}

describe('a request’s timing', () => {
  it('counts the server’s time from the start, and the database’s time while a call is open', () => {
    const clock = manualClock();
    const timing = createRequestTiming(clock.now);
    clock.t += 5;
    const end = timing.dbCall();
    clock.t += 40;
    end();
    clock.t += 10;
    expect(timing.read()).toEqual({ serverMs: 55, dbMs: 40, calls: 1 });
  });

  it('adds up calls one after another', () => {
    const clock = manualClock();
    const timing = createRequestTiming(clock.now);
    for (const ms of [10, 20, 30]) {
      const end = timing.dbCall();
      clock.t += ms;
      end();
      clock.t += 1;
    }
    expect(timing.read()).toMatchObject({ dbMs: 60, calls: 3 });
  });

  it('counts calls running side by side once (the database’s time never passes the server’s)', () => {
    const clock = manualClock();
    const timing = createRequestTiming(clock.now);
    const a = timing.dbCall();
    clock.t += 10;
    const b = timing.dbCall(); // a and b open together: 10 → 30
    clock.t += 20;
    a();
    clock.t += 5;
    b(); // 0 → 35 busy in all
    clock.t += 5;
    const read = timing.read();
    expect(read).toMatchObject({ serverMs: 40, dbMs: 35, calls: 2 });
    expect(read.dbMs).toBeLessThanOrEqual(read.serverMs);
  });

  it('counts a call still open up to now, and an end told twice once', () => {
    const clock = manualClock();
    const timing = createRequestTiming(clock.now);
    const end = timing.dbCall();
    clock.t += 15;
    expect(timing.read().dbMs).toBe(15);
    end();
    end();
    clock.t += 15;
    expect(timing.read()).toMatchObject({ serverMs: 30, dbMs: 15 });
  });

  it('is written as a Server-Timing value: app (the server’s whole time) and db, in ms to a tenth', () => {
    expect(serverTimingValue({ serverMs: 9912.345, dbMs: 9700.06 })).toBe('app;dur=9912.3, db;dur=9700.1');
    expect(serverTimingValue({ serverMs: 0.04, dbMs: 0 })).toBe('app;dur=0, db;dur=0');
  });
});

/** A stand-in for Prisma's client: middleware ($use) and $transaction, like the real one. */
function fakeClient(clock: { t: number }) {
  const middlewares: ((params: unknown, next: (p: unknown) => Promise<unknown>) => Promise<unknown>)[] = [];
  const client = {
    used: 0,
    $use(mw: (params: unknown, next: (p: unknown) => Promise<unknown>) => Promise<unknown>) {
      this.used += 1;
      middlewares.push(mw);
    },
    /** One query of `ms` milliseconds, through the middleware like Prisma's own. */
    query(ms: number): Promise<unknown> {
      const run = (params: unknown) =>
        new Promise((resolve) => {
          clock.t += ms;
          resolve(params);
        });
      const chain = middlewares.reduceRight<(p: unknown) => Promise<unknown>>((next, mw) => (p) => mw(p, next), run);
      return chain({ action: 'findMany' });
    },
    async $transaction(fn: (tx: unknown) => Promise<unknown>) {
      clock.t += 7; // waiting for a connection, BEGIN
      const out = await fn(client);
      clock.t += 3; // COMMIT
      return out;
    },
  };
  return client;
}

describe('trackDatabaseTime: the database client tells the request’s timing', () => {
  it('counts each call made for a request (not those made outside one), and a whole transaction', async () => {
    const clock = manualClock();
    const client = trackDatabaseTime(fakeClient(clock));
    await client.query(50); // no request: nothing to tell
    const timing = createRequestTiming(clock.now);
    await requestTimingStorage.run(timing, async () => {
      await client.query(20);
      clock.t += 5; // the server's own work
      await client.$transaction(async () => client.query(30));
    });
    // 20 + (7 + 30 + 3): the transaction's own wait and commit count, its query inside only once.
    expect(timing.read()).toMatchObject({ serverMs: 65, dbMs: 60 });
  });

  it('a failed call counts too, and the failure is the caller’s as before', async () => {
    const clock = manualClock();
    const client = trackDatabaseTime(fakeClient(clock));
    const timing = createRequestTiming(clock.now);
    await requestTimingStorage.run(timing, async () => {
      await expect(
        client.$transaction(async () => {
          clock.t += 12;
          throw new Error('deadlock');
        }),
      ).rejects.toThrow('deadlock');
    });
    expect(timing.read().dbMs).toBe(19);
  });

  it('is put on a client once', () => {
    const clock = manualClock();
    const client = fakeClient(clock);
    trackDatabaseTime(client);
    trackDatabaseTime(client);
    expect(client.used).toBe(1);
  });

  it('leaves a client without middleware as it is', () => {
    const plain = { $transaction: async () => 1 };
    expect(() => trackDatabaseTime(plain)).not.toThrow();
  });

  // The real Prisma 5 client, pointed at an address that can't be a database: every call fails at once,
  // but goes through the timing first — raw SQL, a model call, both kinds of transaction.
  it('with Prisma’s own client: raw SQL, model calls and transactions are all counted', async () => {
    const prisma = trackDatabaseTime(new PrismaClient({ datasources: { db: { url: 'mysql://u:p@db.invalid:notaport/x' } } }));
    const timing = createRequestTiming();
    await requestTimingStorage.run(timing, async () => {
      await prisma.$queryRaw`SELECT 1`.catch(() => null);
      await prisma.$executeRawUnsafe('SELECT 1').catch(() => null);
      await prisma.user.findFirst().catch(() => null);
      await prisma.$transaction(async (tx) => tx.user.findFirst()).catch(() => null);
      await prisma.$transaction([prisma.user.count()]).catch(() => null);
    });
    // raw ×2, findFirst, the interactive transaction, the batch transaction and its one call.
    expect(timing.read().calls).toBe(6);
    await prisma.$disconnect().catch(() => null);
  });
});

describe('registerRequestTiming: the API’s answers carry Server-Timing', () => {
  async function appWith(clock: { t: number; now: () => number }, client: ReturnType<typeof fakeClient>) {
    const app = Fastify({ logger: false });
    registerRequestTiming(app, { clock: clock.now, uptime: () => 86_400_000.4 });
    app.get('/api/v1/slow', async () => {
      await client.query(40);
      clock.t += 10;
      return { ok: true };
    });
    // A body is read on the socket's own events: the route must still be the request's.
    app.post('/api/v1/save', async (req) => {
      await client.query(25);
      return { got: (req.body as { n: number }).n };
    });
    app.get('/api/v1/boom', async () => {
      await client.query(5);
      throw new Error('broken');
    });
    app.get('/uploads/x.png', async () => 'file');
    await app.ready();
    return app;
  }

  it('says the server’s whole time and the database’s part of it', async () => {
    const clock = manualClock();
    const app = await appWith(clock, trackDatabaseTime(fakeClient(clock)));
    const res = await app.inject({ method: 'GET', url: '/api/v1/slow' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['server-timing']).toBe('app;dur=50, db;dur=40, up;dur=86400000'); // 1.23.14: and the server's uptime
  });

  it('keeps the request’s timing across reading a body', async () => {
    const clock = manualClock();
    const app = await appWith(clock, trackDatabaseTime(fakeClient(clock)));
    const res = await app.inject({ method: 'POST', url: '/api/v1/save', payload: { n: 7 } });
    expect(res.json()).toEqual({ got: 7 });
    expect(res.headers['server-timing']).toBe('app;dur=25, db;dur=25, up;dur=86400000');
  });

  it('a failed request says it too', async () => {
    const clock = manualClock();
    const app = await appWith(clock, trackDatabaseTime(fakeClient(clock)));
    const res = await app.inject({ method: 'GET', url: '/api/v1/boom' });
    expect(res.statusCode).toBe(500);
    expect(res.headers['server-timing']).toBe('app;dur=5, db;dur=5, up;dur=86400000');
  });

  it('only for the API (not uploaded files)', async () => {
    const clock = manualClock();
    const app = await appWith(clock, trackDatabaseTime(fakeClient(clock)));
    const res = await app.inject({ method: 'GET', url: '/uploads/x.png' });
    expect(res.headers['server-timing']).toBeUndefined();
  });

  it('two requests at once each keep their own', async () => {
    const clock = manualClock();
    const client = trackDatabaseTime(fakeClient(clock));
    const app = Fastify({ logger: false });
    registerRequestTiming(app, { clock: clock.now });
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    app.get('/api/v1/a', async () => {
      await gate;
      await client.query(30);
      return {};
    });
    app.get('/api/v1/b', async () => {
      await client.query(10);
      release();
      return {};
    });
    await app.ready();
    const [a, b] = await Promise.all([app.inject({ url: '/api/v1/a' }), app.inject({ url: '/api/v1/b' })]);
    expect(String(b.headers['server-timing'])).toMatch(/db;dur=10, up;dur=\d+$/);
    expect(String(a.headers['server-timing'])).toMatch(/db;dur=30, up;dur=\d+$/);
  });
});

// 1.23.14 — the answering server's uptime (up;dur=…, ms) lets the page tell a request held up while the
// server started (an update restart: the server started after the request was sent) from a slow one.
describe('registerRequestTiming: the server’s uptime (1.23.14)', () => {
  it('by default the process’s own uptime, in whole ms', async () => {
    const app = Fastify({ logger: false });
    registerRequestTiming(app);
    app.get('/api/v1/x', async () => ({}));
    await app.ready();
    const res = await app.inject({ method: 'GET', url: '/api/v1/x' });
    const up = /up;dur=(\d+)$/.exec(String(res.headers['server-timing']))?.[1];
    expect(Number(up)).toBeGreaterThan(0);
    expect(Number(up)).toBeLessThanOrEqual(process.uptime() * 1000 + 1);
  });
});
