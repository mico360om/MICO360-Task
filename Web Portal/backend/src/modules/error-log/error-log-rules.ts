import { createHash } from 'node:crypto';
import { todayKey, zonedStartOfDay } from '../../lib/due-date';
import { normalizeMessage } from './error-redact';
import { chunkName } from './stack';

/** What a row of the Error log is about. Errors include Network (a request or the live connection blocked on the way). */
export type ErrorKind = 'ERROR' | 'NETWORK' | 'BLOCKED' | 'SLOW' | 'SERVER';
export const ERROR_KINDS: readonly ErrorKind[] = ['ERROR', 'NETWORK', 'BLOCKED', 'SLOW', 'SERVER'];

/** The page's filter chips. */
export type KindFilter = 'all' | 'errors' | 'blocked' | 'slow' | 'server';
export type RangeFilter = 'today' | '7d' | '30d';

/** The kinds a filter chip shows (null: all of them). */
export function kindsFor(filter: KindFilter): ErrorKind[] | null {
  switch (filter) {
    case 'errors':
      return ['ERROR', 'NETWORK'];
    case 'blocked':
      return ['BLOCKED'];
    case 'slow':
      return ['SLOW'];
    case 'server':
      return ['SERVER'];
    default:
      return null;
  }
}

/** The start of a date filter: today from midnight in the company zone; 7 and 30 days back from now. */
export function sinceFor(range: RangeFilter, now: Date, timeZone: string): Date {
  if (range === 'today') return zonedStartOfDay(todayKey(timeZone, now), timeZone);
  const days = range === '7d' ? 7 : 30;
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}

const VERSION = /^(\d+)\.(\d+)\.(\d+)/;

/** A release version (1.22.4), not a word such as "unknown". */
export function isVersion(v: string | null | undefined): boolean {
  return VERSION.test(v ?? '');
}

/** Is `a` a later release than `b`? (Anything that isn't a version is never later.) */
export function isNewerVersion(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = VERSION.exec(a ?? '');
  const y = VERSION.exec(b ?? '');
  if (!x || !y) return false;
  for (let i = 1; i <= 3; i++) {
    const d = Number(x[i]) - Number(y[i]);
    if (d !== 0) return d > 0;
  }
  return false;
}

/**
 * Does a new occurrence bring back an error marked as fixed? Only from a newer version than the one
 * it was fixed in (a tab still open on the old version keeps reporting it); fixed without a known
 * version, any later occurrence does.
 */
export function comesBack(group: { fixedInVersion: string | null; fixedAt: Date | null }, occurrence: { version: string | null; at: Date }): boolean {
  if (group.fixedInVersion) return isNewerVersion(occurrence.version, group.fixedInVersion);
  return !group.fixedAt || occurrence.at > group.fixedAt;
}

/** A grouping key as a sha-256 (hex) of its parts. */
export function fingerprintOf(parts: readonly string[]): string {
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex');
}

/** Everything the rows' words and the grouping are made from (already checked and reduced). */
export interface ReportFacts {
  kind: ErrorKind;
  detail?: string | null;
  message?: string | null;
  page?: string | null;
  resource?: string | null;
  directive?: string | null;
  tag?: string | null;
  value?: number | null;
  job?: string | null;
  route?: string | null;
  top?: { file: string; fn: string | null } | null;
  /** A server error's database codes ("P2010/1038", 1.22.5): two different database errors at one line are two rows. */
  cause?: string | null;
}

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
const TAG_WORD: Record<string, string> = { script: 'script', link: 'style', img: 'picture' };

/**
 * A report's title (with its number), its group's title (without), and the key it is grouped by:
 * the kind and what happened (numbers and ids normalised), plus the site's own top frame (original
 * file and function — never the line or the hashed file name, so it stays one row across releases).
 */
export function describeReport(r: ReportFacts): { title: string; groupTitle: string; key: string } {
  const top = r.top ? [r.top.file, r.top.fn ?? ''] : ['', ''];
  const value = typeof r.value === 'number' && Number.isFinite(r.value) ? r.value : 0;
  switch (r.kind) {
    case 'SLOW': {
      const page = r.page ?? '/';
      const words: Record<string, [string, string]> = {
        load: ['Slow page load', `Slow page load: ${seconds(value)}`],
        lcp: ['Slow to show the page', `Slow to show the page: ${seconds(value)}`],
        inp: ['Slow to answer a click or key', `Slow to answer a click or key: ${Math.round(value)} ms`],
        cls: ['The page jumped around', `The page jumped around: ${value.toFixed(2)}`],
        api: [`Slow request: ${r.resource ?? 'a request'}`, `Slow request: ${r.resource ?? 'a request'} took ${seconds(value)}`],
      };
      const [groupTitle, title] = words[r.detail ?? ''] ?? ['Slow', `Slow: ${value}`];
      const where = r.detail === 'api' ? (r.resource ?? '') : page;
      return { title, groupTitle, key: fingerprintOf(['SLOW', r.detail ?? '', where]) };
    }
    case 'NETWORK': {
      const title = r.detail === 'socket' ? 'The live connection couldn’t connect for over a minute' : 'A request didn’t reach the server (blocked on the way?)';
      return { title, groupTitle: title, key: fingerprintOf(['NETWORK', r.detail ?? '']) };
    }
    case 'BLOCKED': {
      if (r.detail === 'resource') {
        const file = r.resource ?? '';
        const title = `A ${TAG_WORD[r.tag ?? ''] ?? 'site'} file didn’t load: ${file}`;
        return { title, groupTitle: title, key: fingerprintOf(['BLOCKED', 'resource', r.tag ?? '', chunkName(file)]) };
      }
      const directive = r.directive || 'a rule';
      const target = r.resource || 'something';
      const title = `The security policy blocked ${directive}: ${target}`;
      return { title, groupTitle: title, key: fingerprintOf(['BLOCKED', 'csp', directive, target]) };
    }
    case 'SERVER': {
      const title = (r.message || 'Server error').slice(0, 500);
      // Without database codes the key is as it was, so the rows already kept stay one row.
      const parts = ['SERVER', r.job ?? r.route ?? '', normalizeMessage(title), ...top];
      return { title, groupTitle: title, key: fingerprintOf(r.cause ? [...parts, r.cause] : parts) };
    }
    default: {
      const title = (r.message || 'Error').slice(0, 500);
      if (r.detail === 'chunk') {
        const file = /\/assets\/[^\s'"()]+/.exec(title)?.[0] ?? '';
        return { title, groupTitle: title, key: fingerprintOf(['ERROR', 'chunk', chunkName(file)]) };
      }
      return { title, groupTitle: title, key: fingerprintOf(['ERROR', normalizeMessage(title), ...top]) };
    }
  }
}
