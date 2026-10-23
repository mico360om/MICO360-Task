import type { ApiActivityEntry } from './types';
import type { Tone } from './tone';
import { appTimeZone, zonedDayKey } from './due-date';
import { dayLabel, shiftDayKey } from './calendar';
import { relativeTime } from './relative-time';

/**
 * The Activity screen (5c), as the website's Activity page (Web Portal/frontend/src/pages/
 * ActivityPage.tsx): the newest 50 things done across the projects you're on (the server scopes
 * them), "who did what to which task", grouped by day, with the same filters. Its words are the
 * page's own, not the task timeline's (lib/activity-feed): a blocker change never names the other
 * task here. Pure, so it is tested here, with a check against the page's source.
 */

/** One row of `GET /activity`: the task's activity, with the task and project it was in. */
export interface ApiActivityRow extends ApiActivityEntry {
  projectId?: string | null;
  task?: { id: string; key: string; title: string } | null;
  project?: { id: string; name: string } | null;
}

export const ACTION_VERB: Record<string, string> = {
  CREATED: 'created',
  MOVED: 'moved',
  COMPLETED: 'completed',
  REOPENED: 'reopened',
  ASSIGNED: 'assigned',
  PROJECT_CHANGED: 'moved',
};

/** Each action's colour, as the website's (text-info, text-success …). */
export const ACTION_TONE: Record<string, Tone> = {
  CREATED: 'info',
  MOVED: 'neutral',
  COMPLETED: 'success',
  REOPENED: 'warning',
  ASSIGNED: 'brand',
  PROJECT_CHANGED: 'neutral',
};

export const ACTIVITY_FILTERS: readonly { value: string; label: string }[] = [
  { value: '', label: 'All' },
  { value: 'CREATED', label: 'Created' },
  { value: 'MOVED', label: 'Moved' },
  { value: 'COMPLETED', label: 'Completed' },
  { value: 'ASSIGNED', label: 'Assigned' },
];

/** What they did: the five main actions by name, any other by its own ("checklist done"). */
export function activityVerb(action: string): string {
  return ACTION_VERB[action] ?? action.toLowerCase().replace(/_/g, ' ');
}

export const activityTone = (action: string): Tone => ACTION_TONE[action] ?? 'neutral';

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);

/** The "what happened" words, from the recorded old → new values where there are some. */
export function activityDetail(a: Pick<ApiActivityRow, 'action' | 'meta'>): string {
  const m = a.meta ?? {};
  const from = str(m.from);
  const to = str(m.to);
  switch (a.action) {
    case 'MOVED':
      return to ? `${from ?? '—'} → ${to}` : '';
    case 'COMPLETED':
      return to ? `marked complete in ${to}` : 'marked complete';
    case 'REOPENED':
      return to ? `re-opened in ${to}` : 're-opened';
    case 'ASSIGNED':
      return str(m.assignee) ? `→ ${str(m.assignee)}` : '';
    case 'PROJECT_CHANGED': {
      // To another project: from where, by the key it had there ("from Rig Inspection (RIG-4) to Operations").
      const fromProject = str(m.fromProject);
      const toProject = str(m.toProject);
      const fromKey = str(m.fromKey);
      if (!fromProject || !toProject) return toProject ? `to ${toProject}` : 'to another project';
      return `from ${fromProject}${fromKey ? ` (${fromKey})` : ''} to ${toProject}`;
    }
    default:
      return '';
  }
}

/** The row's second line: the task's title, what happened, the project (left out where it is its own button). */
export function activityLine(a: ApiActivityRow, { project = true }: { project?: boolean } = {}): string {
  return [a.task?.title, activityDetail(a), project ? a.project?.name : null].filter(Boolean).join(' · ');
}

/** Who did it, as the website's avatar shows a person without a picture: the first letters of two words. */
export function actorInitials(name: string): string {
  const initials = name
    .trim()
    .split(/\s+/)
    .map((part) => part[0] ?? '')
    .slice(0, 2)
    .join('')
    .toUpperCase();
  return initials || '?';
}

/** The row read out whole: "Omar Ahmed moved OPS-12, Fix the pump, To Do → Done, in Rig Ops, 5m ago". */
export function activityRowLabel(a: ApiActivityRow, now: number = Date.now(), timeZone: string = appTimeZone()): string {
  const who = `${a.actor?.name ?? 'Someone'} ${activityVerb(a.action)} ${a.task?.key ?? 'a task'}`;
  return [who, a.task?.title, activityDetail(a) || null, a.project ? `in ${a.project.name}` : null, relativeTime(a.createdAt, now, timeZone) || null]
    .filter(Boolean)
    .join(', ');
}

/** The rows of one filter; "Completed" keeps re-opened tasks too (the website's rule). */
export function filterActivity<T extends Pick<ApiActivityRow, 'action'>>(rows: readonly T[], filter: string): T[] {
  return rows.filter((a) => !filter || a.action === filter || (filter === 'COMPLETED' && a.action === 'REOPENED'));
}

/** Why the list is empty: none of this kind (with "Show all activity"), or nothing yet. */
export function activityEmpty(filter: string): { title: string; subtitle?: string; showAll: boolean } {
  if (filter) {
    const label = (ACTIVITY_FILTERS.find((f) => f.value === filter)?.label ?? 'matching').toLowerCase();
    return { title: `No ${label} activity`, showAll: true };
  }
  return { title: 'No activity yet', subtitle: 'Task creations, moves, completions and assignments will show up here.', showAll: false };
}

/**
 * The rows by day, newest first: "Today", "Yesterday", else the day in full ("Sunday 18 October
 * 2026"), in the company's time zone like every date in the app (the website uses the browser's).
 */
export function groupActivity<T extends Pick<ApiActivityRow, 'createdAt'>>(
  rows: readonly T[],
  now: number = Date.now(),
  timeZone: string = appTimeZone(),
): { key: string; title: string; items: T[] }[] {
  const today = zonedDayKey(new Date(now), timeZone);
  const yesterday = shiftDayKey(today, -1);
  const groups = new Map<string, T[]>();
  for (const a of rows) {
    const t = new Date(a.createdAt);
    const key = Number.isNaN(t.getTime()) ? '' : zonedDayKey(t, timeZone);
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(a);
  }
  return [...groups.entries()].map(([key, items]) => ({
    key: key || 'unknown',
    title: key === today ? 'Today' : key === yesterday ? 'Yesterday' : key ? dayLabel(key, { weekday: 'long', day: true, month: 'long', year: true }) : 'Earlier',
    items,
  }));
}
