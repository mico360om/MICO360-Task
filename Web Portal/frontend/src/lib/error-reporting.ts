import { createErrorReporter, type ErrorReporter, type ReporterWorld } from './error-reporter';
import { CHUNK_FAILURE, installErrorCapture, isLeaving, requestReport } from './error-capture';

/**
 * The page's Error log reporter (1.22.4), set up once by main.tsx before the app renders. Until then
 * — and in tests, where nothing installs it — every function here does nothing. None of them throws.
 */
let reporter: ErrorReporter | null = null;

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
    installErrorCapture(window, r, { origin: window.location.origin });
    reporter = r;
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

/** One API request, from the API client: blocked on the way (status 0 while online) or slow. */
export function noteRequest(info: { method: string; path: string; status: number; ms: number }): void {
  try {
    if (!reporter) return;
    const r = requestReport(info, { online: navigator.onLine !== false, leaving: isLeaving() || document.visibilityState === 'hidden' });
    if (r) reporter.report(r);
  } catch {
    // Never in the request's way.
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
