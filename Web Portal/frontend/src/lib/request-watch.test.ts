import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { breakdownOf, createRequestWatch, PROBE_DELAYS_MS, serverUpMs, type ResourceTimingLike } from './request-watch';
import { createPageLifecycle, type PageLifecycle } from './page-lifecycle';
import type { RequestDone } from './api-client';
import type { ErrorReport } from './error-reporter';

// 1.23.14 — the Error log's slow and failed requests, measured right: not while the page was away (a
// background or frozen tab, a sleeping device), timed by the browser's own Resource Timing (the network's
// time, not the page's), with where the time went; a failure is "blocked on the way" only when the server
// was up all along — a request cut by an update restart is the update's.

let mono: number;
let wall: number;
let life: PageLifecycle;
let reports: ErrorReport[];
let timers: { at: number; fn: () => void; id: number }[];
let online: boolean;
let leaving: boolean;
let uptimes: (number | null)[];
let probes: number;
let watch: ReturnType<typeof createRequestWatch>;

const setVisibility = (state: 'visible' | 'hidden') => Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
const BASE = 'https://task.mico360.com/api/v1';

/** Let time pass: timers fall due and the probes' answers arrive. */
async function advance(ms: number) {
  const until = mono + ms;
  for (;;) {
    timers.sort((a, b) => a.at - b.at);
    const next = timers[0];
    if (!next || next.at > until) break;
    timers.shift();
    const step = next.at - mono;
    mono += step;
    wall += step;
    next.fn();
    for (let i = 0; i < 5; i++) await Promise.resolve();
  }
  wall += until - mono;
  mono = until;
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

function make() {
  watch = createRequestWatch({
    lifecycle: life,
    online: () => online,
    leaving: () => leaving,
    report: (r) => reports.push(r),
    setTimeout: (fn, ms) => {
      const id = Math.random();
      timers.push({ at: mono + ms, fn, id });
      return id;
    },
    clearTimeout: (id) => {
      timers = timers.filter((t) => t.id !== id);
    },
    mono: () => mono,
    wall: () => wall,
    serverUptimeMs: async () => {
      probes += 1;
      return uptimes.length ? uptimes.shift()! : null;
    },
    absolute: (url) => new URL(url, 'https://task.mico360.com/').href,
  });
}

/** A request that started now: its RequestDone when it ends `ms` later (the page's own clock). */
function request(over: Partial<RequestDone> & { path?: string } = {}) {
  const path = over.path ?? '/tasks';
  const started = { startedAt: mono, wallStart: wall, mark: life.mark() };
  return {
    started,
    done(ms: number, more: Partial<RequestDone> = {}): RequestDone {
      mono += ms;
      wall += ms;
      return { method: 'GET', path, status: 200, ms, url: `${BASE}${path}?limit=50`, ...started, ...over, ...more };
    },
  };
}

/** Its Resource Timing entry: a breakdown in ms from its start. */
function entry(startedAt: number, parts: { queue?: number; connect?: number; wait: number; download?: number }, over: Partial<ResourceTimingLike> = {}): ResourceTimingLike {
  const q = parts.queue ?? 0;
  const c = parts.connect ?? 0;
  const start = startedAt + 0.4;
  const connectStart = start + 0;
  const connectEnd = connectStart + c;
  const requestStart = connectEnd + q;
  const responseStart = requestStart + parts.wait;
  return {
    name: `${BASE}/tasks?limit=50`,
    initiatorType: 'fetch',
    startTime: start,
    fetchStart: start,
    domainLookupStart: connectStart,
    connectStart,
    connectEnd,
    requestStart,
    responseStart,
    responseEnd: responseStart + (parts.download ?? 0),
    ...over,
  };
}

beforeEach(() => {
  mono = 5000;
  wall = Date.parse('2026-11-11T00:41:00Z');
  setVisibility('visible');
  life = createPageLifecycle(window, { clock: { mono: () => mono, wall: () => wall }, visibilityEntries: () => [] });
  reports = [];
  timers = [];
  online = true;
  leaving = false;
  uptimes = [];
  probes = 0;
  make();
});
afterEach(() => {
  life.stop();
  setVisibility('visible');
});

describe('a slow request: timed by the browser’s Resource Timing, with where the time went', () => {
  it('waiting on the way to the server (the server itself fast): reported with the breakdown and Server-Timing', () => {
    const r = request();
    const info = r.done(10_600, { serverTiming: 'app;dur=48.2, db;dur=12.5, up;dur=86400000' });
    watch.requestDone(info);
    watch.resources([entry(r.started.startedAt, { connect: 30, wait: 10_400, download: 120 })]);
    expect(reports).toEqual([
      { kind: 'SLOW', detail: 'api', value: 10_550, resource: 'GET /api/v1/tasks', serverMs: 48.2, dbMs: 12.5, queueMs: 0, connectMs: 30, waitMs: 10_400, downloadMs: 120 },
    ]);
  });

  it('a slow download (the answer started at once): reported, though the page saw its first byte in 0.5 s', () => {
    const r = request();
    watch.requestDone(r.done(500, { serverTiming: 'app;dur=420, db;dur=300' }));
    watch.resources([entry(r.started.startedAt, { wait: 450, download: 11_500 })]);
    expect(reports).toEqual([{ kind: 'SLOW', detail: 'api', value: 11_950, resource: 'GET /api/v1/tasks', serverMs: 420, dbMs: 300, queueMs: 0, connectMs: 0, waitMs: 450, downloadMs: 11_500 }]);
  });

  it('the network answered in 0.3 s but the page saw it 29.8 s later (a frozen or busy page): not slow', () => {
    const r = request();
    watch.requestDone(r.done(29_800));
    watch.resources([entry(r.started.startedAt, { wait: 250, download: 50 })]);
    expect(reports).toEqual([]);
  });

  it('the entry seen before the request’s end is told: matched all the same', () => {
    const r = request();
    const e = entry(r.started.startedAt, { queue: 9_700, wait: 400 });
    watch.resources([e]);
    watch.requestDone(r.done(10_200));
    expect(reports).toMatchObject([{ kind: 'SLOW', value: 10_100, queueMs: 9_700, waitMs: 400 }]);
  });

  it('another request to the same address is not mistaken for it (matched by its start)', () => {
    const r1 = request();
    watch.requestDone(r1.done(11_000));
    watch.resources([entry(r1.started.startedAt + 30_000, { wait: 100 })]); // a later one's entry
    expect(reports).toEqual([]);
    watch.resources([entry(r1.started.startedAt, { wait: 10_900 })]);
    expect(reports).toMatchObject([{ kind: 'SLOW', value: 10_900 }]);
  });

  it('no entry at all (a browser without Resource Timing): the page’s own time after a while, without a breakdown', async () => {
    const r = request();
    watch.requestDone(r.done(11_000, { serverTiming: 'app;dur=80' }));
    expect(reports).toEqual([]);
    await advance(20_000);
    expect(reports).toEqual([{ kind: 'SLOW', detail: 'api', value: 11_000, resource: 'GET /api/v1/tasks', serverMs: 80 }]);
  });

  it('a request that waits on the AI is slow only after a minute', () => {
    const r = request({ method: 'POST', path: '/mico-ai/chats/c1/messages' });
    watch.requestDone(r.done(45_000));
    watch.resources([entry(r.started.startedAt, { wait: 44_900 }, { name: `${BASE}/mico-ai/chats/c1/messages?limit=50` })]);
    expect(reports).toEqual([]);
  });

  it('never about its own reports', async () => {
    const r = request({ method: 'POST', path: '/client-errors' });
    watch.requestDone(r.done(20_000));
    await advance(60_000);
    expect(reports).toEqual([]);
  });
});

describe('a slow request while the page was away is not the network’s', () => {
  it('hidden (a background tab) at any moment during it: nothing — the live log’s unread-count “15 times in one visit”', async () => {
    for (let i = 0; i < 15; i++) {
      const r = request({ path: '/notifications/unread-count' });
      mono += 100;
      setVisibility('hidden');
      document.dispatchEvent(new Event('visibilitychange'));
      const info = r.done(15_000);
      setVisibility('visible');
      document.dispatchEvent(new Event('visibilitychange'));
      watch.requestDone(info);
      watch.resources([entry(r.started.startedAt, { wait: 14_900 }, { name: `${BASE}/notifications/unread-count?limit=50` })]);
    }
    await advance(60_000);
    expect(reports).toEqual([]);
  });

  it('a frozen tab, or a sleeping laptop (the wall clock ran on): nothing — the live log’s requests all at 29.8 s', async () => {
    const r1 = request();
    document.dispatchEvent(new Event('freeze'));
    mono += 29_000;
    document.dispatchEvent(new Event('resume'));
    watch.requestDone(r1.done(800));
    const r2 = request({ path: '/projects/p1/members' });
    wall += 29_800 - 500; // asleep: the wall clock went on, the page's clock didn't
    watch.requestDone(r2.done(500));
    watch.resources([entry(r1.started.startedAt, { wait: 29_700 }), entry(r2.started.startedAt, { wait: 29_700 }, { name: `${BASE}/projects/p1/members?limit=50` })]);
    await advance(60_000);
    expect(reports).toEqual([]);
  });

  it('hidden while the answer was still downloading: nothing', () => {
    const r = request();
    const info = r.done(400);
    watch.requestDone(info);
    mono += 200;
    setVisibility('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    mono += 12_000;
    setVisibility('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    watch.resources([entry(r.started.startedAt, { wait: 350, download: 12_000 })]);
    expect(reports).toEqual([]);
  });

  it('switched away only after it ended: still reported', () => {
    const r = request();
    watch.requestDone(r.done(10_500));
    setVisibility('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    watch.resources([entry(r.started.startedAt, { wait: 10_400 })]);
    expect(reports).toMatchObject([{ kind: 'SLOW', value: 10_400 }]);
  });
});

describe('a slow request while the server was starting (an update restart) is the update’s', () => {
  it('the answering server started after the request was sent: Update restart, with the breakdown', () => {
    const r = request({ path: '/projects/p1/columns' });
    // Answered after 29.8 s by a server up for 1.2 s: it started while the request waited at the front door.
    watch.requestDone(r.done(29_800, { serverTiming: 'app;dur=35, db;dur=20, up;dur=1200' }));
    watch.resources([entry(r.started.startedAt, { wait: 29_750 }, { name: `${BASE}/projects/p1/columns?limit=50` })]);
    expect(reports).toEqual([{ kind: 'UPDATE', detail: 'slow', value: 29_750, resource: 'GET /api/v1/projects/p1/columns', serverMs: 35, dbMs: 20, queueMs: 0, connectMs: 0, waitMs: 29_750, downloadMs: 0 }]);
  });

  it('a server that started well before the request: an ordinary slow request', () => {
    const r = request();
    watch.requestDone(r.done(12_000, { serverTiming: 'app;dur=11900, db;dur=11800, up;dur=600000' }));
    watch.resources([entry(r.started.startedAt, { wait: 11_950 })]);
    expect(reports).toMatchObject([{ kind: 'SLOW', detail: 'api' }]);
  });
});

describe('a request that never reached the server (status 0)', () => {
  it('aborted on purpose, offline, the page away or being left: nothing', async () => {
    watch.requestDone(request().done(50, { status: 0, aborted: true }));
    online = false;
    watch.requestDone(request().done(50, { status: 0 }));
    online = true;
    const r = request();
    window.dispatchEvent(new Event('pagehide')); // into the back-forward cache, then back
    window.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: true }));
    watch.requestDone(r.done(50, { status: 0 }));
    await advance(180_000);
    expect(reports).toEqual([]);
    expect(probes).toBe(0);
  });

  it('a server up all along: “blocked on the way” (a firewall, a proxy, an antivirus)', async () => {
    uptimes = [3_600_000];
    watch.requestDone(request({ path: '/dashboard/priorities' }).done(80, { status: 0 }));
    await advance(10);
    expect(probes).toBe(1);
    expect(reports).toEqual([{ kind: 'NETWORK', detail: 'api', resource: 'GET /api/v1/dashboard/priorities' }]);
  });

  it('the server restarted meanwhile (an update): Update restart, not “blocked” — after it came back', async () => {
    uptimes = [null, null, 2_000];
    watch.requestDone(request({ path: '/conversations' }).done(300, { status: 0 }));
    await advance(PROBE_DELAYS_MS[0]! + 10);
    expect(reports).toEqual([]);
    await advance(PROBE_DELAYS_MS[1]! + PROBE_DELAYS_MS[2]! + 10);
    expect(probes).toBe(3);
    expect(reports).toEqual([{ kind: 'UPDATE', detail: 'api', resource: 'GET /api/v1/conversations' }]);
  });

  it('several at once share one round of asking the server', async () => {
    uptimes = [500]; // up for half a second: it started (well within the uptime's rounding) after they were sent
    watch.requestDone(request({ path: '/tasks' }).done(10, { status: 0 }));
    watch.requestDone(request({ path: '/projects' }).done(10, { status: 0 }));
    await advance(10);
    expect(probes).toBe(1);
    expect(reports.map((r) => [r.kind, r.resource])).toEqual([
      ['UPDATE', 'GET /api/v1/tasks'],
      ['UPDATE', 'GET /api/v1/projects'],
    ]);
  });

  it('the server never answered again within two minutes: “blocked on the way”', async () => {
    watch.requestDone(request().done(10, { status: 0 }));
    await advance(PROBE_DELAYS_MS.reduce((a, b) => a + b, 0) + 1000);
    expect(probes).toBe(PROBE_DELAYS_MS.length);
    expect(reports).toEqual([{ kind: 'NETWORK', detail: 'api', resource: 'GET /api/v1/tasks' }]);
  });

  it('the page left while asking: nothing', async () => {
    watch.requestDone(request().done(10, { status: 0 }));
    leaving = true;
    await advance(180_000);
    expect(reports).toEqual([]);
  });
});

describe('older callers (no start mark or address): as before', () => {
  it('slow by the page’s own time; failed while online and not leaving', () => {
    watch.requestDone({ method: 'GET', path: '/tasks', status: 200, ms: 10_500 });
    watch.requestDone({ method: 'GET', path: '/x', status: 0, ms: 10 });
    leaving = true;
    watch.requestDone({ method: 'GET', path: '/y', status: 0, ms: 10 });
    expect(reports).toEqual([
      { kind: 'SLOW', detail: 'api', value: 10_500, resource: 'GET /api/v1/tasks' },
      { kind: 'NETWORK', detail: 'api', resource: 'GET /api/v1/x' },
    ]);
  });
});

describe('breakdownOf and serverUpMs', () => {
  it('splits a Resource Timing entry into waiting for a connection, connecting, waiting for the first byte and downloading', () => {
    const e: ResourceTimingLike = { name: 'x', initiatorType: 'fetch', startTime: 100, fetchStart: 100, domainLookupStart: 150, connectStart: 160, connectEnd: 400, requestStart: 900, responseStart: 10_900, responseEnd: 11_400 };
    expect(breakdownOf(e)).toEqual({ totalMs: 11_300, queueMs: 550, connectMs: 250, waitMs: 10_000, downloadMs: 500 });
  });
  it('a reused connection (no lookup, no connect); an entry without detail gives only its total; nonsense gives nothing', () => {
    const reused: ResourceTimingLike = { name: 'x', initiatorType: 'fetch', startTime: 10, fetchStart: 10, domainLookupStart: 10, connectStart: 10, connectEnd: 10, requestStart: 12, responseStart: 30, responseEnd: 31 };
    expect(breakdownOf(reused)).toEqual({ totalMs: 21, queueMs: 2, connectMs: 0, waitMs: 18, downloadMs: 1 });
    expect(breakdownOf({ name: 'x', initiatorType: 'fetch', startTime: 10, domainLookupStart: 0, connectStart: 0, connectEnd: 0, requestStart: 0, responseStart: 0, responseEnd: 5010 })).toEqual({ totalMs: 5000 });
    expect(breakdownOf({ name: 'x', initiatorType: 'fetch', startTime: 10, domainLookupStart: 0, connectStart: 0, connectEnd: 0, requestStart: 0, responseStart: 0, responseEnd: 0 })).toBeNull();
  });
  it('the server’s uptime from its Server-Timing (up;dur=…); none without it', () => {
    expect(serverUpMs('app;dur=4, db;dur=1, up;dur=86400000')).toBe(86_400_000);
    expect(serverUpMs('app;dur=4')).toBeNull();
    expect(serverUpMs('up;dur=-1')).toBeNull();
    expect(serverUpMs(undefined)).toBeNull();
  });
});
