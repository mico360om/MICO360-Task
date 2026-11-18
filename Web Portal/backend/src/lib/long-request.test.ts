import { describe, it, expect, vi, afterEach } from 'vitest';
import Fastify from 'fastify';
import { LONG_REQUEST_MS, registerLongRequestWarning } from './long-request';
import { IDEMPOTENCY_LEASE_MS } from './idempotency';

// 1.24.0 (sb1 M2, sb4b #19): a pending repeat-request key and a note's task claim are taken over after
// 10 minutes. A request still running then is written once to the Error log (never stopped), as job-gate
// does for a background run that goes on far too long.
afterEach(() => vi.useRealTimers());

function appWith(handlerWait: Promise<void>) {
  const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const app = Fastify({ logger: false });
  registerLongRequestWarning(app, { logger });
  app.post('/api/tasks/:id/convert', async () => {
    await handlerWait;
    return { ok: true };
  });
  app.get('/api/quick', async () => ({ ok: true }));
  return { app, logger };
}

describe('long-request warning', () => {
  it('is the same time as the repeat-request lease', () => {
    expect(LONG_REQUEST_MS).toBe(IDEMPOTENCY_LEASE_MS);
  });

  it('a request still running after 10 minutes is written once to the Error log, with its route, and left running', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    let finish!: () => void;
    const { app, logger } = appWith(new Promise<void>((r) => (finish = r)));
    await app.ready();
    const answer = app.inject({ method: 'POST', url: '/api/tasks/t1/convert?token=secret' });
    await vi.advanceTimersByTimeAsync(LONG_REQUEST_MS - 1000);
    expect(logger.error).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2000);
    expect(logger.error).toHaveBeenCalledTimes(1);
    const [message, ctx] = logger.error.mock.calls[0]!;
    expect(message).toMatch(/still running after 10 minutes/);
    expect(ctx).toMatchObject({ method: 'POST', route: '/api/tasks/:id/convert', url: '/api/tasks/t1/convert' });
    await vi.advanceTimersByTimeAsync(LONG_REQUEST_MS * 2);
    expect(logger.error).toHaveBeenCalledTimes(1);
    finish();
    expect((await answer).statusCode).toBe(200);
    await app.close();
  });

  it('a request answered in time writes nothing, and leaves no timer behind', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { app, logger } = appWith(Promise.resolve());
    await app.ready();
    expect((await app.inject({ method: 'GET', url: '/api/quick' })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: '/api/tasks/t1/convert' })).statusCode).toBe(200);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(LONG_REQUEST_MS * 2);
    expect(logger.error).not.toHaveBeenCalled();
    await app.close();
  });
});

describe('long-request warning in the server', () => {
  it('buildApp registers it with the server’s logger (the Error log)', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const app = readFileSync(join(__dirname, '../app.ts'), 'utf8');
    expect(app).toMatch(/registerLongRequestWarning\(app, \{ logger: deps\.logger \}\)/);
  });
});
