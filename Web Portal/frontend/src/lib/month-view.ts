import { dayKeyOf, isMonthTaskDone, monthPlace, type DateLike, type MonthClock, type MonthTask } from './board-month';
import { dayKeyIn, dayText } from './day-words';
import { todayKey } from './due-date';

/**
 * Kanban Board: Monthly View — the words the month view shows: a month's title ("November 2026"), a
 * month beside the one shown ("Dec", "Jan 2027"), the year list, an empty month, and each card's dates
 * ("5–20 Nov", "Due 18 Nov", "From 5 Nov", "Done 3 Nov", "Overdue · from Oct", "No date"). Which months a
 * task shows in is the shared rule's (lib/board-month.ts, the server's copy).
 */

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'] as const;
export { MONTH_NAMES };

const yearOf = (month: string) => Number(month.slice(0, 4));
const nameOf = (month: string) => MONTH_NAMES[Number(month.slice(5, 7)) - 1] ?? '';

/** "November 2026". */
export function monthTitle(month: string): string {
  return `${nameOf(month)} ${yearOf(month)}`;
}

/** A month in a word beside the one shown: "Dec", or "Jan 2027" in another year. */
export function monthWord(month: string, shown: string): string {
  const short = nameOf(month).slice(0, 3);
  return yearOf(month) === yearOf(shown) ? short : `${short} ${yearOf(month)}`;
}

/** This month, 'YYYY-MM', in the company time zone. */
export function currentMonth(timeZone: string, now: Date = new Date()): string {
  return todayKey(timeZone, now).slice(0, 7);
}

/** The year selector's years: five either side of this year, and the shown month's year when it is further off. */
export function yearChoices(shown: string, thisMonth: string): number[] {
  const years = Array.from({ length: 11 }, (_, i) => yearOf(thisMonth) - 5 + i);
  return years.includes(yearOf(shown)) ? years : [...years, yearOf(shown)].sort((a, b) => a - b);
}

/** What a month with no tasks on it says. */
export function emptyMonthText(month: string, thisMonth: string): string {
  if (month === thisMonth) return 'Nothing on this month’s board yet. Add a task with “New task” or a column’s +.';
  if (month > thisMonth) return `Nothing planned for ${monthTitle(month)} yet.`;
  return `Nothing was on the board in ${monthTitle(month)}.`;
}

/** A card's dates in the month view; `title` (on hover) gives a carried card's due day. */
export interface MonthCardDate {
  text: string;
  overdue: boolean;
  title?: string;
}

/** What a card reads: the shared rule's fields, and whether it waits for approval. */
export type MonthCardTask = MonthTask & { approvalRequestedAt?: DateLike };

export function monthCardDate(t: MonthCardTask, month: string, clock: MonthClock): MonthCardDate {
  const shownYear = month.slice(0, 4);
  // "5 Nov", or "5 Nov 2027" in another year than the month shown.
  const at = (key: string) => dayText(key, { year: key.slice(0, 4) !== shownYear });
  if (isMonthTaskDone(t)) {
    const when = t.completedAt ?? t.updatedAt;
    const d = when ? new Date(when) : null;
    return { text: d && !Number.isNaN(d.getTime()) ? `Done ${at(dayKeyIn(d, clock.timeZone))}` : 'Done', overdue: false };
  }
  const place = monthPlace(t, month, clock);
  if (place === 'undated') return { text: 'No date', overdue: false };
  const start = dayKeyOf(t.startDate, clock.timeZone);
  const due = dayKeyOf(t.dueDate, clock.timeZone);
  // Waiting for approval is never late (owner, 30 Oct): its badge says so instead.
  const late = Boolean(due) && !t.approvalRequestedAt && due! < clock.today;
  if (place === 'carried' && late) return { text: `Overdue · from ${monthWord(due!.slice(0, 7), month)}`, overdue: true, title: `Due ${at(due!)}` };
  let text = '';
  if (due && start && start < due) text = span(start, due, at, shownYear);
  else if (due) text = late ? at(due) : `Due ${at(due)}`;
  else if (start) text = `From ${at(start)}`;
  return late ? { text: `Overdue · ${text}`, overdue: true } : { text, overdue: false };
}

/** "5–20 Nov", "28 Oct – 4 Dec", "28 Dec – 4 Jan 2027". */
function span(start: string, due: string, at: (key: string) => string, shownYear: string): string {
  if (start.slice(0, 7) === due.slice(0, 7)) {
    const year = due.slice(0, 4) !== shownYear ? ` ${due.slice(0, 4)}` : '';
    return `${Number(start.slice(8, 10))}–${dayText(due, { year: false })}${year}`;
  }
  return `${at(start)} – ${at(due)}`;
}

// ── The board in the month view ──

/** Each card's month line, and whether its task has no dates (keyed by task key). */
export type MonthCards = Map<string, { line: MonthCardDate; undated: boolean }>;

export function monthCards(tasks: (MonthCardTask & { key: string })[], month: string, clock: MonthClock): MonthCards {
  return new Map(tasks.map((t) => [t.key, { line: monthCardDate(t, month, clock), undated: monthPlace(t, month, clock) === 'undated' }]));
}

/** The keys of the tasks without dates (behind the "No date" chip). */
export function undatedKeys(cards: MonthCards): Set<string> {
  return new Set([...cards].filter(([, c]) => c.undated).map(([key]) => key));
}

/** The board's columns with each card's month line (new objects; the input is left as it was). */
export function withMonthDates<C extends { tasks: T[] }, T extends { key: string; dateLine?: MonthCardDate }>(columns: C[], cards: MonthCards): C[] {
  return columns.map((c) => ({ ...c, tasks: c.tasks.map((t) => {
    const card = cards.get(t.key);
    return card ? { ...t, dateLine: card.line } : t;
  }) }));
}

/** The columns without these cards (the same columns when there are none to hide). */
export function hideCards<C extends { tasks: { key: string }[] }>(columns: C[], keys: ReadonlySet<string>): C[] {
  if (keys.size === 0) return columns;
  return columns.map((c) => ({ ...c, tasks: c.tasks.filter((t) => !keys.has(t.key)) }));
}

/** How many of these cards are on the board. */
export function countCards(columns: { tasks: { key: string }[] }[], keys: ReadonlySet<string>): number {
  return columns.reduce((n, c) => n + c.tasks.filter((t) => keys.has(t.key)).length, 0);
}
