import type { BadgeTone } from '../ui/Badge';
import type { ErrorGroup, ErrorKind, ErrorKindFilter, ErrorOccurrence, ErrorRange } from '../../api/error-log';

/** Each row's kind as its badge says it. */
export const KIND_WORDS: Record<ErrorKind, { label: string; tone: BadgeTone }> = {
  ERROR: { label: 'Error', tone: 'danger' },
  NETWORK: { label: 'Network', tone: 'warning' },
  BLOCKED: { label: 'Blocked', tone: 'warning' },
  SLOW: { label: 'Slow', tone: 'info' },
  SERVER: { label: 'Server', tone: 'brand' },
};

/** The filter chips: Errors include network problems (a request or the live connection blocked on the way). */
export const KIND_FILTERS: { key: ErrorKindFilter; label: string; hint: string }[] = [
  { key: 'all', label: 'All', hint: 'Everything' },
  { key: 'errors', label: 'Errors', hint: 'Errors in the page, and requests blocked on the way' },
  { key: 'blocked', label: 'Blocked', hint: 'Files and scripts the browser or the security policy stopped' },
  { key: 'slow', label: 'Slow', hint: 'Slow pages, clicks and requests' },
  { key: 'server', label: 'Server', hint: 'Failed requests and background jobs on the server' },
];

export const RANGES: { key: ErrorRange; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: '7d', label: '7 days' },
  { key: '30d', label: '30 days' },
];

export const timesText = (n: number) => `${n.toLocaleString('en-US')} ${n === 1 ? 'time' : 'times'}`;

/** People affected; a server job happens to no one. */
export function peopleText(group: Pick<ErrorGroup, 'people' | 'kind'>): string {
  if (group.people === 0) return group.kind === 'SERVER' ? 'No one in particular' : 'No one signed in';
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
  job: 'Background job',
  background: 'Background step on the server',
};
export const detailText = (detail: string | null) => (detail ? (DETAIL_WORDS[detail] ?? detail) : '');

/** Who it happened to. */
export function personText(e: Pick<ErrorOccurrence, 'person' | 'kind' | 'job'>): string {
  if (e.person) return e.person.name ?? 'Someone no longer here';
  if (e.kind === 'SERVER') return e.job ? 'Background job' : '—';
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
