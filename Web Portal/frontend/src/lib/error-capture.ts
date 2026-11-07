import { isExtensionSource } from './error-redact';
import { isAiRequest } from './ai-requests';
import type { ErrorReport, ErrorReporter } from './error-reporter';
import type { RequestDone } from './api-client';

/** When a page counts as slow (1.22.4, the Error log's Slow). */
export const SLOW = {
  /** The page took this long to load. */
  loadMs: 8000,
  /** Its largest content was shown after this long ("poor" largest contentful paint). */
  lcpMs: 4000,
  /** A click or key press took this long to answer ("poor" interaction to next paint). */
  inpMs: 500,
  /** The layout jumped this much ("poor" cumulative layout shift). */
  cls: 0.25,
  /** An API request took this long. */
  apiMs: 10_000,
  /**
   * 1.23.0: a request that waits on the AI (ai-requests.ts) took this long — an AI answer legitimately
   * takes a while (the provider is given minutes); one that fails is still logged as an error.
   */
  aiApiMs: 60_000,
};

/** A failed load of the site's own code — usually a page left open across a deployment. */
export const CHUNK_FAILURE = /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Unable to preload CSS/i;
/** A request that never got an answer: the network report covers it, not an error. */
const LOST = /^(Failed to fetch|NetworkError when attempting to fetch resource\.?|Load failed|Network request failed)$/i;

type Sink = Pick<ErrorReporter, 'report' | 'flush'>;

let leaving = false;
/** Is the page going away (a reload, another address, the tab closing)? Its requests then fail on purpose. */
export function isLeaving(): boolean {
  return leaving;
}

/** A Server-Timing duration: a plain number of milliseconds (at most 1e9, what the server takes). */
const DURATION = /^\d+(\.\d+)?$/;

/**
 * 1.23.3 — the server's own time on a request and its time in the database, from the answer's
 * Server-Timing header (`app;dur=9912.3, db;dur=9700.1`; a proxy may add metrics of its own). Null
 * without the server's time.
 */
export function serverTimingOf(header: string | null | undefined): { serverMs: number; dbMs: number | null } | null {
  const durations = new Map<string, number>();
  for (const metric of String(header ?? '').split(',')) {
    const [name = '', ...params] = metric.split(';').map((p) => p.trim());
    const key = name.toLowerCase();
    if ((key !== 'app' && key !== 'db') || durations.has(key)) continue;
    const dur = params.map((p) => /^dur\s*=\s*"?([^"]*)"?$/i.exec(p)?.[1]?.trim()).find((v) => v !== undefined);
    const ms = dur && DURATION.test(dur) ? Number(dur) : NaN;
    if (Number.isFinite(ms) && ms <= 1e9) durations.set(key, ms);
  }
  const serverMs = durations.get('app');
  return serverMs === undefined ? null : { serverMs, dbMs: durations.get('db') ?? null };
}

/**
 * What the API client tells about one request: a request that never reached the server while the
 * device says it is online (blocked on the way: a firewall, a proxy, an antivirus) is a network
 * problem; one that took over 10 s is slow (one that waits on the AI: over a minute) — 1.23.3: with
 * the server's time and its time in the database when the answer said them. The server logs its own
 * errors, so an answer is not one.
 */
export function requestReport(info: RequestDone, ctx: { online: boolean; leaving: boolean }): ErrorReport | null {
  if (info.path.startsWith('/client-errors')) return null;
  const resource = `${info.method.toUpperCase()} /api/v1${info.path}`;
  if (info.status === 0) return ctx.online && !ctx.leaving ? { kind: 'NETWORK', detail: 'api', resource } : null;
  if (info.ms > (isAiRequest(info.method, info.path) ? SLOW.aiApiMs : SLOW.apiMs)) {
    const timing = serverTimingOf(info.serverTiming);
    const report: ErrorReport = { kind: 'SLOW', detail: 'api', value: Math.round(info.ms), resource };
    if (timing) {
      report.serverMs = timing.serverMs;
      if (timing.dbMs !== null) report.dbMs = timing.dbMs;
    }
    return report;
  }
  return null;
}

/** The largest "session" of layout shifts (gaps under 1 s, at most 5 s long): the page's layout-shift score. */
export function layoutShiftScore(entries: { startTime: number; value: number; hadRecentInput: boolean }[]): number {
  let best = 0;
  let session = 0;
  let start = 0;
  let last = 0;
  for (const e of entries) {
    if (e.hadRecentInput) continue;
    if (session && (e.startTime - last > 1000 || e.startTime - start > 5000)) session = 0;
    if (!session) start = e.startTime;
    session += e.value;
    last = e.startTime;
    best = Math.max(best, session);
  }
  return best;
}

const pathOf = (win: Window) => {
  try {
    return win.location.pathname;
  } catch {
    return '/';
  }
};

