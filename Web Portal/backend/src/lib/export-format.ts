/**
 * Shared wording and formatting for exported documents (reports and task details), so Excel and
 * PDF files read the same as the apps: day names, company-time clock times, status and priority
 * labels and the status colours.
 */
import { STATUS_KINDS, STATUS_TONES } from './colour-scheme';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * 'YYYY-MM-DD' → '30 Sep 2026' (a calendar day, never shifted by a time zone): the day before the
 * month and three-letter months (never "Sept", as en-GB's Intl writes September). With
 * `{ weekday: true, year: false }` → 'Wed 30 Sep'; with `{ year: false }` → '30 Sep'.
 */
export function formatDay(key: string | null | undefined, { weekday = false, year = true }: { weekday?: boolean; year?: boolean } = {}): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(key ?? '');
  if (!m) return '';
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const day = weekday ? `${WEEKDAYS[new Date(Date.UTC(y, mo - 1, d)).getUTCDay()]} ` : '';
  return `${day}${d} ${MONTHS[mo - 1]}${year ? ` ${m[1]}` : ''}`;
}

/** The wall-clock time of an instant in a time zone, 'YYYY-MM-DD HH:mm' (for Excel). */
export function wallClock(at: Date, timeZone: string): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}

/** '1 Oct 2026, 10:00' in the given time zone. */
export function formatDateTime(at: Date, timeZone: string): string {
  const w = wallClock(at, timeZone);
  return `${formatDay(w.slice(0, 10))}, ${w.slice(11)}`;
}

export const PRIORITY_LABEL: Record<string, string> = { LOW: 'Low', NORMAL: 'Normal', HIGH: 'High', URGENT: 'Urgent' };
export const priorityLabel = (p: string | null | undefined): string => PRIORITY_LABEL[p ?? ''] ?? (p ?? '');

/** Column categories in board order, with the apps' labels and colours. */
export const CATEGORY_ORDER = ['BACKLOG', 'TODO', 'IN_PROGRESS', 'BLOCKED', 'REVIEW', 'DONE'] as const;
export const CATEGORY_LABEL: Record<string, string> = {
  BACKLOG: 'Backlog',
  TODO: 'To do',
  IN_PROGRESS: 'In progress',
  BLOCKED: 'Blocked',
  REVIEW: 'Review',
  DONE: 'Done',
};
/** 1.23.8: the one colour scheme's status colours (lib/colour-scheme.ts, the website's copy), on paper. */
export const CATEGORY_COLOR: Record<string, string> = Object.fromEntries(STATUS_KINDS.map((k) => [k, STATUS_TONES[k].light.fill]));
export const categoryLabel = (c: string): string => CATEGORY_LABEL[c] ?? c;

/** The brand colour of the web app (#8B1E1E). */
export const BRAND = '#8B1E1E';

/** A safe file-name part: letters, digits and dashes ('' when the text has none of them). */
export function slugPart(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/[\s_]+/g, '-')
    .toLowerCase()
    .slice(0, 60);
}

/** A safe file-name part: letters, digits and dashes. */
export function fileSlug(text: string): string {
  return slugPart(text) || 'export';
}
