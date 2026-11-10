import type { BadgeTone } from '../ui/Badge';
import type { ErrorGroup, ErrorKind, ErrorKindFilter, ErrorOccurrence, ErrorRange, SlowTiming } from '../../api/error-log';

/** Each row's kind as its badge says it. */
export const KIND_WORDS: Record<ErrorKind, { label: string; tone: BadgeTone }> = {
  ERROR: { label: 'Error', tone: 'danger' },
  NETWORK: { label: 'Network', tone: 'warning' },
  BLOCKED: { label: 'Blocked', tone: 'warning' },
  SLOW: { label: 'Slow', tone: 'info' },
  SERVER: { label: 'Server', tone: 'brand' },
  // 1.23.14: an update restart is not an error — a calm, grey badge.
  UPDATE: { label: 'Update restart', tone: 'neutral' },
};

/** The filter chips: Errors include network problems (a request or the live connection blocked on the way). */
export const KIND_FILTERS: { key: ErrorKindFilter; label: string; hint: string }[] = [
  { key: 'all', label: 'All', hint: 'Everything' },
  { key: 'errors', label: 'Errors', hint: 'Errors in the page, and requests blocked on the way' },
  { key: 'blocked', label: 'Blocked', hint: 'Files and scripts the browser or the security policy stopped' },
  { key: 'slow', label: 'Slow', hint: 'Slow pages, clicks and requests' },
  { key: 'server', label: 'Server', hint: 'Failed requests and background jobs on the server, and update restarts' },
];

export const RANGES: { key: ErrorRange; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: '7d', label: '7 days' },
  { key: '30d', label: '30 days' },
];

export const timesText = (n: number) => `${n.toLocaleString('en-US')} ${n === 1 ? 'time' : 'times'}`;

/** People affected; a server job happens to no one. */
export function peopleText(group: Pick<ErrorGroup, 'people' | 'kind'>): string {
  if (group.people === 0) return group.kind === 'SERVER' || group.kind === 'UPDATE' ? 'No one in particular' : 'No one signed in';
  if (group.people >= 500) return '500+ people';
  return `${group.people} ${group.people === 1 ? 'person' : 'people'}`;
}

/** First seen, or back after "Mark as fixed", since the administrator's previous visit. */
export function isNewSince(group: Pick<ErrorGroup, 'firstSeenAt' | 'reopenedAt'>, previousVisitAt: string | null | undefined): boolean {
  if (!previousVisitAt) return false;
  const since = Date.parse(previousVisitAt);
  if (Number.isNaN(since)) return false;
  return Date.parse(group.firstSeenAt) > since || (!!group.reopenedAt && Date.parse(group.reopenedAt) > since);
}

/** How an occurrence was noticed. */
const DETAIL_WORDS: Record<string, string> = {
  error: 'Uncaught error',
  rejection: 'Unhandled promise',
  boundary: 'Caught by the page (it showed “Something went wrong”)',
  chunk: 'The site’s code didn’t load (a page left open over an update?)',
  api: 'Request',
  socket: 'Live connection',
  resource: 'Site file',
  csp: 'Seen by the page',
  'csp-report': 'Reported by the browser',
  load: 'Page load',
  lcp: 'Showing the page',
  inp: 'Answering a click or key',
  cls: 'Layout jumping',
  request: 'Request on the server',
  slow: 'Request held up while the server started',
  job: 'Background job',
  background: 'Background step on the server',
};
export const detailText = (detail: string | null) => (detail ? (DETAIL_WORDS[detail] ?? detail) : '');

/** Who it happened to. */
export function personText(e: Pick<ErrorOccurrence, 'person' | 'kind' | 'job'>): string {
  if (e.person) return e.person.name ?? 'Someone no longer here';
  if (e.kind === 'SERVER' || e.kind === 'UPDATE') return e.job ? 'Background job' : '—';
  return 'Not signed in';
}

/** Browser and system ("Chrome 130 on Windows"). */
export function browserText(e: Pick<ErrorOccurrence, 'browser' | 'system'>): string {
  if (!e.browser && !e.system) return '';
  if (!e.system) return e.browser ?? '';
  if (!e.browser) return e.system;
  return `${e.browser} on ${e.system}`;
}

/** Where: the page (a route pattern), the request, or the job's name. */
export function placeText(e: Pick<ErrorOccurrence, 'page' | 'job'>): string {
  return e.job ?? e.page ?? '';
}

/** Seconds to a tenth, like the Error log's own titles ("took 10.2 s"); a sliver is "under 0.1 s". */
const secondsText = (ms: number) => (ms < 50 ? 'under 0.1 s' : `${(ms / 1000).toFixed(1)} s`);