/** Slow pages, measured with the browser's own PerformanceObserver (no package). Returns what to run when the page is hidden. */
function observePerformance(win: Window, sink: Sink): { finish: () => void; stop: () => void } {
  const observers: PerformanceObserver[] = [];
  const PO = (win as Window & { PerformanceObserver?: typeof PerformanceObserver }).PerformanceObserver;
  const supported: readonly string[] = PO?.supportedEntryTypes ?? [];
  let lcp = { ms: 0, page: '/' };
  const shifts: { startTime: number; value: number; hadRecentInput: boolean }[] = [];
  let shiftPage = '/';
  let finished = false;
  const watch = (type: string, onEntries: (entries: PerformanceEntry[]) => void, extra: Record<string, unknown> = {}) => {
    if (!PO || !supported.includes(type)) return;
    try {
      const o = new PO((list) => {
        try {
          onEntries(list.getEntries());
        } catch {
          // A reading we can't take is just not reported.
        }
      });
      o.observe({ type, buffered: true, ...extra } as PerformanceObserverInit);
      observers.push(o);
    } catch {
      // Older browsers: no such reading.
    }
  };
  watch('largest-contentful-paint', (entries) => {
    const last = entries[entries.length - 1];
    if (last) lcp = { ms: last.startTime, page: pathOf(win) };
  });
  watch('layout-shift', (entries) => {
    for (const e of entries as (PerformanceEntry & { value?: number; hadRecentInput?: boolean })[]) {
      shifts.push({ startTime: e.startTime, value: Number(e.value) || 0, hadRecentInput: !!e.hadRecentInput });
    }
    if (shifts.length > 500) shifts.splice(0, shifts.length - 500);
    shiftPage = pathOf(win);
  });
  watch(
    'event',
    (entries) => {
      for (const e of entries as (PerformanceEntry & { interactionId?: number })[]) {
        if (e.interactionId && e.duration > SLOW.inpMs) sink.report({ kind: 'SLOW', detail: 'inp', value: Math.round(e.duration) });
      }
    },
    { durationThreshold: 104 },
  );

  const onLoad = () => {
    win.setTimeout(() => {
      try {
        const nav = win.performance?.getEntriesByType?.('navigation')[0] as PerformanceNavigationTiming | undefined;
        const ms = nav ? nav.loadEventEnd || nav.duration : win.performance.now();
        if (ms > SLOW.loadMs) sink.report({ kind: 'SLOW', detail: 'load', value: Math.round(ms), page: pathOf(win) });
      } catch {
        // No timing: nothing to say.
      }
    }, 0);
  };
  if (win.document.readyState === 'complete') onLoad();
  else win.addEventListener('load', onLoad, { once: true });

  return {
    finish() {
      if (finished) return;
      finished = true;
      if (lcp.ms > SLOW.lcpMs) sink.report({ kind: 'SLOW', detail: 'lcp', value: Math.round(lcp.ms), page: lcp.page });
      const cls = layoutShiftScore(shifts);
      if (cls > SLOW.cls) sink.report({ kind: 'SLOW', detail: 'cls', value: Math.round(cls * 1000) / 1000, page: shiftPage });
    },
    stop() {
      for (const o of observers) o.disconnect();
      win.removeEventListener('load', onLoad);
    },
  };
}

/**
 * Listens for what goes wrong on the page and hands it to the reporter: uncaught errors and promise
 * rejections (a failed load of the site's code after a deploy is a "chunk" error), the site's own
 * script / style / picture files that fail to load, what the security policy blocks, and slow pages.
 * Each listener is wrapped: nothing here can throw at the page. Returns a function that removes them.
 */
