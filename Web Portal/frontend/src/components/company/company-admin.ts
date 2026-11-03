import type { QueryClient } from '@tanstack/react-query';
import { MY_COMPANIES_KEY, type CompanyPeopleChange, type CompanyWeekStart } from '../../api/companies';
import { ApiError } from '../../lib/api-client';

/**
 * The administrators' company screens (the Companies page, User Management): their cache keys,
 * what to read again after a change, and their words.
 */

/** GET /companies: every company, archived ones too (administrators). */
export const COMPANIES_KEY = ['companies'] as const;
export const companyPeopleKey = (id: string) => ['companies', id, 'people'] as const;
export const companyProjectsKey = (id: string) => ['companies', id, 'projects'] as const;

/**
 * After a change to a company or to who is in it: the companies (and their people and projects),
 * the people lists (their companies), and my own companies — the administrator's picker lists every
 * active company, so a new, renamed or archived one shows there at once.
 */
export function refreshCompanies(qc: QueryClient): void {
  void qc.invalidateQueries({ queryKey: COMPANIES_KEY });
  void qc.invalidateQueries({ queryKey: MY_COMPANIES_KEY });
  void qc.invalidateQueries({ queryKey: ['users'] });
}

/** The days a week can start on, in the order the form offers them. */
export const WEEK_START_OPTIONS: { value: CompanyWeekStart; label: string }[] = [
  { value: 0, label: 'Sunday' },
  { value: 1, label: 'Monday' },
  { value: 6, label: 'Saturday' },
];

export function weekStartName(day: number | null | undefined): string {
  return WEEK_START_OPTIONS.find((o) => o.value === day)?.label ?? 'Sunday';
}

/** "1 person" / "3 people"; "1 project" / "2 projects". */
export const peopleCount = (n: number) => `${n} ${n === 1 ? 'person' : 'people'}`;
export const projectsCount = (n: number) => `${n} ${n === 1 ? 'project' : 'projects'}`;

/** A full name, else the username. */
export const personName = (p: { firstName?: string | null; lastName?: string | null; username: string }) => `${p.firstName ?? ''} ${p.lastName ?? ''}`.trim() || p.username;

/** Why one person couldn't be changed: the server's reason, after their name unless it already says it. */
export function refusalText(r: CompanyPeopleChange['refused'][number]): string {
  return !r.name || r.reason.includes(r.name) ? r.reason : `${r.name}: ${r.reason}`;
}

/**
 * "2 changed." / "2 changed. 1 not changed: Ana Alpha must keep at least one company. Add another
 * company first." — the first reason; `more` has the rest (under "Show all").
 */
export function peopleChangeText(result: CompanyPeopleChange, done = 'changed', notDone = 'not changed'): { text: string; more: { key: string; text: string }[] } {
  const [first, ...rest] = result.refused;
  return {
    text: `${result.changed} ${done}.${first ? ` ${result.refused.length} ${notDone}: ${refusalText(first)}` : ''}`,
    more: rest.map((r, i) => ({ key: `${r.userId}-${i}`, text: refusalText(r) })),
  };
}

/** The server's own words for a refused change (it explains them), else `fallback`. */
export function problemText(err: unknown, fallback: string): string {
  if (err instanceof ApiError && err.status >= 400 && err.status < 500 && err.message && !/^Request failed/.test(err.message)) return err.message;
  return fallback;
}
