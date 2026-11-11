import { isExtensionSource, pagePattern, redactText } from './error-redact';

/**
 * The page's side of the Error log (1.22.4): what went wrong in this browser — errors, a request or
 * the live connection blocked on the way, files or scripts that were blocked, slow pages — sent to
 * the server in small batches, for System Settings → Error log.
 *
 * It must never harm the page: nothing here throws, loops or floods. The same report in one page
 * load is sent once with a count; at most 20 reports a page load; a batch every 10 seconds (at once,
 * with fetch keepalive, when the page is hidden); a failed send is dropped — only a network problem
 * waits for a later send, at most one try a minute and ten in all. Nothing is reported offline.
 * Never sent: typed text, form values, tokens, cookies, storage, request bodies (see error-redact).
 */

/** 1.23.14 UPDATE: a request cut or held up by an update restart (the server started after it was sent). */
export type ReportKind = 'ERROR' | 'NETWORK' | 'BLOCKED' | 'SLOW' | 'UPDATE';

export interface ErrorReport {
  kind: ReportKind;
  /** error, rejection, boundary, chunk · api, socket · resource, csp · load, lcp, inp, cls, api. */
  detail: string;
  message?: string | null;
  stack?: string | null;
  /** A file or address, or a request: "GET /api/v1/tasks/…" (reduced before sending). */
  resource?: string | null;
  directive?: string | null;
  tag?: 'script' | 'link' | 'img' | null;
  value?: number | null;
  /** The page it happened on, when not the one open now (a slow first load measured later). */
  page?: string | null;
  /** 1.23.3, a slow request: the server's own time and its time in the database (ms, its Server-Timing). */
  serverMs?: number | null;
  dbMs?: number | null;
  /**
   * 1.23.14, a slow request: where its time went, from the browser's Resource Timing (ms) — waiting for a
   * free connection, connecting, waiting for the first byte, downloading the answer.
   */
  queueMs?: number | null;
  connectMs?: number | null;
  waitMs?: number | null;
  downloadMs?: number | null;
}

/** What the reporter needs from the page (a test gives it a fake one). */
export interface ReporterWorld {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(timer: unknown): void;
  online(): boolean;
  /** The page's address (its path; reduced to a pattern before sending). */
  page(): string;
  /** "1440x900": the browser window's size. */
  windowSize(): string | null;
  version: string;
  /** POST one batch. `hidden`: the page is going away (keepalive). `stop`: the server said it isn't collecting. */
  send(body: string, hidden: boolean): Promise<{ delivered: boolean; stop: boolean }>;
  /** Whether the site collects browser errors at all (asked once, when there is first something to send). */
  collecting(): Promise<boolean>;
}

export const MAX_REPORTS_PER_PAGE = 20;
export const BATCH_EVERY_MS = 10_000;
/** A network problem: at most one a minute, and a waiting one is tried again at most once a minute… */
export const NETWORK_EVERY_MS = 60_000;
/** …ten times in all. */
export const NETWORK_TRIES = 10;
/** The server takes 16 KB a batch. */
export const MAX_BODY_CHARS = 15_000;

const NOISE = /ResizeObserver loop|^Script error\.?$/i;
const REQUEST = /^(GET|HEAD|POST|PUT|PATCH|DELETE) (\S+)$/;

interface Item {
  key: string;
  report: Record<string, unknown>;
  network: boolean;
  tries: number;
}

const bytes = (text: string) => (typeof TextEncoder !== 'undefined' ? new TextEncoder().encode(text).length : text.length * 3);

/** A request or an address, reduced like the page's own. */
function reducedResource(value: string | null | undefined): string | null {
  const v = String(value ?? '').trim();
  if (!v) return null;
  const request = REQUEST.exec(v);
  if (request) return `${request[1]} ${pagePattern(request[2]!)}`;
  if (v.startsWith('/')) return pagePattern(v);
  return redactText(v, 300) || null;
}

const firstFrame = (stack: string | null) => (stack ?? '').split('\n').find((l) => /^\s*at\s|@/.test(l))?.trim() ?? '';

