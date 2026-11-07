import { comesBack, isNewerVersion, isVersion, type ErrorKind } from './error-log-rules';

/** One row of the Error log: the same error, however many times it happened. */
export interface ErrorGroupRow {
  id: string;
  fingerprint: string;
  kind: ErrorKind;
  title: string;
  /** The site's own top frame: its original file, line (of the latest) and function. */
  topFile: string | null;
  topLine: number | null;
  topFunction: string | null;
  count: number;
  /** The distinct people it happened to (ids, up to PEOPLE_KEPT). */
  people: string[];
  peopleCount: number;
  firstSeenAt: Date;
  lastSeenAt: Date;
  /** The newest version it happened in. */
  lastVersion: string | null;
  status: 'OPEN' | 'FIXED';
  fixedAt: Date | null;
  fixedById: string | null;
  fixedInVersion: string | null;
  /** When it came back (a newer version) after being marked fixed. */
  reopenedAt: Date | null;
}

/** One occurrence (the group keeps its newest EVENTS_KEPT). */
export interface ErrorEventRow {
  id: string;
  groupId: string;
  at: Date;
  kind: ErrorKind;
  detail: string | null;
  message: string;
  stack: string | null;
  /** The page's route pattern; a server request's "GET /api/v1/…" route. */
  page: string | null;
  /** A background job's name (server errors). */
  job: string | null;
  /** A blocked file or address, or a slow request; a server error's database diagnosis (1.22.5, db-error.ts). */
  resource: string | null;
  value: number | null;
  count: number;
  version: string | null;
  browser: string | null;
  system: string | null;
  screen: string | null;
  userId: string | null;
  signedIn: boolean;
}

export type NewEvent = Omit<ErrorEventRow, 'id' | 'groupId'>;

export interface NewOccurrence {
  fingerprint: string;
  kind: ErrorKind;
  title: string;
  topFile: string | null;
  topLine: number | null;
  topFunction: string | null;
  event: NewEvent;
}

export interface GroupQuery {
  kinds: ErrorKind[] | null;
  since: Date;
  search: string | null;
  status: 'OPEN' | 'FIXED';
  limit: number;
  /** The next page: groups seen before this one (lastSeenAt, then id). */
  before: { lastSeenAt: Date; id: string } | null;
}

export interface ErrorLogRepository {
  /**
   * Adds one occurrence to its group (made on first sight, unless `create` is false — then null when
   * there is no such group yet); a fixed group comes back from a newer version.
   */
  record(o: NewOccurrence, opts?: { create?: boolean }): Promise<{ groupId: string; created: boolean; reopened: boolean } | null>;
  list(q: GroupQuery): Promise<ErrorGroupRow[]>;
  /** How many open groups of each kind were seen since a time (the filter chips' numbers). */
  countsByKind(since: Date, status: 'OPEN' | 'FIXED'): Promise<Partial<Record<ErrorKind, number>>>;
  /** Each group's most common page (or job) among its kept events. */
  topPages(groupIds: string[]): Promise<Map<string, string>>;
  /** 1.23.3: each group's newest kept event's value and stack (a slow request's row shows its timing). */
  newest(groupIds: string[]): Promise<Map<string, Pick<ErrorEventRow, 'value' | 'stack'>>>;
  get(id: string): Promise<ErrorGroupRow | null>;
  /** A group's kept events, newest first. */
  events(groupId: string): Promise<ErrorEventRow[]>;
  setFixed(id: string, by: string, version: string | null, at: Date): Promise<ErrorGroupRow | null>;
  setOpen(id: string): Promise<ErrorGroupRow | null>;
  /** Removes events older than the cutoff, and groups not seen since it. */
  prune(cutoff: Date): Promise<{ groups: number; events: number }>;
  lastVisit(userId: string): Promise<Date | null>;
  setLastVisit(userId: string, at: Date): Promise<void>;
}

/** Each group keeps its newest occurrences, and up to this many people. */
export const EVENTS_KEPT = 20;
export const PEOPLE_KEPT = 500;

/** The group after one more occurrence (the same rule in memory and in MySQL). */
export function nextGroupState(g: ErrorGroupRow, o: NewOccurrence): { patch: Partial<ErrorGroupRow>; reopened: boolean } {
  const e = o.event;
  const reopened = g.status === 'FIXED' && comesBack(g, { version: e.version, at: e.at });
  const newPerson = !!e.userId && !g.people.includes(e.userId);
  const people = newPerson && g.people.length < PEOPLE_KEPT ? [...g.people, e.userId!] : g.people;
  const later = e.at >= g.lastSeenAt;
  return {
    reopened,
    patch: {
      count: g.count + e.count,
      lastSeenAt: later ? e.at : g.lastSeenAt,
      // The newest release seen; a word that isn't a version ("unknown") gives way to the first real one.
      lastVersion: e.version && (!g.lastVersion || !isVersion(g.lastVersion) || isNewerVersion(e.version, g.lastVersion)) ? e.version : g.lastVersion,
      people,
      peopleCount: g.peopleCount + (newPerson ? 1 : 0),
      ...(later ? { title: o.title, topFile: o.topFile ?? g.topFile, topLine: o.topLine ?? g.topLine, topFunction: o.topFunction ?? g.topFunction } : {}),
      ...(reopened ? { status: 'OPEN' as const, reopenedAt: e.at } : {}),
    },
  };
}

