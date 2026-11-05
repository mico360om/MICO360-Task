import { parseClientBatch, parseCspReports, type ClientReport } from './client-reports';
import { databaseDiagnosis } from './db-error';
import { redactText } from './error-redact';
import { describeReport, isNewerVersion, isVersion, kindsFor, sinceFor, type ErrorKind, type KindFilter, type RangeFilter } from './error-log-rules';
import type { ErrorEventRow, ErrorGroupRow, ErrorLogRepository, NewEvent } from './error-log-repository';
import { isFrameLine, MAX_FRAMES, resolveStack, type MapStore, type TopFrame } from './stack';
import { describeUserAgent } from './user-agent';

/** How long the Error log keeps what it was told. */
export const KEEP_DAYS = 30;
/** A violation the page and the browser both reported counts once when they come this close together. */
const SAME_VIOLATION_MS = 3 * 60 * 1000;
/** Reports being written at once; more are dropped (a slow database must not pile up memory). */
const MAX_IN_FLIGHT = 200;
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

/**
 * The address a sender is counted by: an IPv4 address as it is (also written IPv4-mapped), an IPv6
 * address by its /64 (one home or office line has a whole /64 to pick addresses from).
 */
export function addressKey(ip: string | null | undefined): string {
  const a = String(ip ?? '').trim().toLowerCase();
  if (!a) return 'unknown';
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(a);
  if (mapped) return mapped[1]!;
  if (!a.includes(':')) return a;
  const [head = '', tail = ''] = a.split('::');
  const left = head ? head.split(':') : [];
  const right = a.includes('::') && tail ? tail.split(':') : [];
  const groups = a.includes('::') ? [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill('0'), ...right] : left;
  return `${groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, '')).join(':')}::/64`;
}

/** Cut a value to its column's size. */
const clip = (v: string | null | undefined, n: number): string | null => (v ? v.slice(0, n) : null);

export interface ErrorLogServiceDeps {
  repo: ErrorLogRepository;
  maps: MapStore;
  now?: () => Date;
  /** The company time zone ("Today" starts at its midnight). */
  timeZone: string;
  /** The running server's version (server errors carry it, and a browser report that says none); null until known. */
  serverVersion: () => string | null;
  /** System Settings → "Collect browser errors" (on unless an administrator turned it off). */
  collecting: () => Promise<boolean>;
  /** The Error log's own trouble, written as a plain warning line — never as an error (no loop). */
  warn: (message: string, meta?: Record<string, unknown>) => void;
  /** People's names for the details' latest occurrences. */
  userNames?: (ids: string[]) => Promise<Map<string, string>>;
  limits?: {
    /** Requests a minute from one address (a page sends a batch at most every 10 seconds). */
    perAddressPerMinute?: number;
    /** Reports a minute from one address, and from everyone together. */
    reportsPerAddressPerMinute?: number;
    reportsPerMinute?: number;
    /** New rows an hour; after that only rows already there are added to (the log can't be buried). */
    newRowsPerHour?: number;
    /** Server errors a minute. */
    serverPerMinute?: number;
  };
}

export interface GroupListItem {
  id: string;
  kind: ErrorKind;
  title: string;
  count: number;
  /** People affected. */
  people: number;
  firstSeenAt: Date;
  lastSeenAt: Date;
  /** The most common page (a route pattern; a job's name for a background job). */
  page: string | null;
  version: string | null;
  status: 'OPEN' | 'FIXED';
  fixedAt: Date | null;
  fixedInVersion: string | null;
  reopenedAt: Date | null;
}

export interface ListQuery {
  kind: KindFilter;
  range: RangeFilter;
  q: string | null;
  status: 'open' | 'fixed';
  before: string | null;
  limit?: number;
}

