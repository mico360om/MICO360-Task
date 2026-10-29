import type { MinutesState } from '../../api/meetings';
import type { BadgeTone } from '../ui/Badge';
import { Avatar } from '../ui/Avatar';

/** How far a meeting's minutes are, as a badge (none when nothing was taken). */
export const MINUTES: Record<MinutesState, { label: string; tone: BadgeTone } | null> = {
  FINAL: { label: 'Final minutes', tone: 'success' },
  DRAFT: { label: 'Minutes drafted', tone: 'info' },
  NOTES: { label: 'Notes taken', tone: 'neutral' },
  NONE: null,
};

export type LeafTone = 'today' | 'upcoming' | 'muted';

const LEAF: Record<LeafTone, string> = {
  today: 'border-brand bg-brand text-white [&>b]:text-white',
  upcoming: 'border-brand/25 bg-brand/[0.06] text-brand',
  muted: 'border-line bg-ground text-ink-3',
};

/** The meeting's day as a calendar leaf: weekday, day number, month (filled in on today). */
export function DateLeaf({ iso, timeZone, tone }: { iso: string; timeZone: string; tone: LeafTone }) {
  const d = new Date(iso);
  const part = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-GB', { ...o, timeZone }).format(d);
  return (
    <div aria-hidden="true" className={`flex w-14 flex-none flex-col items-center rounded-xl border py-1.5 ${LEAF[tone]}`}>
      <span className="text-[10px] font-bold uppercase tracking-wide">{part({ weekday: 'short' })}</span>
      <b className="font-display text-xl font-bold leading-none text-ink">{part({ day: 'numeric' })}</b>
      <span className="text-[10px] font-semibold uppercase">{part({ month: 'short' })}</span>
    </div>
  );
}

/** Who's coming: the first three faces, "+N" for the rest, and how many in words. */
export function People({ names = [], count }: { names?: string[]; count?: number }) {
  const total = count ?? names.length;
  if (!total) return <span className="text-xs text-ink-3">No attendees yet</span>;
  const shown = names.slice(0, 3);
  const more = total - shown.length;
  return (
    <span className="relative z-10 flex min-w-0 items-center gap-2 text-xs text-ink-2" title={names.length ? `${names.join(', ')}${total > names.length ? ' …' : ''}` : undefined}>
      {shown.length ? (
        <span className="flex flex-none -space-x-1.5 rtl:space-x-reverse">
          {/* Each face on a solid backing: the initials' tint is see-through, and an overlapped face's
              letters would show through the one in front. */}
          {shown.map((n, i) => (
            <span key={`${i}-${n}`} className="flex-none rounded-full bg-surface">
              <Avatar name={n} size="sm" />
            </span>
          ))}
          {more > 0 ? (
            <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full border border-surface bg-ground px-1 text-[10px] font-semibold text-ink-2">+{more}</span>
          ) : null}
        </span>
      ) : null}
      <span className="whitespace-nowrap">{total} {total === 1 ? 'person' : 'people'}</span>
    </span>
  );
}
