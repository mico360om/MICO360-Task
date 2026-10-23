import type { WorkloadCell, WorkloadPerson, WorkloadSuggestion } from '../api/planning';
import { shiftDayKey } from './due-date';

/**
 * The Workload page's rules: how a cell looks, a person's week, the order of the rows, the summary
 * line and the words of the popover and its suggestions. Pure, so the page and its tests agree.
 */

export type CellTone = 'off' | 'offdue' | 'none' | 'below' | 'at' | 'over';

/**
 * Quiet at 0, green below the limit, amber at it, red over it; an empty day off says “Off”, and
 * tasks due on a day off are their own case (the working-day limit doesn't apply to them).
 */
export function cellTone(cell: Pick<WorkloadCell, 'count' | 'limit'>): CellTone {
  if (cell.limit === 0) return cell.count === 0 ? 'off' : 'offdue';
  if (cell.count === 0) return 'none';
  if (cell.count > cell.limit) return 'over';
  return cell.count === cell.limit ? 'at' : 'below';
}

const at = (key: string) => new Date(`${key}T12:00:00.000Z`);
const fmt = (opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-GB', { ...opts, timeZone: 'UTC' });
const LONG = fmt({ weekday: 'long', day: 'numeric', month: 'long' });
const WEEKDAY = fmt({ weekday: 'short' });
const DAY_MONTH = fmt({ day: 'numeric', month: 'short' });
const plain = (s: string) => s.replace(',', '').replace('Sept', 'Sep');
/** "Wednesday 28 October". */
const longDay = (key: string) => plain(LONG.format(at(key)));
/** "Wed 28". */
const weekdayDay = (key: string) => `${WEEKDAY.format(at(key))} ${Number(key.slice(8))}`;
/** "28 Oct". */
const dayMonth = (key: string) => plain(DAY_MONTH.format(at(key)));

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** What a screen reader hears for a cell: "Omar Said, Wednesday 28 October: 8 tasks due, 3 over the limit". */
export function cellLabel(name: string, cell: WorkloadCell): string {
  const tone = cellTone(cell);
  const due = plural(cell.count, 'task') + ' due';
  const what =
    tone === 'off'
      ? 'a day off'
      : tone === 'offdue'
        ? `a day off, ${due}`
        : tone === 'none'
          ? 'nothing due'
          : tone === 'over'
            ? `${due}, ${cell.over} over the limit`
            : tone === 'at'
              ? `${due}, at the limit`
              : due;
  return `${name}, ${longDay(cell.date)}: ${what}`;
}

/** A person's week: "28 due · limit 25" and "over by 3", "at the limit" or "room for 21". */
export function weekBar(p: Pick<WorkloadPerson, 'total' | 'weekLimit'>): { pct: number; tone: 'ok' | 'busy' | 'over'; text: string; note: string } {
  const pct = p.weekLimit > 0 ? Math.min(100, Math.round((p.total / p.weekLimit) * 100)) : p.total > 0 ? 100 : 0;
  const tone = p.total > p.weekLimit ? 'over' : pct >= 50 ? 'busy' : 'ok';
  const note = p.total > p.weekLimit ? `over by ${p.total - p.weekLimit}` : p.total === p.weekLimit ? 'at the limit' : `room for ${p.weekLimit - p.total}`;
  return { pct, tone, text: `${p.total} due · limit ${p.weekLimit}`, note };
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
/** A working day over the limit (tasks due on a day off are another matter). */
const isOver = (c: WorkloadCell) => c.limit > 0 && c.over > 0;
const overBy = (p: WorkloadPerson) => p.days.reduce((n, c) => n + (isOver(c) ? c.over : 0), 0);

/** The most overloaded first (tasks over the limit), then the busiest, then by name. */
export function sortPeople(people: WorkloadPerson[]): WorkloadPerson[] {
  return [...people].sort((a, b) => overBy(b) - overBy(a) || b.total - a.total || b.overdue - a.overdue || collator.compare(a.name, b.name));
}

/** Every word must be in the name; case doesn't matter. */
export function filterPeople(people: WorkloadPerson[], q: string): WorkloadPerson[] {
  const words = q.toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return words.length ? people.filter((p) => words.every((w) => p.name.toLocaleLowerCase().includes(w))) : people;
}

/** "1 person is over the daily limit on 2 days this week." */
export function summaryLine(people: WorkloadPerson[], thisWeek: boolean): string {
  const when = thisWeek ? 'this week' : 'that week';
  const over = people.filter((p) => p.days.some(isOver));
  if (over.length === 0) return `Nobody is over the daily limit ${when}.`;
  const days = new Set(over.flatMap((p) => p.days.filter(isOver).map((c) => c.date)));
  return `${plural(over.length, 'person', 'people')} ${over.length === 1 ? 'is' : 'are'} over the daily limit on ${plural(days.size, 'day')} ${when}.`;
}

/** "Week of 25 Oct" (with the year when it isn't this one). */
export function weekLabel(week: string, today: string): string {
  return `Week of ${dayMonth(week)}${week.slice(0, 4) === today.slice(0, 4) ? '' : ` ${week.slice(0, 4)}`}`;
}

/** "Wed 28 · Today" over today's column, else "Thu 29". */
export function dayHeading(date: string, today: string): string {
  return date === today ? `${weekdayDay(date)} · Today` : weekdayDay(date);
}

const LIMITS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 15, 20, 25, 30, 40, 50];
/** The daily limits offered, with the current one when it is unusual. */
export function limitOptions(current: number): number[] {
  return LIMITS.includes(current) ? LIMITS : [...LIMITS, current].sort((a, b) => a - b);
}

/** "Omar Said · Wed 28 Oct". */
export function popoverTitle(name: string, date: string): string {
  return `${name} · ${weekdayDay(date)} ${dayMonth(date).split(' ')[1]}`;
}

/** "8 tasks due · limit 5 · 3 over". */
export function popoverSub(cell: WorkloadCell): string {
  const due = `${plural(cell.count, 'task')} due`;
  if (cell.limit === 0) return `${due} on a day off`;
  const tail = cell.over > 0 ? `${cell.over} over` : cell.count === cell.limit ? 'at the limit' : `room for ${cell.limit - cell.count}`;
  return `${due} · limit ${cell.limit} · ${tail}`;
}

const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? name;

/** On the button: "→ Hassan (2 that day)", "Move to Thu 29" (or "Move to Sun 1 Nov" outside the week shown). */
export function suggestionText(s: WorkloadSuggestion, week: string): string {
  if (s.kind === 'reassign') return s.count === null ? `→ ${firstName(s.to.name)}` : `→ ${firstName(s.to.name)} (${s.count} that day)`;
  const inWeek = s.date >= week && s.date <= shiftDayKey(week, 6);
  return `Move to ${inWeek ? weekdayDay(s.date) : `${WEEKDAY.format(at(s.date))} ${dayMonth(s.date)}`}`;
}

/** For screen readers: "Give RIG-14 to Hassan Ahmed, who has 2 tasks due that day", "Move FCRM-3 to Thursday 29 October". */
export function suggestionLabel(s: WorkloadSuggestion, key: string): string {
  if (s.kind === 'move') return `Move ${key} to ${longDay(s.date)}`;
  if (s.count === null) return `Give ${key} to ${s.to.name}`;
  return `Give ${key} to ${s.to.name}, who has ${s.count ? `${plural(s.count, 'task')} due` : 'nothing due'} that day`;
}

/** Why a suggestion couldn't be applied, in plain words (the numbers are always read again after). */
export function problemText(p: { code: string | null; reason?: string; key: string; suggestion: WorkloadSuggestion; from: string }): string {
  if (p.code === 'VERSION_CONFLICT') return `Someone else changed ${p.key} just now. The numbers are up to date again — try once more if it still needs moving.`;
  if (p.code === 'TASK_DONE') return `${p.key} is already done. The numbers are up to date again.`;
  if (p.code === 'ASSIGNEE_GONE') return `${p.from} is no longer on ${p.key}. The numbers are up to date again.`;
  const what = p.suggestion.kind === 'reassign' ? `give ${p.key} to ${p.suggestion.to.name}` : `move ${p.key}`;
  return `Couldn’t ${what}: ${p.reason ?? 'the server had a problem'}.`;
}
