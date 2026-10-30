import { dayText } from './day-words';

/**
 * A calendar day ('YYYY-MM-DD') as "Sun 1 Nov" — with the year when asked ("Sun 1 Nov 2026"), or
 * only the weekday ("Sun"). The day itself, never moved by a time zone.
 */
export function dayLabel(key: string, { year = false, only }: { year?: boolean; only?: 'weekday' } = {}): string {
  const words = dayText(key, { weekday: 'short', year });
  return only === 'weekday' ? words.split(' ')[0] ?? '' : words;
}
