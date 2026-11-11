import { isAiRequest } from './ai-requests';
import { requestReport, serverTimingOf, SLOW } from './error-capture';
import type { RequestDone } from './api-client';
import type { ErrorReport } from './error-reporter';
import type { PageLifecycle, PageMark } from './page-lifecycle';

/**
 * 1.23.14 — the Error log's slow and failed API requests, measured right.
 *
 * The live log said "Slow request … took 10.1–21 s; server under 0.1 s · the rest was the network" for
 * requests that waited in a frozen background tab or on a sleeping laptop (the bell's 30-second request
 * "15 times in one visit" at night; many requests all at the same 29.8 s), because a request's time was
 * the page's own clock from start to answer. Now:
 *
 *  - a request during which the page was away at any moment (hidden, frozen, being left, prerendered; the
 *    device asleep: page-lifecycle) is never slow and never "blocked on the way";
 *  - a request's time is the network's own, from the browser's Resource Timing entry for it (matched by
 *    its address and start): a page too busy to see an answer that came in 0.3 s didn't wait 29.8 s for it.
 *    The entry also says where the time went — waiting for a free connection, connecting, waiting for the
 *    first byte, downloading — sent with the server's own time (Server-Timing) for the Error log's words;
 *  - a request answered by a server that started after it was sent waited for an update restart: it is
 *    reported as the update's (kind UPDATE), not as slow;
 *  - a request that never reached the server (status 0) on a page that stayed on screen and online: the
 *    server is asked how long it has been up (/health, a few times over two minutes). Up from before the
 *    request → "blocked on the way" (a firewall, a proxy, an antivirus, the connection); started after it,
 *    or never answering until then too → cut by an update restart, or still the network (as before).
 *    A request aborted on purpose is neither.
 */

/** What is needed of a Resource Timing entry (a PerformanceResourceTiming). */
export interface ResourceTimingLike {
  name: string;
  initiatorType: string;
  startTime: number;
  fetchStart?: number;
  domainLookupStart: number;
  connectStart: number;
  connectEnd: number;
  requestStart: number;
  responseStart: number;
  responseEnd: number;
  serverTiming?: readonly { name: string; duration: number }[];
}

/** Where a request's time went (ms); only its total when the browser gave no detail. */
export interface Breakdown {
  totalMs: number;
  queueMs?: number;
  connectMs?: number;
  waitMs?: number;
  downloadMs?: number;
}

/** How long a slow request waits for its Resource Timing entry before it is judged on the page's own time. */
export const ENTRY_WAIT_MS = 15_000;
/** Requests and entries kept for matching (a request waiting on the AI may take three minutes). */
const KEEP_MS = 4 * 60_000;
const MAX_KEPT = 60;
/** A failed request: the server is asked at once, then after these waits (about two minutes in all). */
export const PROBE_DELAYS_MS: readonly number[] = [0, 5_000, 10_000, 15_000, 30_000, 60_000];
/** /health says its uptime in whole seconds: a server started this little before the request still counts as after. */
const RESTART_SLACK_MS = 2000;
/** Server-Timing's `up` is exact: a server started this little before the request still counts as after. */
const UP_SLACK_MS = 1000;

const tenth = (ms: number) => Math.round(ms * 10) / 10;

/** A Resource Timing entry split into waiting for a connection, connecting, waiting for the first byte and downloading. */
export function breakdownOf(e: ResourceTimingLike): Breakdown | null {
  const start = Number(e.startTime);
  const end = Number(e.responseEnd);
  if (!Number.isFinite(start) || !Number.isFinite(end) || !(end > 0) || end < start) return null;
  const totalMs = tenth(end - start);
  // Without detail (an answer from another site that doesn't allow it): only the total.
  if (!(e.requestStart > 0) || !(e.responseStart > 0)) return { totalMs };
  const fetchStart = e.fetchStart || start;
  const lookup = e.domainLookupStart || fetchStart;
  const connectEnd = e.connectEnd || e.connectStart || lookup;
  const span = (a: number, b: number) => Math.max(0, b - a);
  return {
    totalMs,
    queueMs: tenth(span(start, lookup) + span(connectEnd, e.requestStart)),
    connectMs: tenth(span(lookup, connectEnd)),
    waitMs: tenth(span(e.requestStart, e.responseStart)),
    downloadMs: tenth(span(e.responseStart, end)),
  };
}

