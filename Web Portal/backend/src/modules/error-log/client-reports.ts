import { z } from 'zod';
import { isExtensionSource, pagePattern, redactText } from './error-redact';

/** A browser's report as the server keeps it: checked, trimmed and reduced again (never trusted as sent). */
export interface ClientReport {
  /** 1.23.14 UPDATE: a request cut (api) or held up (slow) by an update restart, as the page saw it. */
  kind: 'ERROR' | 'NETWORK' | 'BLOCKED' | 'SLOW' | 'UPDATE';
  /** error, rejection, boundary, chunk · api, socket · resource, csp, csp-report · load, lcp, inp, cls, api. */
  detail: string;
  message: string | null;
  stack: string | null;
  /** The page's route as a pattern (/client/:token, /projects/:id). */
  page: string;
  /** A blocked file or address, or a request ("GET /api/v1/tasks/:id"). */
  resource: string | null;
  /** The security-policy rule that blocked it. */
  directive: string | null;
  /** script, link or img, for a file that didn't load. */
  tag: string | null;
  /** Milliseconds, or the layout-shift score. */
  value: number | null;
  /** The same report this many times in one page load. */
  count: number;
  version: string | null;
  screen: string | null;
  /**
   * 1.23.3, a slow request only: where its time went, from the answer's Server-Timing — the server's own
   * time (ms) and the part of it in the database (null: not said). Absent when the page didn't say.
   */
  serverMs?: number;
  dbMs?: number | null;
  /**
   * 1.23.14, a slow request (or one held up by an update restart): where its time went, from the browser's
   * Resource Timing (ms) — waiting for a free connection, connecting, waiting for the first byte,
   * downloading. All four or none.
   */
  queueMs?: number;
  connectMs?: number;
  waitMs?: number;
  downloadMs?: number;
}

/** Reports a batch may carry, and the most the CSP endpoint takes from one body. */
export const MAX_REPORTS_PER_BATCH = 20;
export const MAX_STACK = 4096;
export const MAX_MESSAGE = 500;

const DETAILS: Record<ClientReport['kind'], readonly string[]> = {
  ERROR: ['error', 'rejection', 'boundary', 'chunk'],
  NETWORK: ['api', 'socket'],
  BLOCKED: ['resource', 'csp'],
  SLOW: ['load', 'lcp', 'inp', 'cls', 'api'],
  UPDATE: ['api', 'slow'],
};

const text = (max: number) => z.string().max(max * 4).optional().nullable();
const ms = z.number().finite().min(0).max(1e9).optional().nullable();
const reportSchema = z.object({
  kind: z.enum(['ERROR', 'NETWORK', 'BLOCKED', 'SLOW', 'UPDATE']),
  detail: z.string().max(32),
  message: text(MAX_MESSAGE),
  stack: text(MAX_STACK),
  page: text(2000),
  resource: text(2000),
  directive: text(100),
  tag: z.enum(['script', 'link', 'img']).optional().nullable(),
  value: z.number().finite().min(0).max(1e9).optional().nullable(),
  count: z.number().int().min(1).max(1000).optional(),
  version: z.string().max(64).optional().nullable(),
  screen: z.string().max(40).optional().nullable(),
  serverMs: ms,
  dbMs: ms,
  queueMs: ms,
  connectMs: ms,
  waitMs: ms,
  downloadMs: ms,
});

type Timed = { kind: string; detail: string; serverMs?: number | null; dbMs?: number | null; queueMs?: number | null; connectMs?: number | null; waitMs?: number | null; downloadMs?: number | null };

/**
 * A slow request's server and database times (1.23.3): only with the server's, the database's never more.
 * 1.23.14: and where its time went (all four parts, or none) — also for one held up by an update restart.
 */
function timingOf(r: Timed): Pick<ClientReport, 'serverMs' | 'dbMs' | 'queueMs' | 'connectMs' | 'waitMs' | 'downloadMs'> {
  const timed = (r.kind === 'SLOW' && r.detail === 'api') || (r.kind === 'UPDATE' && r.detail === 'slow');
  if (!timed) return {};
  const out: Pick<ClientReport, 'serverMs' | 'dbMs' | 'queueMs' | 'connectMs' | 'waitMs' | 'downloadMs'> = {};
  if (r.serverMs != null) {
    out.serverMs = r.serverMs;
    out.dbMs = r.dbMs == null ? null : Math.min(r.dbMs, r.serverMs);
  }
  const { queueMs, connectMs, waitMs, downloadMs } = r;
  if (queueMs != null && connectMs != null && waitMs != null && downloadMs != null) Object.assign(out, { queueMs, connectMs, waitMs, downloadMs });
  return out;
}

/** Messages that say nothing about the site: ResizeObserver notices, and a cross-origin script's empty error. */
const NOISE = /ResizeObserver loop|^Script error\.?$/i;
const VERSION = /^[0-9A-Za-z.+-]{1,32}$/;
const SCREEN = /^\d{2,5}x\d{2,5}$/;
const REQUEST = /^(GET|HEAD|POST|PUT|PATCH|DELETE) (\S+)$/;