export function createErrorReporter(world: ReporterWorld) {
  const queue = new Map<string, Item>();
  const done = new Set<string>();
  const networkSeen = new Set<string>();
  let accepted = 0;
  let lastNetworkAt = -Infinity;
  let nextSendAt = 0;
  let timer: unknown = null;
  let sending = false;
  let disabled = false;
  let collecting: boolean | null = null;
  let busy = false;

  function disable(): void {
    disabled = true;
    queue.clear();
    if (timer !== null) world.clearTimeout(timer);
    timer = null;
  }

  function schedule(): void {
    if (disabled || timer !== null || queue.size === 0) return;
    const wait = Math.max(BATCH_EVERY_MS, nextSendAt - world.now());
    timer = world.setTimeout(() => {
      timer = null;
      void flush();
    }, wait);
  }

  /** Note one thing that went wrong (never throws). */
  function report(r: ErrorReport): void {
    if (disabled || busy) return;
    busy = true;
    try {
      if (!r || !world.online()) return;
      const message = r.message == null ? null : redactText(String(r.message), 500).trim() || null;
      const stack = r.stack == null ? null : redactText(String(r.stack), 4096) || null;
      const resource = reducedResource(r.resource);
      if (message && NOISE.test(message)) return;
      if (isExtensionSource(stack) || isExtensionSource(resource) || isExtensionSource(message)) return;
      const page = pagePattern(String(r.page ?? world.page()));
      // A network problem, or an update restart (1.23.14), is one report a page load whatever the request: counted.
      const key = [r.kind, r.detail, message ?? '', firstFrame(stack), r.kind === 'NETWORK' || r.kind === 'UPDATE' ? '' : (resource ?? ''), r.directive ?? '', r.kind === 'ERROR' ? '' : page].join('|');
      if (done.has(key)) return;
      const waiting = queue.get(key);
      if (waiting) {
        waiting.report.count = Math.min(Number(waiting.report.count) + 1, 1000);
        return;
      }
      if (accepted >= MAX_REPORTS_PER_PAGE) return;
      const network = r.kind === 'NETWORK';
      if (network) {
        if (networkSeen.has(r.detail) || world.now() - lastNetworkAt < NETWORK_EVERY_MS) return;
        networkSeen.add(r.detail);
        lastNetworkAt = world.now();
      }
      const out: Record<string, unknown> = { kind: r.kind, detail: r.detail };
      if (message) out.message = message;
      if (stack) out.stack = stack;
      out.page = page;
      if (resource) out.resource = resource;
      if (r.directive) out.directive = String(r.directive).slice(0, 60);
      if (r.tag) out.tag = r.tag;
      if (typeof r.value === 'number' && Number.isFinite(r.value) && r.value >= 0) out.value = Math.round(r.value * 1000) / 1000;
      // 1.23.3: a slow request's server and database times (ms; the database's only with the server's).
      const ms = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1e9 ? Math.round(v * 1000) / 1000 : null);
      const serverMs = ms(r.serverMs);
      const dbMs = ms(r.dbMs);
      if (serverMs !== null) {
        out.serverMs = serverMs;
        if (dbMs !== null) out.dbMs = dbMs;
      }
      // 1.23.14: and where its time went (all four, or none).
      const parts = [ms(r.queueMs), ms(r.connectMs), ms(r.waitMs), ms(r.downloadMs)];
      if (parts.every((v) => v !== null)) [out.queueMs, out.connectMs, out.waitMs, out.downloadMs] = parts;
      out.count = 1;
      out.version = world.version;
      const size = world.windowSize();
      if (size) out.screen = size;
      queue.set(key, { key, report: out, network, tries: 0 });
      accepted += 1;
      schedule();
    } catch {
      // Reporting must never be what breaks the page.
    } finally {
      busy = false;
    }
  }

  /** The next batch: as many waiting reports as fit the server's limit. */
  function takeBatch(): Item[] {
    const batch: Item[] = [];
    let size = 20;
    for (const item of queue.values()) {
      if (batch.length >= MAX_REPORTS_PER_PAGE) break;
      const one = bytes(JSON.stringify(item.report)) + 1;
      if (size + one > MAX_BODY_CHARS) {
        if (batch.length) break;
        // One report alone too big (it can't be, but): shorten its stack.
        item.report.stack = String(item.report.stack ?? '').slice(0, 1000);
      }
      batch.push(item);
      size += one;
    }
    for (const item of batch) queue.delete(item.key);
    return batch;
  }

  /** Send what is waiting. `hidden`: the page is going away — at once, with keepalive, no settings check. */
  async function flush(opts: { hidden?: boolean } = {}): Promise<void> {
    try {
      const hidden = !!opts.hidden;
      if (disabled || sending || queue.size === 0) return;
      if (!hidden && world.now() < nextSendAt) {
        schedule();
        return;
      }
      sending = true;
      try {
        if (!hidden && collecting === null) {
          try {
            collecting = await world.collecting();
          } catch {
            collecting = true; // the server decides (it drops what it doesn't collect)
          }
        }
        if (collecting === false) {
          disable();
          return;
        }
        const batch = takeBatch();
        if (!batch.length) return;
        let answer = { delivered: false, stop: false };
        try {
          answer = await world.send(JSON.stringify({ reports: batch.map((i) => i.report) }), hidden);
        } catch {
          answer = { delivered: false, stop: false };
        }
        if (answer.stop) {
          disable();
          return;
        }
        for (const item of batch) {
          // Only a network problem waits for a later send; anything else that failed is dropped.
          if (!answer.delivered && item.network && item.tries + 1 < NETWORK_TRIES) {
            item.tries += 1;
            queue.set(item.key, item);
          } else done.add(item.key);
        }
        if (!answer.delivered) nextSendAt = world.now() + NETWORK_EVERY_MS;
      } finally {
        sending = false;
      }
      schedule();
    } catch {
      // Never a broken promise for the page.
    }
  }

  return { report, flush, disable };
}

export type ErrorReporter = ReturnType<typeof createErrorReporter>;
