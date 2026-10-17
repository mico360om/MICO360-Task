import { Link } from 'react-router-dom';
import type { Meeting } from '../../api/meetings';
import type { ProjectLook } from '../ProjectAvatar';
import { People } from './meeting-card-parts';
import { MeetingProject, meetingPlace } from './MeetingCard';
import { Icon } from './kit';
import { formatClockTime, formatMeetingDay, formatMeetingTimes, safeMeetingHref } from '../../lib/meetingFormat';
import { isUnderWay, startsLabel } from '../../lib/meeting-list';

/**
 * The next meeting (or the one under way), on top of the list: when it starts, where, who's coming,
 * and Join for an online one — one slim band.
 */
export function UpNextCard({ meeting: m, timeZone, now, project }: { meeting: Meeting; timeZone: string; now: Date; project: ProjectLook | null }) {
  const live = isUnderWay(m, now);
  // Under way: until when (the badge already says it is on); otherwise when it starts.
  const when = live ? (m.endAt ? `until ${formatClockTime(m.endAt, timeZone)}` : 'Happening now') : startsLabel(m, now, timeZone);
  const join = safeMeetingHref(m.onlineLink);
  const place = meetingPlace(m);
  return (
    <section
      aria-label="Up next"
      className={`mb-4 flex flex-wrap items-center gap-x-6 gap-y-3 rounded-2xl border px-4 py-3 shadow-soft sm:px-5 ${live ? 'border-brand/50 bg-brand/[0.07]' : 'border-brand/25 bg-brand/[0.035]'}`}
    >
      <div className="min-w-0 flex-[1_1_20rem]">
        <p className="flex flex-wrap items-center gap-x-2 text-xs">
          <span className="inline-flex items-center gap-1.5 font-bold uppercase tracking-wide text-brand">
            {live ? (
              <span aria-hidden="true" className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand opacity-60 motion-reduce:animate-none" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-brand" />
              </span>
            ) : null}
            {live ? 'Under way' : 'Up next'}
          </span>
          <span aria-hidden="true" className="text-ink-3">·</span>
          <span className="font-semibold text-ink">{when}</span>
        </p>
        <p className="mt-0.5 truncate font-display text-lg font-bold leading-tight text-ink" title={m.title}>
          <bdi>{m.title}</bdi>
        </p>
        <p className="mt-1 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-2">
          <span className="whitespace-nowrap tabular-nums">
            {formatMeetingDay(m.startAt, timeZone)} · {formatMeetingTimes(m.startAt, m.endAt, timeZone)}
          </span>
          {place ? (
            <span className="inline-flex min-w-0 items-center gap-1">
              <span className="flex-none text-ink-3">{m.location ? Icon.pin : Icon.video}</span>
              <span className="truncate">{place}</span>
            </span>
          ) : null}
          <MeetingProject project={project} />
        </p>
      </div>
      <People names={m.attendees} count={m.attendeeCount} />
      <div className="flex flex-none items-center gap-2">
        {join ? (
          <a
            href={join}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-xl bg-brand-gradient px-4 py-2 text-sm font-semibold text-white shadow-brand transition-shadow hover:shadow-lift"
          >
            {Icon.video}
            Join
          </a>
        ) : null}
        <Link
          to={`/meetings/${m.id}`}
          aria-label={`Open ${m.title}`}
          className={`inline-flex items-center rounded-xl px-4 py-2 text-sm font-semibold transition-colors ${join ? 'border border-line bg-surface text-ink hover:border-brand/40' : 'bg-brand-gradient text-white shadow-brand hover:shadow-lift'}`}
        >
          Open
        </Link>
      </div>
    </section>
  );
}
