import { createErrorReporter, type ErrorReporter, type ReporterWorld } from './error-reporter';
import { CHUNK_FAILURE, installErrorCapture, isLeaving } from './error-capture';
import { recoverChunk } from './update-recovery';
import { createPageLifecycle, type PageLifecycle } from './page-lifecycle';
import { createRequestWatch, type ResourceTimingLike } from './request-watch';
import type { RequestDone } from './api-client';

/**
 * The page's Error log reporter (1.22.4), set up once by main.tsx before the app renders. Until then
 * — and in tests, where nothing installs it — every function here does nothing. None of them throws.
 */
let reporter: ErrorReporter | null = null;
/** 1.23.14: whether the page is on screen, and the API requests' watch (request-watch). */
let lifecycle: PageLifecycle | null = null;
let requests: ReturnType<typeof createRequestWatch> | null = null;

/** 1.23.14: how long the server has been up (ms), from /health — null when it doesn't answer. Never throws. */
export async function serverUptimeMs(baseUrl: string): Promise<number | null> {
  // Never waits for ever (a dead connection): after 10 s it counts as not answered.
  const stop = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = setTimeout(() => stop?.abort(), 10_000);
  try {
    const res = await fetch(`${baseUrl}/health`, { cache: 'no-store', ...(stop ? { signal: stop.signal } : {}) });
    if (!res.ok) return null;
    const seconds = Number(((await res.json()) as { data?: { uptimeSeconds?: unknown } })?.data?.uptimeSeconds);
    return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** The page is being left, or hidden now. */
const goingOrHidden = () => isLeaving() || document.visibilityState === 'hidden';

/**
 * 1.23.23: may the API client try a dropped read again now? Only on a page that is on screen, online and not
 * being left (Firefox and Safari fail a page's requests as it navigates away, while it is still visible).
 * Never throws (a broken check is a no).
 */
export function mayRetryRequest(): boolean {
  try {
    return !isLeaving() && document.visibilityState === 'visible' && navigator.onLine !== false;
  } catch {
    return false;
  }
}

/** The browser's own pieces: fetch with keepalive (sendBeacon only where that is missing), timers, the page. */
export function browserReporterWorld(opts: { baseUrl: string; getToken: () => string | null }): ReporterWorld {
  const url = `${opts.baseUrl}/client-errors`;
  return {
    now: () => Date.now(),
    setTimeout: (fn, ms) => window.setTimeout(fn, ms),
    clearTimeout: (t) => window.clearTimeout(t as number),
    online: () => navigator.onLine !== false,
    page: () => window.location.pathname,
    windowSize: () => `${Math.round(window.innerWidth)}x${Math.round(window.innerHeight)}`,
    version: __APP_VERSION__,
    async send(body, hidden) {
      const token = opts.getToken();
      const headers: Record<string, string> = { 'Content-Type': 'text/plain;charset=UTF-8' };
      // The signed-in person is the server's to read from the token (never written in the body).
      if (token) headers.Authorization = `Bearer ${token}`;
      try {
        // keepalive: the browser finishes the send even when the page is going away.
        const res = await fetch(url, { method: 'POST', headers, body, keepalive: true });
        return { delivered: res.ok, stop: res.headers.get('x-collect-browser-errors') === 'off' };
      } catch {
        // A browser without fetch keepalive, as the page goes: the beacon (no person on such a report).
        if (hidden && typeof navigator.sendBeacon === 'function') {
          try {
            return { delivered: navigator.sendBeacon(url, new Blob([body], { type: 'text/plain' })), stop: false };
          } catch {
            // Nothing else to try.
          }
        }
        return { delivered: false, stop: false };
      }
    },
    async collecting() {
      const res = await fetch(`${opts.baseUrl}/config`);
      const json = (await res.json()) as { data?: { collectBrowserErrors?: unknown } };
      return json?.data?.collectBrowserErrors !== false;
    },
  };
}

/** Set up the reporter and its listeners (main.tsx, once). */
export function installErrorReporting(opts: { baseUrl: string; getToken: () => string | null }): void {
  try {
    if (reporter || typeof window === 'undefined' || typeof fetch !== 'function') return;
    const r = createErrorReporter(browserReporterWorld(opts));
    const life = createPageLifecycle(window);
    // 1.23.2: a code file of an older build (gone after an update) is recorded only when the page can't
    // reload to the new build by itself. 1.23.14: page times only while the page is on screen.
    installErrorCapture(window, r, { origin: window.location.origin, codeFailureStands: async () => (await recoverChunk()) === 'failed', lifecycle: life });
    const watch = createRequestWatch({
      lifecycle: life,
      online: () => navigator.onLine !== false,
      leaving: goingOrHidden,
      gone: isLeaving,
      report: (report) => r.report(report),
      setTimeout: (fn, ms) => window.setTimeout(fn, ms),
      clearTimeout: (t) => window.clearTimeout(t as number),
      mono: () => performance.now(),
      wall: () => Date.now(),
      serverUptimeMs: () => serverUptimeMs(opts.baseUrl),
      absolute: (url) => new URL(url, window.location.href).href,
    });
    // The browser's own timing of each API request (where its time went): matched to the request.
    try {
      const PO = window.PerformanceObserver;
      if (PO?.supportedEntryTypes?.includes('resource')) {
        new PO((list) => watch.resources(list.getEntries() as unknown as ResourceTimingLike[])).observe({ type: 'resource', buffered: true });
      }
    } catch {
      // Without it, a slow request is judged on the page's own time.
    }
    reporter = r;
    lifecycle = life;
    requests = watch;
  } catch {
    // Without a reporter the page works exactly as before.
  }
}

/** A render error the app's error boundary caught. */
export function reportPageError(error: unknown): void {
  try {
    const e = error as { name?: unknown; message?: unknown; stack?: unknown } | null;
    const message = e && typeof e.message === 'string' ? `${typeof e.name === 'string' ? e.name : 'Error'}: ${e.message}` : String(error);
    reporter?.report({ kind: 'ERROR', detail: CHUNK_FAILURE.test(message) ? 'chunk' : 'boundary', message, stack: e && typeof e.stack === 'string' ? e.stack : null });
  } catch {
    // Never in the boundary's way.
  }
}

/**
 * One API request, from the API client: blocked on the way (status 0 while online) or slow (1.23.3: with
 * its Server-Timing). 1.23.14: never while the page was away; timed by the browser's Resource Timing, with
 * where the time went; one cut or held up by an update restart is the update's (request-watch).
 */
export function noteRequest(info: RequestDone): void {
  try {
    requests?.requestDone(info);
  } catch {
    // Never in the request's way.
  }
}

/** 1.23.14: the page's mark as a request starts (the API client's pageMark); nothing before the reporter is set up. */
export function pageMark(): unknown {
  try {
    return lifecycle?.mark();
  } catch {
    return undefined;
  }
}

/** The live connection (socket) hasn't been able to connect for over a minute while online. */
export function noteSocketTrouble(): void {
  try {
    if (reporter && navigator.onLine !== false && document.visibilityState !== 'hidden') reporter.report({ kind: 'NETWORK', detail: 'socket' });
  } catch {
    // Never in the socket's way.
  }
}
