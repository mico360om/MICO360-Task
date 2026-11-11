import type { MeetingFace, MinutesState } from '../../api/meetings';
import type { BadgeTone } from '../ui/Badge';
import { Avatar } from '../ui/Avatar';
import { instantDayText } from '../../lib/day-words';

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
export function DateLeaf({ iso, timeZone, tone, className = '' }: { iso: string; timeZone: string; tone: LeafTone; className?: string }) {
  const d = new Date(iso);
  // "Wed 30 Sep" in the meeting's (company) time zone: three-letter months, never "Sept".
  const [weekday, day, month] = instantDayText(d, timeZone, { weekday: 'short', year: false }).split(' ');
  return (
    <div aria-hidden="true" className={`flex w-14 flex-none flex-col items-center rounded-xl border py-1.5 ${LEAF[tone]} ${className}`}>
      <span className="text-[10px] font-bold uppercase tracking-wide">{weekday}</span>
      <b className="font-display text-xl font-bold leading-none text-ink">{day}</b>
      <span className="text-[10px] font-semibold uppercase">{month}</span>
    </div>
  );
}

/**
 * Who's coming: the first three faces, "+N" for the rest, and how many in words. `faces` (avatar hotfix):
 * the same people with their photos; an older server sends only `names` (initials).
 */
export function People({ names: given = [], faces, count, className = '' }: { names?: string[]; faces?: MeetingFace[]; count?: number; className?: string }) {
  const people: MeetingFace[] = faces?.length ? faces : given.map((name) => ({ name, avatarUrl: null }));
  const names = people.map((p) => p.name);
  const total = count ?? names.length;
  if (!total) return <span className={`text-xs leading-6 text-ink-3 ${className}`}>No attendees yet</span>;
  const shown = people.slice(0, 3);
  const more = total - shown.length;
  return (
    <span className={`relative z-10 flex min-w-0 items-center gap-2 text-xs text-ink-2 ${className}`} title={names.length ? `${names.join(', ')}${total > names.length ? ' …' : ''}` : undefined}>
      {shown.length ? (
        <span className="flex flex-none -space-x-1.5 rtl:space-x-reverse">
          {/* Each face on a solid backing: the initials' tint is see-through, and an overlapped face's
              letters would show through the one in front. */}
          {shown.map((p, i) => (
            <span key={`${i}-${p.name}`} className="flex-none rounded-full bg-surface">
              <Avatar name={p.name} src={p.avatarUrl} size="sm" />
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
