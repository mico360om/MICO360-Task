import { describe, it, expect, beforeEach } from 'vitest';
import { createErrorReporter, MAX_BODY_CHARS, type ReporterWorld } from './error-reporter';

interface Sent {
  body: { reports: Record<string, unknown>[] };
  hidden: boolean;
}

/** A page world with a hand-turned clock and timers. */
function fakeWorld(over: Partial<ReporterWorld> = {}) {
  let t = 1_000_000;
  const timers: { at: number; fn: () => void; id: number }[] = [];
  let seq = 0;
  const sent: Sent[] = [];
  let answer: { delivered: boolean; stop: boolean } = { delivered: true, stop: false };
  let online = true;
  let page = '/board';
  let collecting: boolean | Error = true;
  let configAsked = 0;
  const world: ReporterWorld = {
    now: () => t,
    setTimeout: (fn, ms) => {
      const id = ++seq;
      timers.push({ at: t + ms, fn, id });
      return id;
    },
    clearTimeout: (id) => {
      const i = timers.findIndex((x) => x.id === id);
      if (i >= 0) timers.splice(i, 1);
    },
    online: () => online,
    page: () => page,
    windowSize: () => '1440x900',
    version: '1.22.4',
    send: async (body, hidden) => {
      sent.push({ body: JSON.parse(body) as Sent['body'], hidden });
      return answer;
    },
    collecting: async () => {
      configAsked += 1;
      if (collecting instanceof Error) throw collecting;
      return collecting;
    },
    ...over,
  };
  /** Move the clock on, running each timer due on the way (and letting its promises settle). */
  async function advance(ms: number) {
    const end = t + ms;
    for (;;) {
      timers.sort((a, b) => a.at - b.at);
      const next = timers[0];
      if (!next || next.at > end) break;
      timers.shift();
      t = next.at;
      next.fn();
      for (let i = 0; i < 10; i++) await Promise.resolve();
    }
    t = end;
    for (let i = 0; i < 10; i++) await Promise.resolve();
  }
  return {
    world,
    sent,
    advance,
    set answer(a: { delivered: boolean; stop: boolean }) {
      answer = a;
    },
    set online(v: boolean) {
      online = v;
    },
    set page(v: string) {
      page = v;
    },
    set collecting(v: boolean | Error) {
      collecting = v;
    },
    get configAsked() {
      return configAsked;
    },
  };
}

const boom = { kind: 'ERROR' as const, detail: 'error', message: 'TypeError: x is undefined', stack: 'TypeError: x is undefined\n    at q (https://h/assets/a-Ab12Cd34.js:1:2)' };

let w: ReturnType<typeof fakeWorld>;
beforeEach(() => {
  w = fakeWorld();
});

