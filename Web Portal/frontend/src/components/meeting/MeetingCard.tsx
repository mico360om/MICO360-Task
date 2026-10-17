import { Link } from 'react-router-dom';
import { MEETING_STATUS_LABELS, seriesIdOf, type Meeting } from '../../api/meetings';
import { Badge } from '../ui/Badge';
import { ProjectAvatar, type ProjectLook } from '../ProjectAvatar';
import { ActionMenu, type ActionMenuItem } from './ActionMenu';
import { DateLeaf, MINUTES, People } from './meeting-card-parts';
import { Icon } from './kit';
import { formatMeetingDay, formatMeetingTimes, meetingStatusTone } from '../../lib/meetingFormat';
import { isUnderWay } from '../../lib/meeting-list';
import { todayKey, zonedDayKey } from '../../lib/due-date';

/** Where it happens: the place, else "Online". */
export function meetingPlace(m: Pick<Meeting, 'location' | 'onlineLink'>) {
  return m.location ? <bdi>{m.location}</bdi> : m.onlineLink ? 'Online' : null;
}

/** The meeting's project with its picture, or "Standalone". */
export function MeetingProject({ project: p }: { project: ProjectLook | null }) {
  return (
    <span className={`inline-flex min-w-0 items-center ${p ? 'gap-1.5 text-ink-2' : 'gap-1 text-ink-3'}`}>
      {p ? <ProjectAvatar project={p} size="xs" /> : <span aria-hidden="true" className="h-1.5 w-1.5 flex-none rounded-full bg-line" />}
      <span className="truncate">{p ? <bdi>{p.name}</bdi> : 'Standalone'}</span>
    </span>
  );
}

/**
 * A meeting in the list: its day, title, time and place, project and organizer; underneath, who's
 * coming and how far it got — minutes, decisions, open action items. The whole card opens the
 * meeting; "⋯" holds the rest.
 */
export function MeetingCard({
  meeting: m,
  timeZone,
  now,
  project,
  organizer,
  actions,
  statusShown = true,
}: {
  meeting: Meeting;
  timeZone: string;
  now: Date;
  project: ProjectLook | null;
  organizer: string | null;
  actions: ActionMenuItem[];
  /** False where the group already says it (a draft among Drafts). */
  statusShown?: boolean;
}) {
  const cancelled = m.status === 'CANCELLED';
  const day = zonedDayKey(new Date(m.startAt), timeZone);
  const today = todayKey(timeZone, now);
  const live = isUnderWay(m, now);
  const tone = cancelled || m.status === 'COMPLETED' || day < today ? 'muted' : day === today ? 'today' : 'upcoming';
  const place = meetingPlace(m);
  const minutes = m.minutes ? MINUTES[m.minutes] : null;
  const open = m.openActionItemCount ?? 0;
  const decisions = m.decisionCount ?? 0;
  return (
    <article
      data-meeting-card
      className={`relative flex flex-col rounded-xl border bg-surface shadow-soft transition-[border-color,box-shadow] hover:border-brand/35 hover:shadow-lift focus-within:z-20 ${live ? 'border-brand/50' : 'border-line'} ${cancelled ? 'bg-ground/40' : ''}`}
    >
      <div className="flex gap-3 p-3 pb-2.5">
        <DateLeaf iso={m.startAt} timeZone={timeZone} tone={tone} />
        <div className="min-w-0 flex-1">
          <h3 className="text-[15px] font-semibold leading-snug">
            {/* The title is inline (bdi), so an Arabic title stays beside its details instead of
                jumping to the far side. Its link covers the card. */}
            <Link
              to={`/meetings/${m.id}`}
              title={m.title}
              className={`line-clamp-2 outline-none [overflow-wrap:anywhere] after:absolute after:inset-0 after:rounded-xl after:content-[''] hover:text-brand focus-visible:after:ring-2 focus-visible:after:ring-brand/50 ${cancelled ? 'text-ink-3 line-through' : 'text-ink'}`}
            >
              <bdi>{m.title}</bdi>
            </Link>
          </h3>
          <p className="mt-0.5 flex min-w-0 items-center gap-1 text-xs text-ink-2">
            <span className="sr-only">{formatMeetingDay(m.startAt, timeZone)}, </span>
            <span className="whitespace-nowrap tabular-nums">{formatMeetingTimes(m.startAt, m.endAt, timeZone)}</span>
            {place ? (
              <>
                <span aria-hidden="true">·</span>
                <span className="truncate">{place}</span>
              </>
            ) : null}
          </p>
          <p className="mt-1 flex min-w-0 items-center gap-x-3 text-xs">
            <MeetingProject project={project} />
            {organizer ? (
              <span className="inline-flex min-w-0 items-center gap-1 text-ink-3" title="Organizer">
                <span className="flex-none">{Icon.user}</span>
                <span className="sr-only">Organizer: </span>
                <span className="truncate"><bdi>{organizer}</bdi></span>
              </span>
            ) : null}
          </p>
        </div>
        <ActionMenu label={`More actions for ${m.title}`} items={actions} className="relative z-10 -me-1.5 -mt-1 flex-none self-start" />
      </div>
      <div className="mt-auto flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 border-t border-line px-3 py-2">
        <People names={m.attendees} count={m.attendeeCount} />
        <div className="flex flex-wrap items-center justify-end gap-1.5 text-xs">
          {live ? <Badge tone="brand" dot>Under way</Badge> : m.status !== 'SCHEDULED' && statusShown ? <Badge tone={meetingStatusTone(m.status)}>{MEETING_STATUS_LABELS[m.status]}</Badge> : null}
          {minutes ? <Badge tone={minutes.tone}>{minutes.label}</Badge> : null}
          {decisions ? <span className="text-ink-2">{decisions} {decisions === 1 ? 'decision' : 'decisions'}</span> : null}
          {open ? <Badge tone="warning">{open} open</Badge> : null}
          {seriesIdOf(m) ? (
            <span className="text-ink-3" title="Part of a repeating series">
              {Icon.repeat}
              <span className="sr-only">Repeats</span>
            </span>
          ) : null}
        </div>
      </div>
    </article>
  );
}