/** The answering server's uptime (ms) from its Server-Timing (`up;dur=…`, 1.23.14); null without it. */
export function serverUpMs(header: string | null | undefined): number | null {
  for (const metric of String(header ?? '').split(',')) {
    const [name = '', ...params] = metric.split(';').map((p) => p.trim());
    if (name.toLowerCase() !== 'up') continue;
    const dur = params.map((p) => /^dur\s*=\s*"?([^"]*)"?$/i.exec(p)?.[1]?.trim()).find((v) => v !== undefined);
    const ms = dur && /^\d+(\.\d+)?$/.test(dur) ? Number(dur) : NaN;
    return Number.isFinite(ms) ? ms : null;
  }
  return null;
}

export interface RequestWatchWorld {
  /** Whether the page was on screen (null: not known — the older rules apply). */
  lifecycle: Pick<PageLifecycle, 'awaySince' | 'awayBetween'> | null;
  online(): boolean;
  /** The page is being left (or hidden now): the older rule, for requests without a start mark. */
  leaving(): boolean;
  /** The page is being left (not merely hidden): asking the server about a failed request stops then. */
  gone?(): boolean;
  report(r: ErrorReport): void;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(timer: unknown): void;
  /** The page's own clock (performance.now) and the wall clock. */
  mono(): number;
  wall(): number;
  /** How long the server has been up (ms), from /health; null when it didn't answer. */
  serverUptimeMs(): Promise<number | null>;
  /** A request's address as the browser names its entry. */
  absolute(url: string): string;
}

interface Pending {
  info: RequestDone;
  url: string;
  limit: number;
  timer: unknown;
  /** When the request was told (the page's clock): kept for matching from then. */
  doneAt: number;
}

/** An entry this close after a request's start is its own (fetch is called right after the start is taken). */
const MATCH_MS = 100;

