/**
 * A calendar day ('YYYY-MM-DD') as "Sun 1 Nov" — with the year when asked ("Sun 1 Nov 2026"), or
 * only the weekday ("Sun"). The day itself, never moved by a time zone.
 */
export function dayLabel(key: string, { year = false, only }: { year?: boolean; only?: 'weekday' } = {}): string {
  const d = new Date(`${key}T12:00:00.000Z`);
  const part = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-GB', { ...o, timeZone: 'UTC' }).format(d);
  if (only === 'weekday') return part({ weekday: 'short' });
  return [part({ weekday: 'short' }), part({ day: 'numeric' }), part({ month: 'short' }), year ? part({ year: 'numeric' }) : null].filter(Boolean).join(' ');
}