describe('the error reporter', () => {
  it('sends a small batch after 10 seconds: the page as a pattern, the version and the window size', async () => {
    w.page = '/client/abcdefghijkl?code=1';
    const r = createErrorReporter(w.world);
    r.report({ ...boom, message: 'failed for x@y.com at /reset?token=s3cret' });
    await w.advance(9_000);
    expect(w.sent).toHaveLength(0);
    await w.advance(1_000);
    expect(w.sent).toHaveLength(1);
    expect(w.sent[0]!.body.reports[0]).toEqual({
      kind: 'ERROR',
      detail: 'error',
      message: 'failed for [email] at /reset',
      stack: boom.stack,
      page: '/client/:token',
      count: 1,
      version: '1.22.4',
      screen: '1440x900',
    });
    expect(w.sent[0]!.hidden).toBe(false);
  });

  it('the same report in one page load is sent once, with a count', async () => {
    const r = createErrorReporter(w.world);
    for (let i = 0; i < 7; i++) r.report(boom);
    await w.advance(10_000);
    expect(w.sent[0]!.body.reports).toHaveLength(1);
    expect(w.sent[0]!.body.reports[0]!.count).toBe(7);
    r.report(boom);
    await w.advance(60_000);
    expect(w.sent).toHaveLength(1);
  });

  it('at most 20 reports a page load', async () => {
    const r = createErrorReporter(w.world);
    for (let i = 0; i < 30; i++) r.report({ ...boom, message: `Error number ${'abcdefghijklmnopqrstuvwxyzABCD'[i]}` });
    await w.advance(10_000);
    await w.advance(120_000);
    expect(w.sent.flatMap((s) => s.body.reports)).toHaveLength(20);
  });

  it('nothing is reported while the device is offline', async () => {
    w.online = false;
    const r = createErrorReporter(w.world);
    r.report(boom);
    r.report({ kind: 'NETWORK', detail: 'api', resource: 'GET /api/v1/tasks' });
    await w.advance(30_000);
    expect(w.sent).toHaveLength(0);
  });

  it('a failed send is dropped, never tried again in a loop', async () => {
    w.answer = { delivered: false, stop: false };
    const r = createErrorReporter(w.world);
    r.report(boom);
    await w.advance(10_000);
    await w.advance(10 * 60_000);
    expect(w.sent).toHaveLength(1);
  });

  it('a network problem waits in the page for a later send that gets through (at most one try a minute, ten tries)', async () => {
    w.answer = { delivered: false, stop: false };
    const r = createErrorReporter(w.world);
    r.report({ kind: 'NETWORK', detail: 'api', resource: 'GET /api/v1/tasks/clx9z8y7w0000abcd1234efgh?x=1' });
    await w.advance(10_000);
    expect(w.sent).toHaveLength(1);
    await w.advance(59_000);
    expect(w.sent).toHaveLength(1);
    await w.advance(1_000);
    expect(w.sent).toHaveLength(2);
    w.answer = { delivered: true, stop: false };
    await w.advance(60_000);
    expect(w.sent).toHaveLength(3);
    expect(w.sent[2]!.body.reports[0]).toMatchObject({ kind: 'NETWORK', detail: 'api', resource: 'GET /api/v1/tasks/:id' });
    await w.advance(10 * 60_000);
    expect(w.sent).toHaveLength(3);

    const v = fakeWorld();
    v.answer = { delivered: false, stop: false };
    const r2 = createErrorReporter(v.world);
    r2.report({ kind: 'NETWORK', detail: 'socket' });
    await v.advance(60 * 60_000);
    expect(v.sent).toHaveLength(10);
  });

  it('network problems: once per kind a page load, and at most one a minute', async () => {
    const r = createErrorReporter(w.world);
    r.report({ kind: 'NETWORK', detail: 'api', resource: 'GET /api/v1/a' });
    r.report({ kind: 'NETWORK', detail: 'api', resource: 'POST /api/v1/b' });
    r.report({ kind: 'NETWORK', detail: 'socket' });
    await w.advance(10_000);
    expect(w.sent.flatMap((s) => s.body.reports).map((x) => x.detail)).toEqual(['api']);
    await w.advance(60_000);
    r.report({ kind: 'NETWORK', detail: 'socket' });
    r.report({ kind: 'NETWORK', detail: 'api', resource: 'GET /api/v1/c' });
    await w.advance(10_000);
    expect(w.sent.flatMap((s) => s.body.reports).map((x) => x.detail)).toEqual(['api', 'socket']);
  });

  it('when the page is hidden, what is waiting goes at once (fetch keepalive), without asking the settings first', async () => {
    const r = createErrorReporter(w.world);
    r.report(boom);
    await r.flush({ hidden: true });
    expect(w.sent).toHaveLength(1);
    expect(w.sent[0]!.hidden).toBe(true);
    expect(w.configAsked).toBe(0);
  });

  it('“Collect browser errors” off: nothing is sent, and the page stops collecting', async () => {
    w.collecting = false;
    const r = createErrorReporter(w.world);
    r.report(boom);
    await w.advance(10_000);
    expect(w.sent).toHaveLength(0);
    r.report({ ...boom, message: 'another' });
    await r.flush({ hidden: true });
    expect(w.sent).toHaveLength(0);
    expect(w.configAsked).toBe(1);
  });

  it('the server saying “off” stops it too; the settings can’t be read: it sends (the server decides)', async () => {
    w.answer = { delivered: true, stop: true };
    const r = createErrorReporter(w.world);
    r.report(boom);
    await w.advance(10_000);
    r.report({ ...boom, message: 'later' });
    await w.advance(60_000);
    expect(w.sent).toHaveLength(1);

    const v = fakeWorld();
    v.collecting = new Error('offline config');
    const r2 = createErrorReporter(v.world);
    r2.report(boom);
    await v.advance(10_000);
    expect(v.sent).toHaveLength(1);
  });

  it('never throws, whatever the page or the network does', async () => {
    const bad = fakeWorld({
      page: () => {
        throw new Error('no location');
      },
      send: () => {
        throw new Error('fetch missing');
      },
    });
    const r = createErrorReporter(bad.world);
    expect(() => r.report(boom)).not.toThrow();
    expect(() => r.report(null as never)).not.toThrow();
    expect(() => r.report({ kind: 'ERROR', detail: 'error', message: { toString: () => { throw new Error('x'); } } as never })).not.toThrow();
    await expect(bad.advance(10_000)).resolves.toBeUndefined();
    await expect(r.flush({ hidden: true })).resolves.toBeUndefined();
  });

  it('a batch is never bigger than the server takes', async () => {
    const r = createErrorReporter(w.world);
    for (let i = 0; i < 20; i++) r.report({ ...boom, message: `Error ${'abcdefghijklmnopqrst'[i]}`, stack: `${'s'.repeat(4000)}${i}` });
    await w.advance(10_000);
    await w.advance(5 * 60_000);
    for (const s of w.sent) expect(JSON.stringify(s.body).length).toBeLessThanOrEqual(MAX_BODY_CHARS);
    expect(w.sent.flatMap((s) => s.body.reports).length).toBe(20);
  });

  it('browser extensions and ResizeObserver notices are not the site’s', async () => {
    const r = createErrorReporter(w.world);
    r.report({ ...boom, stack: 'Error\n    at x (chrome-extension://abc/content.js:1:1)' });
    r.report({ ...boom, message: 'ResizeObserver loop completed with undelivered notifications.' });
    r.report({ kind: 'BLOCKED', detail: 'csp', directive: 'script-src-elem', resource: 'moz-extension://x/y.js' });
    await w.advance(10_000);
    expect(w.sent).toHaveLength(0);
  });

  it('slow pages: one report per page and kind, with its number', async () => {
    const r = createErrorReporter(w.world);
    r.report({ kind: 'SLOW', detail: 'load', value: 9100 });
    r.report({ kind: 'SLOW', detail: 'load', value: 12000 });
    r.report({ kind: 'SLOW', detail: 'api', value: 12400, resource: 'GET /api/v1/projects/clx9z8y7w0000abcd1234efgh' });
    await w.advance(10_000);
    expect(w.sent[0]!.body.reports).toEqual([
      expect.objectContaining({ kind: 'SLOW', detail: 'load', value: 9100, count: 2, page: '/board' }),
      expect.objectContaining({ kind: 'SLOW', detail: 'api', value: 12400, resource: 'GET /api/v1/projects/:id' }),
    ]);
  });
});