/**
 * 1.23.3 — where a slow request's time went, from its Server-Timing: "server 9.9 s · in the database
 * 9.7 s", or "server 0.1 s · the rest was the network". The database's part is said when the server's
 * part matters (a second or more); the network when the server's part is under half of the whole wait.
 */
export function slowTimingText(t: SlowTiming | null | undefined): string {
  if (!t) return '';
  if (t.waitMs !== undefined) return breakdownText(t);
  if (t.serverMs === null) return '';
  const parts = [`server ${secondsText(t.serverMs)}`];
  if (t.dbMs !== null && (t.serverMs >= 1000 || t.dbMs >= 1000)) parts.push(`in the database ${secondsText(t.dbMs)}`);
  if (t.totalMs !== null && t.serverMs < t.totalMs / 2) parts.push('the rest was the network');
  return parts.join(' · ');
}

/**
 * 1.23.14 — where the time went, from the browser's own timing: its biggest part in plain words. Waiting for
 * the first byte is split by the server's own time: the server's work, or a hold-up on the way (the
 * hosting's front door or the connection).
 */
function breakdownText(t: SlowTiming): string {
  const queue = t.queueMs ?? 0;
  const connect = t.connectMs ?? 0;
  const wait = t.waitMs ?? 0;
  const download = t.downloadMs ?? 0;
  const biggest = Math.max(queue, connect, wait, download);
  if (biggest === wait) {
    if (t.serverMs === null) return `waited ${secondsText(wait)} before the server started answering (the server didn’t say its own time)`;
    if (t.serverMs >= wait - t.serverMs) {
      const db = t.dbMs !== null && (t.serverMs >= 1000 || t.dbMs >= 1000) ? ` · in the database ${secondsText(t.dbMs)}` : '';
      return `the server took ${secondsText(t.serverMs)}${db}`;
    }
    return `waited ${secondsText(wait)} before the server started answering; the server itself took ${secondsText(t.serverMs)} — the hold-up was between the browser and the server (the hosting’s front door or the connection)`;
  }
  if (biggest === download) return `downloading the answer took ${secondsText(download)}`;
  if (biggest === connect) return `connecting to the server took ${secondsText(connect)} (a slow or changing connection)`;
  return `the browser waited ${secondsText(queue)} before sending it (no free connection)`;
}

/** 1.23.14 — each part of a request's time, for its occurrence ("Waiting for a connection … · downloading …"); '' for older reports. */
export function partsText(t: SlowTiming | null | undefined): string {
  if (!t || t.waitMs === undefined) return '';
  return [
    `Waiting for a connection ${secondsText(t.queueMs ?? 0)}`,
    `connecting ${secondsText(t.connectMs ?? 0)}`,
    `waiting for the first byte ${secondsText(t.waitMs)}`,
    `downloading ${secondsText(t.downloadMs ?? 0)}`,
  ].join(' · ');
}

/**
 * 1.23.14 — a page-show row (largest content, page load) says how its times are counted: only while the
 * page is on screen; the rows kept from before may include time it spent in the background.
 */
export function pageTimeNote(g: Pick<ErrorGroup, 'kind' | 'title'>): string {
  if (g.kind !== 'SLOW' || !/^(Slow to show the page|Slow page load)\b/.test(g.title)) return '';
  return 'Counted only while the page is on screen — older entries may include time it spent in the background.';
}

/** 1.23.14 — what a slow click or key press was on ("On a click on a button"); '' for anything else. */
export function interactionWords(e: Pick<ErrorOccurrence, 'detail' | 'resource'>): string {
  return e.detail === 'inp' && e.resource ? `On ${e.resource}` : '';
}

/** A slow request's row: where the last time's wait went ("Last time 10.2 s: server 9.9 s · …"). */
export function lastTimeText(t: SlowTiming | null | undefined): string {
  if (!t) return '';
  return `Last time${t.totalMs !== null ? ` ${secondsText(t.totalMs)}` : ''}: ${slowTimingText(t)}`;
}

/** A database error's diagnosis (1.22.5), as an occurrence shows it. */
export function databaseText(e: Pick<ErrorOccurrence, 'database'>): string {
  return e.database ? `Database said: ${e.database}` : '';
}

/** The site's own file:line and function, when known. */
export function topFrameText(g: { topFile: string | null; topLine: number | null; topFunction: string | null }): string {
  if (!g.topFile) return '';
  const at = g.topLine ? `${g.topFile}:${g.topLine}` : g.topFile;
  return g.topFunction ? `${at} (${g.topFunction})` : at;
}