/** A small per-key counter of the current minute. */
function minuteCounter(now: () => Date) {
  const seen = new Map<string, { start: number; n: number }>();
  return (key: string, max: number): boolean => {
    const t = now().getTime();
    const c = seen.get(key);
    if (!c || t - c.start >= MINUTE) {
      if (seen.size > 10_000) for (const [k, v] of seen) if (t - v.start >= MINUTE) seen.delete(k);
      seen.set(key, { start: t, n: 1 });
      return true;
    }
    if (c.n >= max) return false;
    c.n += 1;
    return true;
  };
}

const errorText = (err: unknown): { message: string | null; stack: string | null } => {
  if (err instanceof Error) return { message: err.message || err.name, stack: err.stack ?? null };
  if (typeof err === 'string') return { message: err, stack: null };
  if (err && typeof err === 'object') {
    const e = err as { message?: unknown; stack?: unknown };
    return { message: typeof e.message === 'string' ? e.message : null, stack: typeof e.stack === 'string' ? e.stack : null };
  }
  return { message: null, stack: null };
};

/**
 * The Error log (1.22.4): what browsers report (errors, blocked files and scripts, slow pages) and
 * the server's own errors (failed requests, background jobs), grouped into rows, kept 30 days, read on
 * System Settings → Error log. Nothing here may harm a page or the server: every way in answers at
 * once, works in the background, drops what is over its limits and writes its own trouble as a warning.
 */
