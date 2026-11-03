/**
 * The Notifications page (1.22): its type chips, the tab and chips remembered per person in this
 * browser, day groups in the person's time zone, and the words of an empty list. Pure, so tested
 * on their own. The server owns which notification types each chip stands for
 * (backend notifications/notification-kinds.ts); a test checks the two name the same chips.
 */
import { dayKeyIn, dayText } from './day-words';
import { shiftDayKey, todayKey } from './due-date';

export type NotificationKind = 'mentions' | 'assigned' | 'due' | 'comments' | 'approvals' | 'meetings';

export interface NotificationKindInfo {
  key: NotificationKind;
  /** The chip's words. */
  label: string;
  /** What an empty list of it is "no …" of. */
  noun: string;
}

export const NOTIFICATION_KINDS: readonly NotificationKindInfo[] = [
  { key: 'mentions', label: 'Mentions', noun: 'mentions' },
  { key: 'assigned', label: 'Assigned to me', noun: 'assignments' },
  { key: 'due', label: 'Due & overdue', noun: 'due or overdue reminders' },
  { key: 'comments', label: 'Comments', noun: 'comments' },
  { key: 'approvals', label: 'Approvals', noun: 'approvals' },
  { key: 'meetings', label: 'Meetings', noun: 'meeting reminders' },
];
const KIND_KEYS = NOTIFICATION_KINDS.map((k) => k.key);
const isKind = (v: unknown): v is NotificationKind => typeof v === 'string' && (KIND_KEYS as string[]).includes(v);

export type InboxTab = 'all' | 'unread';
export interface InboxFilter {
  tab: InboxTab;
  /** The chips chosen, in chip order; none = every type. */
  kinds: NotificationKind[];
}
export const DEFAULT_INBOX_FILTER: InboxFilter = { tab: 'all', kinds: [] };
/** Its name in the per-person browser storage (lib/user-storage). */
export const INBOX_FILTER_PREF = 'notifications.filter';

/** The saved tab and chips; nothing saved (or something unreadable) = All, every type. A chip that is gone is dropped. */
export function parseInboxFilter(raw: string | null | undefined): InboxFilter {
  if (!raw) return { ...DEFAULT_INBOX_FILTER, kinds: [] };
  try {
    const v = JSON.parse(raw) as { tab?: unknown; kinds?: unknown };
    if (!v || typeof v !== 'object' || Array.isArray(v)) return { ...DEFAULT_INBOX_FILTER, kinds: [] };
    const tab: InboxTab = v.tab === 'unread' ? 'unread' : 'all';
    const kinds = Array.isArray(v.kinds) ? KIND_KEYS.filter((k) => (v.kinds as unknown[]).filter(isKind).includes(k)) : [];
    return { tab, kinds };
  } catch {
    return { ...DEFAULT_INBOX_FILTER, kinds: [] };
  }
}

export function serializeInboxFilter(f: InboxFilter): string {
  return JSON.stringify({ tab: f.tab, kinds: f.kinds });
}

/** A chip clicked: on if it was off, off if it was on; the chips keep their order. */
export function toggleKind(kinds: readonly NotificationKind[], key: NotificationKind): NotificationKind[] {
  const on = kinds.includes(key);
  return KIND_KEYS.filter((k) => (k === key ? !on : kinds.includes(k)));
}

/** The unread counts the server gives (GET /notifications/counts). */
export interface InboxCounts {
  unread: number;
  kinds: Record<NotificationKind, number>;
}

/** The number on the Unread tab: unread in the chips chosen (the chips' types never overlap), or every unread one. */
export function unreadInView(counts: InboxCounts | undefined, kinds: readonly NotificationKind[]): number | null {
  if (!counts) return null;
  return kinds.length === 0 ? counts.unread : kinds.reduce((sum, k) => sum + (counts.kinds[k] ?? 0), 0);
}

export interface DayGroup<T> {
  /** 'YYYY-MM-DD' in the person's time zone. */
  key: string;
  /** "Today", "Yesterday", "Mon 2 Nov" (with the year when it is another year's). */
  label: string;
  rows: T[];
}

/** Rows (newest first) by day, in `timeZone`, keeping their order. */
export function groupByDay<T extends { createdAt: string }>(rows: readonly T[], timeZone: string, now: Date = new Date()): DayGroup<T>[] {
  const today = todayKey(timeZone, now);
  const yesterday = shiftDayKey(today, -1);
  const groups: DayGroup<T>[] = [];
  for (const row of rows) {
    const at = new Date(row.createdAt);
    const key = Number.isNaN(at.getTime()) ? today : dayKeyIn(at, timeZone);
    let group = groups[groups.length - 1];
    if (!group || group.key !== key) {
      const label = key === today ? 'Today' : key === yesterday ? 'Yesterday' : dayText(key, { weekday: 'short', year: key.slice(0, 4) !== today.slice(0, 4) });
      group = { key, label, rows: [] };
      groups.push(group);
    }
    group.rows.push(row);
  }
  return groups;
}

export interface EmptyInbox {
  title: string;
  description: string;
  /** What the empty state's button clears: the chips ("Show all types"), the Unread tab ("Show all notifications"), or nothing. */
  clear: 'kinds' | 'tab' | null;
}

/** What an empty list says, for the tab and chips chosen. */
export function emptyInbox({ tab, kinds }: InboxFilter): EmptyInbox {
  const unread = tab === 'unread';
  if (kinds.length === 0) {
    return unread
      ? { title: 'No unread notifications', description: 'You’ve read them all.', clear: 'tab' }
      : { title: 'You’re all caught up', description: 'Mentions, assignments and task updates will appear here.', clear: null };
  }
  const noun = kinds.length === 1 ? NOTIFICATION_KINDS.find((k) => k.key === kinds[0])!.noun : 'notifications of these types';
  return {
    title: `No ${unread ? 'unread ' : ''}${noun}`,
    description: unread ? 'You’ve read every one of these.' : `None of your notifications are of ${kinds.length === 1 ? 'this type' : 'these types'}.`,
    clear: 'kinds',
  };
}

/** Several at once go to the server at most 200 to a request. */
export function chunks<T>(list: readonly T[], size = 200): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

/** The newest time in a list (Mark all read reads up to it, so one that arrives meanwhile stays unread). */
export function newestCreatedAt(rows: readonly { createdAt: string }[]): string | undefined {
  let best: { t: number; iso: string } | undefined;
  for (const r of rows) {
    const t = Date.parse(r.createdAt);
    if (!Number.isNaN(t) && (!best || t > best.t)) best = { t, iso: r.createdAt };
  }
  return best?.iso;
}