export function installErrorCapture(
  win: Window,
  sink: Sink,
  opts: {
    origin: string;
    /**
     * 1.23.2: the site's own code failed to load (a script or style of /assets/, a chunk error): does the
     * failure stand? A page that reloads to a newer build by itself (update-recovery) says no, and it isn't
     * recorded. Absent: it always stands.
     */
    codeFailureStands?: () => Promise<boolean>;
  },
): () => void {
  /** Report a code-loading failure only when it stands (the automatic reload can't help). */
  const reportCode = (report: ErrorReport) => {
    if (!opts.codeFailureStands) return sink.report(report);
    void opts.codeFailureStands().then(
      (stands) => {
        if (stands) sink.report(report);
      },
      () => sink.report(report),
    );
  };
  const safe = <E extends Event>(fn: (e: E) => void) => (e: E) => {
    try {
      fn(e);
    } catch {
      // Capturing must never be what breaks the page.
    }
  };

  const onError = safe((e: Event) => {
    const el = e.target as (Element & { src?: string; href?: string; rel?: string }) | null;
    if (el && el !== (win as unknown) && typeof el.tagName === 'string') {
      const tag = el.tagName.toLowerCase();
      if (tag !== 'script' && tag !== 'link' && tag !== 'img') return;
      if (tag === 'link' && !/stylesheet|modulepreload|preload|icon/i.test(el.rel ?? '')) return;
      const url = String((tag === 'link' ? el.href : el.src) ?? '');
      if (!url.startsWith(`${opts.origin}/`)) return; // another site's file isn't the site's
      const path = url.slice(opts.origin.length).split(/[?#]/)[0]!;
      if (path.startsWith('/uploads/') || path.startsWith('/api/')) return; // someone's picture, not the site's own files
      const blocked: ErrorReport = { kind: 'BLOCKED', detail: 'resource', tag: tag as 'script' | 'link' | 'img', resource: path };
      if (tag !== 'img' && path.startsWith('/assets/')) reportCode(blocked);
      else sink.report(blocked);
      return;
    }
    if (!(e instanceof ErrorEvent)) return;
    if (isExtensionSource(e.filename)) return;
    const err = e.error as { name?: unknown; message?: unknown; stack?: unknown } | null | undefined;
    const message = err && typeof err.message === 'string' ? `${typeof err.name === 'string' ? err.name : 'Error'}: ${err.message}` : String(e.message ?? '').replace(/^Uncaught\s+/, '');
    const report: ErrorReport = { kind: 'ERROR', detail: CHUNK_FAILURE.test(message) ? 'chunk' : 'error', message };
    if (err && typeof err.stack === 'string') report.stack = err.stack;
    if (report.detail === 'chunk') reportCode(report);
    else sink.report(report);
  });

  const onRejection = safe((e: Event) => {
    const reason = (e as PromiseRejectionEvent).reason as unknown;
    let message: string;
    let stack: string | undefined;
    if (reason && typeof reason === 'object' && typeof (reason as { message?: unknown }).message === 'string') {
      const r = reason as { name?: unknown; message: string; stack?: unknown };
      const name = typeof r.name === 'string' ? r.name : 'Error';
      // The server logs its own refusals and errors; a lost connection is a network report; an abort is wanted.
      if (name === 'ApiError' || name === 'AbortError' || LOST.test(r.message)) return;
      message = `${name}: ${r.message}`;
      if (typeof r.stack === 'string') stack = r.stack;
    } else if (typeof reason === 'string') {
      message = reason;
    } else {
      message = 'A promise was rejected without an error';
    }
    const report: ErrorReport = { kind: 'ERROR', detail: CHUNK_FAILURE.test(message) ? 'chunk' : 'rejection', message };
    if (stack) report.stack = stack;
    if (report.detail === 'chunk') reportCode(report);
    else sink.report(report);
  });

  const onViolation = safe((e: Event) => {
    const v = e as SecurityPolicyViolationEvent;
    if (isExtensionSource(v.sourceFile) || isExtensionSource(v.blockedURI)) return;
    const directive = v.effectiveDirective || v.violatedDirective;
    if (!directive) return;
    sink.report({ kind: 'BLOCKED', detail: 'csp', directive, resource: v.blockedURI || null });
  });

  const perf = (() => {
    try {
      return observePerformance(win, sink);
    } catch {
      return { finish() {}, stop() {} };
    }
  })();

  const onHidden = safe(() => {
    if (win.document.visibilityState !== 'hidden') {
      leaving = false; // back on the page (a "Leave site?" prompt was cancelled, or the tab came back)
      return;
    }
    perf.finish();
    void sink.flush({ hidden: true });
  });
  const onLeave = safe(() => {
    leaving = true;
    perf.finish();
    void sink.flush({ hidden: true });
  });
  const onBeforeUnload = safe(() => {
    leaving = true;
  });
  const onShow = safe(() => {
    leaving = false;
  });
  // A cancelled "Leave site?" prompt: the page stays, and is used again.
  const onBack = safe(() => {
    leaving = false;
  });

  win.addEventListener('error', onError, true);
  win.addEventListener('unhandledrejection', onRejection);
  win.document.addEventListener('securitypolicyviolation', onViolation);
  win.document.addEventListener('visibilitychange', onHidden);
  win.addEventListener('pagehide', onLeave);
  win.addEventListener('beforeunload', onBeforeUnload);
  win.addEventListener('pageshow', onShow);
  win.addEventListener('focus', onBack);
  win.document.addEventListener('pointerdown', onBack, true);
  win.document.addEventListener('keydown', onBack, true);
  return () => {
    win.removeEventListener('error', onError, true);
    win.removeEventListener('unhandledrejection', onRejection);
    win.document.removeEventListener('securitypolicyviolation', onViolation);
    win.document.removeEventListener('visibilitychange', onHidden);
    win.removeEventListener('pagehide', onLeave);
    win.removeEventListener('beforeunload', onBeforeUnload);
    win.removeEventListener('pageshow', onShow);
    win.removeEventListener('focus', onBack);
    win.document.removeEventListener('pointerdown', onBack, true);
    win.document.removeEventListener('keydown', onBack, true);
    perf.stop();
    leaving = false;
  };
}