export function createErrorLogService(deps: ErrorLogServiceDeps) {
  const now = deps.now ?? (() => new Date());
  const perAddress = deps.limits?.perAddressPerMinute ?? 60;
  const reportsPerAddress = deps.limits?.reportsPerAddressPerMinute ?? 120;
  const reportsPerMinute = deps.limits?.reportsPerMinute ?? 1000;
  const newRowsPerHour = deps.limits?.newRowsPerHour ?? 300;
  const serverPerMinute = deps.limits?.serverPerMinute ?? 120;
  const allowAddress = minuteCounter(now);
  const allowAddressReport = minuteCounter(now);
  const allowReport = minuteCounter(now);
  const allowServer = minuteCounter(now);
  let newRows = { start: 0, n: 0 };
  /** Kept with a report: its own version, unless it says none or one newer than the server's (not believed). */
  const versionOf = (v: string | null): string | null => {
    const server = deps.serverVersion();
    const known = server && isVersion(server) ? server : null;
    if (!v) return known;
    return known && isNewerVersion(v, known) ? known : v;
  };
  /**
   * Write one occurrence: a new row only while under the hour's limit. The slot is taken before the
   * write (writes run side by side) and given back when the row was already there.
   */
  async function store(o: Parameters<ErrorLogRepository['record']>[0]): Promise<void> {
    const t = now().getTime();
    if (t - newRows.start >= HOUR) newRows = { start: t, n: 0 };
    const may = newRows.n < newRowsPerHour;
    if (may) newRows.n += 1;
    const done = await deps.repo.record(o, { create: may });
    if (may && !done?.created) newRows.n = Math.max(0, newRows.n - 1);
  }
  const pending = new Set<Promise<void>>();
  const violations = new Map<string, { at: number; channel: 'page' | 'browser' }>();

  /** Run in the background; the Error log's own failure is a warning line. */
  function background(what: string, work: () => Promise<void>): boolean {
    if (pending.size >= MAX_IN_FLIGHT) return false;
    const p = (async () => {
      try {
        await work();
      } catch (err) {
        try {
          deps.warn(`error log: ${what} could not be kept`, { error: err instanceof Error ? err.message : String(err) });
        } catch {
          // Even the warning failing changes nothing for the page or the server.
        }
      }
    })();
    pending.add(p);
    void p.finally(() => pending.delete(p));
    return true;
  }

  /** Is this the second report of one violation (the page's and the browser's own)? */
  function sameViolation(key: string, channel: 'page' | 'browser'): boolean {
    const t = now().getTime();
    if (violations.size > 5000) for (const [k, v] of violations) if (t - v.at > SAME_VIOLATION_MS) violations.delete(k);
    const seen = violations.get(key);
    if (seen && seen.channel !== channel && t - seen.at <= SAME_VIOLATION_MS) {
      violations.delete(key);
      return true;
    }
    violations.set(key, { at: t, channel });
    return false;
  }

  async function keep(r: ClientReport, who: { userId: string | null; browser: string; system: string; ip: string }): Promise<void> {
    let stack = r.stack;
    let top: TopFrame | null = null;
    if (r.kind === 'ERROR' && r.stack) {
      const resolved = await resolveStack(r.stack, deps.maps);
      stack = redactText(resolved.stack, 4096);
      top = resolved.top;
    }
    const d = describeReport({ ...r, top });
    let count = r.count;
    if (r.kind === 'BLOCKED' && r.detail !== 'resource') {
      // One violation, reported by the page and by the browser itself, counts once. The page's copy
      // is the useful one (who, which version): when the browser's came first, the page's still
      // adds its person and version to the row, without counting again.
      const channel = r.detail === 'csp-report' ? 'browser' : 'page';
      if (sameViolation(`${d.key}|${addressKey(who.ip)}|${who.browser}`, channel)) {
        if (channel === 'browser') return;
        count = 0;
      }
    }
    const event: NewEvent = {
      at: now(),
      kind: r.kind,
      detail: r.detail,
      message: d.title.slice(0, 500),
      stack,
      page: clip(r.page, 300),
      job: null,
      resource: clip(r.resource, 300),
      value: r.value,
      count,
      version: clip(versionOf(r.version), 32),
      browser: clip(who.browser, 60),
      system: clip(who.system, 40),
      screen: clip(r.screen, 20),
      userId: who.userId,
      signedIn: !!who.userId,
    };
    await store({ fingerprint: d.key, kind: r.kind, title: d.groupTitle.slice(0, 500), topFile: clip(top?.file, 300), topLine: top?.line ?? null, topFunction: clip(top?.fn, 120), event });
  }

  function accept(reports: () => ClientReport[], who: { ip: string; userAgent: string | undefined; userId: string | null }): boolean {
    try {
      const key = addressKey(who.ip);
      if (!allowAddress(key, perAddress)) return false;
      return background('a browser report', async () => {
        if (!(await deps.collecting())) return;
        const { browser, system } = describeUserAgent(who.userAgent);
        for (const r of reports()) {
          // Counted by the report, from this address and from everyone together.
          if (!allowAddressReport(key, reportsPerAddress) || !allowReport('all', reportsPerMinute)) break;
          await keep(r, { userId: who.userId, browser, system, ip: who.ip });
        }
      });
    } catch {
      return false;
    }
  }

  /** The page's batch (POST /client-errors). True when it was taken (not over the address's limit). */
  function acceptClientBatch(input: { body: unknown; ip: string; userAgent: string | undefined; userId: string | null }): boolean {
    return accept(() => parseClientBatch(input.body), input);
  }

  /** The browser's own security-policy reports (POST /client-errors/csp); never signed in. */
  function acceptCspReports(input: { body: unknown; ip: string; userAgent: string | undefined }): boolean {
    return accept(() => parseCspReports(input.body), { ...input, userId: null });
  }

  /**
   * A server error, from the logger's error lines (lib/error-log-logger.ts): a failed request ("request
   * failed" with its route pattern — never the address, which can carry a token), a background job
   * (`job`, or a search sweep's `sweep`) or another background step. Never throws.
   *
   * 1.22.5 — a database error (Prisma's) also keeps its diagnosis: Prisma's code, the database's code
   * and its message with the values masked (db-error.ts), shown as "Database said: …" and kept in the
   * occurrence's `resource` (a server error has no other use for it). The codes are part of the row's
   * key, so two different database errors at one line are two rows; any other error keeps its old key.
   */
  function recordServer(message: string, ctx?: Record<string, unknown>): void {
    try {
      if (!allowServer('server', serverPerMinute)) return;
      const read = (k: string): unknown => (ctx ? ctx[k] : undefined);
      const job = typeof read('job') === 'string' ? (read('job') as string) : typeof read('sweep') === 'string' ? (read('sweep') as string) : null;
      const route = typeof read('route') === 'string' ? (read('route') as string) : null;
      const method = typeof read('method') === 'string' ? (read('method') as string) : null;
      const userId = typeof read('userId') === 'string' ? (read('userId') as string) : null;
      const thrown = read('err') ?? read('error');
      const e = errorText(thrown);
      const db = databaseDiagnosis(thrown);
      // Only the first line of the error's message, and only the frames of its stack: the rest of a
      // message can quote what someone typed (a database error prints the values it was given).
      const first = (e.message ?? '').split('\n').map((l) => l.trim()).find(Boolean)?.slice(0, 300) ?? '';
      const frames = (e.stack ?? '').split('\n').filter(isFrameLine).slice(0, MAX_FRAMES).join('\n');
      const request = !!route || message === 'request failed';
      const title = redactText(request ? first || message : first ? `${message}: ${first}` : message, 500);
      const at = now();
      const version = clip(versionOf(null), 32);
      background('a server error', async () => {
        const resolved = frames ? await resolveStack(frames, deps.maps) : { stack: '', top: null };
        // A request by its route pattern (never its address, which can carry a token).
        const page = request ? clip(`${method ?? ''} ${route ?? '(no route)'}`.trim(), 300) : null;
        const cause = db ? [db.code, db.dbCode].filter(Boolean).join('/') : '';
        const d = describeReport({ kind: 'SERVER', message: title, job, route: page, top: resolved.top, cause: cause || null });
        await store({
          fingerprint: d.key,
          kind: 'SERVER',
          title: d.groupTitle,
          topFile: clip(resolved.top?.file, 300),
          topLine: resolved.top?.line ?? null,
          topFunction: clip(resolved.top?.fn, 120),
          event: {
            at,
            kind: 'SERVER',
            detail: request ? 'request' : job ? 'job' : 'background',
            message: d.title,
            stack: resolved.stack ? redactText(resolved.stack, 4096) : null,
            page,
            job: job ? job.slice(0, 100) : null,
            resource: clip(db?.text, 300),
            value: null,
            count: 1,
            version,
            browser: null,
            system: null,
            screen: null,
            userId,
            signedIn: !!userId,
          },
        });
      });
    } catch {
      // Recording a server error can never be a second failure.
    }
  }

  const toItem = (g: ErrorGroupRow, page: string | null): GroupListItem => ({
    id: g.id,
    kind: g.kind,
    title: g.title,
    count: g.count,
    people: g.peopleCount,
    firstSeenAt: g.firstSeenAt,
    lastSeenAt: g.lastSeenAt,
    page,
    version: g.lastVersion,
    status: g.status,
    fixedAt: g.fixedAt,
    fixedInVersion: g.fixedInVersion,
    reopenedAt: g.reopenedAt,
  });

  function cursorOf(before: string | null): { lastSeenAt: Date; id: string } | null {
    const m = /^(\d{4}-\d\d-\d\dT[\d:.]+Z)\|([A-Za-z0-9_-]{1,64})$/.exec(before ?? '');
    if (!m) return null;
    const at = new Date(m[1]!);
    return Number.isNaN(at.getTime()) ? null : { lastSeenAt: at, id: m[2]! };
  }

  /** The page's rows for a filter, newest first, with the chips' numbers and the next page's cursor. */
  async function list(q: ListQuery) {
    const limit = Math.min(Math.max(q.limit ?? 50, 1), 100);
    const since = sinceFor(q.range, now(), deps.timeZone);
    const status = q.status === 'fixed' ? 'FIXED' : 'OPEN';
    const search = q.q?.trim().slice(0, 100) || null;
    const [rows, byKind] = await Promise.all([
      deps.repo.list({ kinds: kindsFor(q.kind), since, search, status, limit: limit + 1, before: cursorOf(q.before) }),
      deps.repo.countsByKind(since, status),
    ]);
    const shown = rows.slice(0, limit);
    const pages = await deps.repo.topPages(shown.map((g) => g.id));
    const last = shown[shown.length - 1];
    const n = (k: ErrorKind) => byKind[k] ?? 0;
    return {
      groups: shown.map((g) => toItem(g, pages.get(g.id) ?? null)),
      next: rows.length > limit && last ? `${last.lastSeenAt.toISOString()}|${last.id}` : null,
      counts: { all: n('ERROR') + n('NETWORK') + n('BLOCKED') + n('SLOW') + n('SERVER'), errors: n('ERROR') + n('NETWORK'), blocked: n('BLOCKED'), slow: n('SLOW'), server: n('SERVER') },
    };
  }

  /** One row: its top frame, and its latest occurrences with each person's name (null: no longer here). */
  async function detail(id: string) {
    const group = await deps.repo.get(id);
    if (!group) return null;
    const [events, pages] = await Promise.all([deps.repo.events(id), deps.repo.topPages([id])]);
    const ids = [...new Set(events.map((e) => e.userId).filter((u): u is string => !!u))];
    const names = ids.length && deps.userNames ? await deps.userNames(ids).catch(() => new Map<string, string>()) : new Map<string, string>();
    return {
      group: { ...toItem(group, pages.get(id) ?? null), topFile: group.topFile, topLine: group.topLine, topFunction: group.topFunction },
      events: events.map((e: ErrorEventRow) => ({
        id: e.id,
        at: e.at,
        kind: e.kind,
        detail: e.detail,
        message: e.message,
        stack: e.stack,
        page: e.page,
        job: e.job,
        // A server error's resource is its database diagnosis (1.22.5): the page says "Database said: …".
        resource: e.kind === 'SERVER' ? null : e.resource,
        database: e.kind === 'SERVER' ? e.resource : null,
        value: e.value,
        count: e.count,
        version: e.version,
        browser: e.browser,
        system: e.system,
        screen: e.screen,
        signedIn: e.signedIn,
        person: e.userId ? { id: e.userId, name: names.get(e.userId) ?? null } : null,
      })),
    };
  }

  /**
   * Mark as fixed: hidden until it happens again in a newer version than the newest it was seen in
   * (without a real version, until it happens again at all).
   */
  async function markFixed(id: string, by: string) {
    const group = await deps.repo.get(id);
    if (!group) return null;
    const version = group.lastVersion && isVersion(group.lastVersion) ? group.lastVersion : versionOf(null);
    return deps.repo.setFixed(id, by, version, now());
  }

  /** "Not fixed": back on the list. */
  async function reopen(id: string) {
    return deps.repo.setOpen(id);
  }

  /** The administrator opened the page: their previous visit (for "new since your last visit"), and now kept. */
  async function visit(userId: string): Promise<Date | null> {
    const previous = await deps.repo.lastVisit(userId);
    await deps.repo.setLastVisit(userId, now());
    return previous;
  }

  /** The daily clean-up: occurrences older than 30 days, and rows not seen in 30 days. */
  async function sweep() {
    return deps.repo.prune(new Date(now().getTime() - KEEP_DAYS * 24 * 60 * 60 * 1000));
  }

  /** Resolves once everything taken so far is written (tests; a clean shutdown). */
  async function settled(): Promise<void> {
    while (pending.size) await Promise.all([...pending]);
  }

  /** Whether browsers should send at all (the reporter is told on each answer). */
  async function collectingNow(): Promise<boolean> {
    try {
      return await deps.collecting();
    } catch {
      return true;
    }
  }

  return { acceptClientBatch, acceptCspReports, recordServer, list, detail, markFixed, reopen, visit, sweep, settled, collectingNow };
}

export type ErrorLogService = ReturnType<typeof createErrorLogService>;