/** An in-memory Error log (unit tests, and a server without a database). */
export function createMemoryErrorLogRepository(): ErrorLogRepository & { groups: ErrorGroupRow[]; eventRows: ErrorEventRow[] } {
  const groups: ErrorGroupRow[] = [];
  const eventRows: ErrorEventRow[] = [];
  const visits = new Map<string, Date>();
  let seq = 0;
  const newer = (a: ErrorGroupRow, b: ErrorGroupRow) => b.lastSeenAt.getTime() - a.lastSeenAt.getTime() || (a.id < b.id ? 1 : -1);
  return {
    groups,
    eventRows,
    async record(o, opts) {
      let g = groups.find((x) => x.fingerprint === o.fingerprint);
      let created = false;
      let reopened = false;
      if (!g && opts?.create === false) return null;
      if (!g) {
        created = true;
        g = {
          id: `g${++seq}`,
          fingerprint: o.fingerprint,
          kind: o.kind,
          title: o.title,
          topFile: o.topFile,
          topLine: o.topLine,
          topFunction: o.topFunction,
          count: o.event.count,
          people: o.event.userId ? [o.event.userId] : [],
          peopleCount: o.event.userId ? 1 : 0,
          firstSeenAt: o.event.at,
          lastSeenAt: o.event.at,
          lastVersion: o.event.version,
          status: 'OPEN',
          fixedAt: null,
          fixedById: null,
          fixedInVersion: null,
          reopenedAt: null,
        };
        groups.push(g);
      } else {
        const next = nextGroupState(g, o);
        Object.assign(g, next.patch);
        reopened = next.reopened;
      }
      eventRows.push({ ...o.event, id: `e${++seq}`, groupId: g.id });
      const mine = eventRows.filter((e) => e.groupId === g!.id).sort((a, b) => b.at.getTime() - a.at.getTime());
      for (const old of mine.slice(EVENTS_KEPT)) eventRows.splice(eventRows.indexOf(old), 1);
      return { groupId: g.id, created, reopened };
    },
    async list(q) {
      const s = q.search?.toLowerCase() ?? null;
      return groups
        .filter((g) => g.status === q.status && g.lastSeenAt >= q.since && (!q.kinds || q.kinds.includes(g.kind)))
        .filter((g) => !s || [g.title, g.topFile ?? '', ...eventRows.filter((e) => e.groupId === g.id).map((e) => `${e.page ?? ''} ${e.job ?? ''} ${e.resource ?? ''}`)].some((t) => t.toLowerCase().includes(s)))
        .filter((g) => !q.before || g.lastSeenAt < q.before.lastSeenAt || (g.lastSeenAt.getTime() === q.before.lastSeenAt.getTime() && g.id < q.before.id))
        .sort(newer)
        .slice(0, q.limit)
        .map((g) => ({ ...g, people: [...g.people] }));
    },
    async countsByKind(since, status) {
      const out: Partial<Record<ErrorKind, number>> = {};
      for (const g of groups) if (g.status === status && g.lastSeenAt >= since) out[g.kind] = (out[g.kind] ?? 0) + 1;
      return out;
    },
    async topPages(ids) {
      const out = new Map<string, string>();
      for (const id of ids) {
        const tally = new Map<string, number>();
        for (const e of eventRows) if (e.groupId === id && (e.page ?? e.job)) tally.set((e.page ?? e.job)!, (tally.get((e.page ?? e.job)!) ?? 0) + e.count);
        const best = [...tally].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0];
        if (best) out.set(id, best[0]);
      }
      return out;
    },
    async newest(ids) {
      const out = new Map<string, Pick<ErrorEventRow, 'value' | 'stack'>>();
      const at = new Map<string, number>();
      for (const e of eventRows) {
        if (!ids.includes(e.groupId) || e.at.getTime() < (at.get(e.groupId) ?? -Infinity)) continue;
        at.set(e.groupId, e.at.getTime());
        out.set(e.groupId, { value: e.value, stack: e.stack });
      }
      return out;
    },
    async get(id) {
      const g = groups.find((x) => x.id === id);
      return g ? { ...g, people: [...g.people] } : null;
    },
    async events(groupId) {
      return eventRows.filter((e) => e.groupId === groupId).sort((a, b) => b.at.getTime() - a.at.getTime());
    },
    async setFixed(id, by, version, at) {
      const g = groups.find((x) => x.id === id);
      if (!g) return null;
      Object.assign(g, { status: 'FIXED', fixedAt: at, fixedById: by, fixedInVersion: version });
      return { ...g };
    },
    async setOpen(id) {
      const g = groups.find((x) => x.id === id);
      if (!g) return null;
      Object.assign(g, { status: 'OPEN', fixedAt: null, fixedById: null, fixedInVersion: null });
      return { ...g };
    },
    async prune(cutoff) {
      const before = eventRows.length;
      for (const e of [...eventRows]) if (e.at < cutoff) eventRows.splice(eventRows.indexOf(e), 1);
      let gone = 0;
      for (const g of [...groups]) {
        if (g.lastSeenAt >= cutoff) continue;
        groups.splice(groups.indexOf(g), 1);
        for (const e of [...eventRows]) if (e.groupId === g.id) eventRows.splice(eventRows.indexOf(e), 1);
        gone += 1;
      }
      return { groups: gone, events: before - eventRows.length };
    },
    async lastVisit(userId) {
      return visits.get(userId) ?? null;
    },
    async setLastVisit(userId, at) {
      visits.set(userId, at);
    },
  };
}
