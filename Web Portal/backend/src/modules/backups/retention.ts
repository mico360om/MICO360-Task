import { shiftDayKey, zonedDayKey } from '../../lib/due-date';

export interface RetentionCopy {
  id: string;
  createdAt: Date;
}

export type CopyKind = 'nightly' | 'weekly' | 'manual';

/** How many "Back up now" copies are kept, besides the nightly and weekly ones. */
export const MANUAL_KEEP = 3;

export interface RetentionOptions {
  /** The company time zone: copies are grouped by its calendar dates. */
  timeZone: string;
  /** The company week start (0 Sunday, 1 Monday, 6 Saturday), from System Settings. */
  weekStart: 0 | 1 | 6;
  nightly?: number;
  weekly?: number;
}

/** The first day ('YYYY-MM-DD') of the company week a date is in. */
function weekOf(day: string, weekStart: number): string {
  const weekday = new Date(`${day}T12:00:00Z`).getUTCDay();
  return shiftDayKey(day, -((weekday - weekStart + 7) % 7));
}

/**
 * Which copies to keep: one per company date (the newest that day); the newest 7 dates are the
 * nightly copies; then the last copy of each of the 4 newest company weeks before the nightly ones
 * (a week that still holds a nightly copy waits until it no longer does) are the weekly copies.
 * Everything else is removed. Applied every night, at most two copies go a night and the weekly
 * copies stay a week apart.
 */
export function planRetention(copies: RetentionCopy[], opts: RetentionOptions): { keep: Map<string, CopyKind>; remove: string[] } {
  const nightly = opts.nightly ?? 7;
  const weekly = opts.weekly ?? 4;
  const newestFirst = [...copies].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? 1 : -1));
  const keep = new Map<string, CopyKind>();
  const remove: string[] = [];

  // The newest copy of each company date, newest date first.
  const perDay: { id: string; day: string }[] = [];
  const seen = new Set<string>();
  for (const c of newestFirst) {
    const day = zonedDayKey(c.createdAt, opts.timeZone);
    if (seen.has(day)) remove.push(c.id);
    else {
      seen.add(day);
      perDay.push({ id: c.id, day });
    }
  }

  const nightlyWeeks = new Set<string>();
  perDay.forEach((c, i) => {
    if (i < nightly) {
      keep.set(c.id, 'nightly');
      nightlyWeeks.add(weekOf(c.day, opts.weekStart));
    }
  });

  const weeksKept = new Set<string>();
  for (const c of perDay.slice(nightly)) {
    const week = weekOf(c.day, opts.weekStart);
    if (!nightlyWeeks.has(week) && !weeksKept.has(week) && weeksKept.size < weekly) {
      weeksKept.add(week);
      keep.set(c.id, 'weekly');
    } else remove.push(c.id);
  }
  return { keep, remove };
}

/**
 * The whole rule: nightly copies keep 7 nightly + 4 weekly (planRetention); copies made with "Back up
 * now" are kept on top — the 3 newest — so pressing it (say, after a mistake) never pushes out the
 * night's copy.
 */
export function planBackupRetention(copies: (RetentionCopy & { manual: boolean })[], opts: RetentionOptions): { keep: Map<string, CopyKind>; remove: string[] } {
  const plan = planRetention(copies.filter((c) => !c.manual), opts);
  const manual = copies.filter((c) => c.manual).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  manual.forEach((c, i) => {
    if (i < MANUAL_KEEP) plan.keep.set(c.id, 'manual');
    else plan.remove.push(c.id);
  });
  return plan;
}