export function createRequestWatch(world: RequestWatchWorld) {
  const pending: Pending[] = [];
  const entries: ResourceTimingLike[] = [];
  let probing: RequestDone[] | null = null;

  const resourceOf = (info: RequestDone) => `${info.method.toUpperCase()} /api/v1${info.path}`;

  /** Was the page away (or the device asleep) from the request's start to its answer? */
  function interrupted(info: RequestDone): boolean {
    if (!world.lifecycle || !info.mark) return world.leaving();
    return world.lifecycle.awaySince(info.mark as PageMark);
  }

  /** Judge a slow request, with its entry when there is one. */
  function judge(p: Pending, entry: ResourceTimingLike | null): void {
    const { info } = p;
    const b = entry ? breakdownOf(entry) : null;
    // Still downloading when the page went away: not the network's time either.
    if (entry && b && world.lifecycle && info.startedAt !== undefined && world.lifecycle.awayBetween(info.startedAt, entry.responseEnd)) return;
    const total = b ? b.totalMs : info.ms;
    if (!(total > p.limit)) return;
    const timing = serverTimingOf(info.serverTiming) ?? serverTimingOfEntry(entry);
    const up = serverUpMs(info.serverTiming) ?? upOfEntry(entry);
    // Answered by a server that started after the request was sent: it waited for an update restart.
    const answeredAt = entry && entry.responseStart > 0 ? entry.responseStart : (info.startedAt ?? 0) + info.ms;
    const restarted = up !== null && info.startedAt !== undefined && answeredAt - up > info.startedAt - UP_SLACK_MS;
    const report: ErrorReport = restarted
      ? { kind: 'UPDATE', detail: 'slow', value: Math.round(total), resource: resourceOf(info) }
      : { kind: 'SLOW', detail: 'api', value: Math.round(total), resource: resourceOf(info) };
    if (timing) {
      report.serverMs = timing.serverMs;
      if (timing.dbMs !== null) report.dbMs = timing.dbMs;
    }
    if (b && b.waitMs !== undefined) {
      report.queueMs = b.queueMs;
      report.connectMs = b.connectMs;
      report.waitMs = b.waitMs;
      report.downloadMs = b.downloadMs;
    }
    world.report(report);
  }

  function forget(p: Pending): void {
    const i = pending.indexOf(p);
    if (i >= 0) pending.splice(i, 1);
    if (p.timer !== null && p.timer !== undefined) world.clearTimeout(p.timer);
  }

  /** The entry of this request: the same address, started with it (the closest start). */
  function entryFor(p: Pending): ResourceTimingLike | null {
    const at = p.info.startedAt ?? NaN;
    let best: ResourceTimingLike | null = null;
    for (const e of entries) {
      const d = e.startTime - at;
      if (e.name !== p.url || d < -2 || d > MATCH_MS) continue;
      if (!best || Math.abs(d) < Math.abs(best.startTime - at)) best = e;
    }
    if (best) entries.splice(entries.indexOf(best), 1);
    return best;
  }

  /** Old requests and entries go; a slow request still waiting for its entry (its timer armed) never does. */
  function prune(): void {
    const old = world.mono() - KEEP_MS;
    for (const p of [...pending]) if (p.doneAt < old && !p.timer) forget(p);
    const unarmed = pending.filter((p) => !p.timer);
    while (unarmed.length && pending.length > MAX_KEPT) forget(unarmed.shift()!);
    for (let i = entries.length - 1; i >= 0; i--) if (entries[i]!.startTime < old) entries.splice(i, 1);
    if (entries.length > MAX_KEPT) entries.splice(0, entries.length - MAX_KEPT);
  }

  /** A failed request on a page that stayed on screen: was the server up all along, or did it restart? */
  function probeServer(info: RequestDone): void {
    if (probing) {
      probing.push(info);
      return;
    }
    const waiting = [info];
    probing = waiting;
    const left = () => (world.gone ? world.gone() : world.leaving());
    const settle = (serverStartedAt: number | null) => {
      probing = null;
      if (left() || !world.online()) return;
      for (const i of waiting) {
        const restarted = serverStartedAt !== null && i.wallStart !== undefined && serverStartedAt > i.wallStart - RESTART_SLACK_MS;
        world.report({ kind: restarted ? 'UPDATE' : 'NETWORK', detail: 'api', resource: resourceOf(i) });
      }
    };
    const attempt = (n: number) => {
      world.setTimeout(() => {
        // Only a page being left stops it: the failure happened on screen, whatever the person does next.
        if (left()) {
          probing = null;
          return;
        }
        void world
          .serverUptimeMs()
          .catch(() => null)
          .then((up) => {
            if (up !== null && up >= 0) return settle(world.wall() - up);
            if (n + 1 < PROBE_DELAYS_MS.length) return attempt(n + 1);
            settle(null);
          });
      }, PROBE_DELAYS_MS[n]!);
    };
    attempt(0);
  }

  return {
    /** One request, from the API client (headers received, or failed). Never throws. */
    requestDone(info: RequestDone): void {
      try {
        if (info.path.startsWith('/client-errors')) return;
        // Without its start (an older caller, or no lifecycle): the older rules.
        if (!info.url || info.startedAt === undefined || !info.mark || !world.lifecycle) {
          const r = requestReport(info, { online: world.online(), leaving: world.leaving() });
          if (r) world.report(r);
          return;
        }
        if (interrupted(info)) return;
        if (info.status === 0) {
          if (info.aborted || !world.online()) return;
          probeServer(info);
          return;
        }
        prune();
        const p: Pending = { info, url: world.absolute(info.url), limit: isAiRequest(info.method, info.path) ? SLOW.aiApiMs : SLOW.apiMs, timer: null, doneAt: world.mono() };
        const seen = entryFor(p);
        if (seen) return judge(p, seen);
        pending.push(p);
        // Slow already by the page's own time: judged on it if no entry comes.
        if (info.ms > p.limit) {
          p.timer = world.setTimeout(() => {
            p.timer = null;
            forget(p);
            judge(p, null);
          }, ENTRY_WAIT_MS);
        }
      } catch {
        // Never in the request's way.
      }
    },
    /** Resource Timing entries (a PerformanceObserver's): an API request's is matched to its request. */
    resources(list: readonly ResourceTimingLike[]): void {
      try {
        for (const e of list) {
          if (e.initiatorType !== 'fetch' && e.initiatorType !== 'xmlhttprequest') continue;
          if (!/\/api\/v1\//.test(e.name) || /\/client-errors(\?|$|\/)/.test(e.name)) continue;
          entries.push(e);
          let match: Pending | null = null;
          for (const p of pending) {
            const d = e.startTime - (p.info.startedAt ?? NaN);
            if (p.url !== e.name || d < -2 || d > MATCH_MS) continue;
            if (!match || Math.abs(d) < Math.abs(e.startTime - (match.info.startedAt ?? 0))) match = p;
          }
          if (match) {
            entries.splice(entries.indexOf(e), 1);
            forget(match);
            judge(match, e);
          }
        }
        prune();
      } catch {
        // A reading we can't take is just not reported.
      }
    },
  };
}

function serverTimingOfEntry(e: ResourceTimingLike | null): { serverMs: number; dbMs: number | null } | null {
  const list = e?.serverTiming;
  if (!list?.length) return null;
  return serverTimingOf(list.map((m) => `${m.name};dur=${m.duration}`).join(', '));
}

function upOfEntry(e: ResourceTimingLike | null): number | null {
  const up = e?.serverTiming?.find((m) => m.name.toLowerCase() === 'up');
  return up && Number.isFinite(up.duration) && up.duration >= 0 ? up.duration : null;
}
