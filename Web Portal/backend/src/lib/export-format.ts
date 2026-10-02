/**
 * Shared wording and formatting for exported documents (reports and task details), so Excel and
 * PDF files read the same as the apps: day names, company-time clock times, status and priority
 * labels and the status colours.
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** 'YYYY-MM-DD' → '30 Sep 2026' (a calendar day, never shifted by a time zone). */
export function formatDay(key: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(key ?? '');
  if (!m) return '';
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
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
export const CATEGORY_COLOR: Record<string, string> = {
  BACKLOG: '#948985',
  TODO: '#9A918D',
  IN_PROGRESS: '#B87611',
  BLOCKED: '#CB4632',
  REVIEW: '#3A6EA5',
  DONE: '#2E7D53',
};
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