/** A request ("GET /api/v1/x/:id"), a site path or an address, reduced; null when it is nothing. */
function reducedResource(value: string | null | undefined): string | null {
  const v = (value ?? '').trim();
  if (!v) return null;
  const request = REQUEST.exec(v);
  if (request) return `${request[1]} ${pagePattern(request[2]!)}`;
  if (v.startsWith('/')) return pagePattern(v);
  return redactText(v, 300) || null;
}

const trimmed = (v: string | null | undefined, max: number) => {
  const t = redactText((v ?? '').trim(), max).trim();
  return t ? t : null;
};

/** One report as sent, checked and reduced; null when it is to be left out. */
function reduce(raw: unknown): ClientReport | null {
  const parsed = reportSchema.safeParse(raw);
  if (!parsed.success) return null;
  const r = parsed.data;
  if (!DETAILS[r.kind].includes(r.detail)) return null;
  if (isExtensionSource(r.stack) || isExtensionSource(r.resource) || isExtensionSource(r.message)) return null;
  const message = trimmed(r.message, MAX_MESSAGE);
  if (message && NOISE.test(message)) return null;
  return {
    kind: r.kind,
    detail: r.detail,
    message,
    stack: trimmed(r.stack, MAX_STACK),
    page: pagePattern(r.page ?? ''),
    resource: reducedResource(r.resource),
    directive: r.directive ? (/^[a-z-]{1,60}$/.exec(r.directive.trim())?.[0] ?? null) : null,
    tag: r.tag ?? null,
    value: r.value ?? null,
    count: r.count ?? 1,
    version: r.version && VERSION.test(r.version) ? r.version : null,
    screen: r.screen && SCREEN.test(r.screen) ? r.screen : null,
    ...timingOf(r),
  };
}

function jsonOf(body: unknown): unknown {
  if (typeof body !== 'string') return body;
  try {
    return JSON.parse(body) as unknown;
  } catch {
    return null;
  }
}

/** The page's batch ({ reports: [...] }, sent as JSON text): each report checked on its own, at most 20. */
export function parseClientBatch(body: unknown): ClientReport[] {
  const value = jsonOf(body) as { reports?: unknown } | null;
  if (!value || typeof value !== 'object' || !Array.isArray(value.reports)) return [];
  const out: ClientReport[] = [];
  for (const raw of value.reports.slice(0, MAX_REPORTS_PER_BATCH * 2)) {
    const r = reduce(raw);
    if (r) out.push(r);
    if (out.length >= MAX_REPORTS_PER_BATCH) break;
  }
  return out;
}

/** What a violation blocked, reduced: inline / eval / data / an address without its query. */
function blockedTarget(blocked: string): string {
  const b = blocked.trim();
  if (/^[a-z-]+$/i.test(b)) return b.toLowerCase(); // inline, eval, wasm-eval, data, blob, self
  return redactText(b.replace(/[?#].*$/, ''), 300);
}

/** One violation, from either report format, as a BLOCKED report; null when it is noise. */
function violation(v: { document?: unknown; blocked?: unknown; directive?: unknown; source?: unknown }): ClientReport | null {
  const blocked = typeof v.blocked === 'string' ? v.blocked : '';
  const directive = typeof v.directive === 'string' ? v.directive.trim().split(/\s+/)[0]!.toLowerCase() : '';
  if (!directive || !/^[a-z-]{1,60}$/.test(directive)) return null;
  // Not the site's: browser extensions. Not a block: Hostinger's upgrade-insecure-requests at work.
  if (isExtensionSource(blocked) || isExtensionSource(typeof v.source === 'string' ? v.source : '')) return null;
  if (directive === 'upgrade-insecure-requests' || /^http:\/\//i.test(blocked)) return null;
  return {
    kind: 'BLOCKED',
    detail: 'csp-report',
    message: null,
    stack: null,
    page: pagePattern(typeof v.document === 'string' ? v.document : ''),
    resource: blockedTarget(blocked) || null,
    directive,
    tag: null,
    value: null,
    count: 1,
    version: null,
    screen: null,
  };
}

/**
 * The browser's own security-policy reports: `application/csp-report` ({ "csp-report": {…} }, from
 * report-uri) or `application/reports+json` ([{ type: "csp-violation", body: {…} }], from report-to).
 */
export function parseCspReports(body: unknown): ClientReport[] {
  const value = jsonOf(body);
  const out: ClientReport[] = [];
  const push = (r: ClientReport | null) => {
    if (r && out.length < MAX_REPORTS_PER_BATCH) out.push(r);
  };
  if (Array.isArray(value)) {
    for (const entry of value.slice(0, 100)) {
      const e = entry as { type?: unknown; body?: Record<string, unknown> } | null;
      if (!e || e.type !== 'csp-violation' || !e.body || typeof e.body !== 'object') continue;
      push(violation({ document: e.body.documentURL, blocked: e.body.blockedURL, directive: e.body.effectiveDirective, source: e.body.sourceFile }));
    }
    return out;
  }
  const report = (value as { 'csp-report'?: unknown } | null)?.['csp-report'];
  if (report && typeof report === 'object') {
    const r = report as Record<string, unknown>;
    push(violation({ document: r['document-uri'], blocked: r['blocked-uri'], directive: r['effective-directive'] ?? r['violated-directive'], source: r['source-file'] }));
  }
  return out;
}
