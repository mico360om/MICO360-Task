import { appTimeZone, zonedDayKey } from './due-date';
import { dayLabel } from './calendar';

/**
 * "5m ago", "3h ago", "2d ago" — and the day for anything a week or more old ("15 Oct 2026", in the
 * company's time zone like every date in the app). Empty for a missing time. The website's
 * relativeTime (Web Portal/frontend/src/lib/relative-time.ts); the words under a week are tested
 * to be the same.
 */
export function relativeTime(iso: string, now: number = Date.now(), timeZone: string = appTimeZone()): string {
  const then = new Date(iso).getTime();
  if (!iso || Number.isNaN(then)) return '';
  const s = Math.round((now - then) / 1000);
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d}d ago`;
  return dayLabel(zonedDayKey(new Date(then), timeZone), { day: true, month: 'short', year: true });
}
