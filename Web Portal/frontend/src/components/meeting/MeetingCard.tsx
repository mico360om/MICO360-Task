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
    // Two rows of the list's grid, shared with the cards beside it (subgrid): every card in a row has
    // the same details height and the same footer height, so the people and the status chips sit at
    // the same height on each card however much a title wraps or the chips do.
    <article
      data-meeting-card
      className={`relative row-span-2 grid grid-rows-subgrid gap-y-0 rounded-xl border bg-surface shadow-soft transition-[border-color,box-shadow] hover:border-brand/35 hover:shadow-lift focus-within:z-20 ${live ? 'border-brand/50' : 'border-line'} ${cancelled ? 'bg-ground/40' : ''}`}
    >
      <div className="flex min-w-0 gap-3 p-3.5 pb-3 sm:gap-3.5 sm:p-4 sm:pb-3">
        <DateLeaf iso={m.startAt} timeZone={timeZone} tone={tone} className="self-start" />
        <div className="min-w-0 flex-1">
          <h3 className="text-[15px] font-semibold leading-snug sm:text-base">
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
          {/* The place moves under the time when both don't fit, instead of being cut to "BE …". */}
          <p className="mt-1 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5 text-sm text-ink-2">
            <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
              <span className="sr-only">{formatMeetingDay(m.startAt, timeZone)}, </span>
              <span className="flex-none text-ink-3">{Icon.clock}</span>
              <span className="tabular-nums">{formatMeetingTimes(m.startAt, m.endAt, timeZone)}</span>
            </span>
            {place ? (
              <span className="inline-flex min-w-0 max-w-full items-center gap-1.5">
                <span className="flex-none text-ink-3">{m.location ? Icon.pin : Icon.video}</span>
                <span className="truncate">{place}</span>
              </span>
            ) : null}
          </p>
          {/* The organizer moves under the project when both don't fit, instead of shrinking to a letter. */}
          <p className="mt-1.5 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs">
            <MeetingProject project={project} />
            {organizer ? (
              <span className="inline-flex min-w-0 max-w-full items-center gap-1 text-ink-2" title="Organizer">
                <span className="flex-none text-ink-3">{Icon.user}</span>
                <span className="sr-only">Organizer: </span>
                <span className="truncate"><bdi>{organizer}</bdi></span>
              </span>
            ) : null}
          </p>
        </div>
        <ActionMenu label={`More actions for ${m.title}`} items={actions} className="relative z-10 -me-1.5 -mt-1 flex-none self-start" />
      </div>
      {/* The footer: who's coming, then how far it got. On a narrow card the chips take the line under
          the people; on a wide one (a container query on the card's width, the same for every card
          of a row) they sit on the right, wrapping downwards — never under the people. */}
      <div data-card-footer className="min-w-0 border-t border-line px-3.5 py-2.5 [container-type:inline-size] sm:px-4">
        <div className="flex flex-col items-start gap-y-1.5 [@container(min-width:27rem)]:flex-row [@container(min-width:27rem)]:gap-x-3">
          <People names={m.attendees} count={m.attendeeCount} className="flex-none" />
          {/* py-0.5: a line of chips is as tall as the faces, so beside them it sits level. */}
          <div data-card-chips className="flex min-w-0 flex-wrap items-center gap-1.5 py-0.5 text-xs empty:hidden [@container(min-width:27rem)]:ms-auto [@container(min-width:27rem)]:justify-end">
            {live ? <Badge tone="brand" dot>Under way</Badge> : m.status !== 'SCHEDULED' && statusShown ? <Badge tone={meetingStatusTone(m.status)}>{MEETING_STATUS_LABELS[m.status]}</Badge> : null}
            {minutes ? <Badge tone={minutes.tone}>{minutes.label}</Badge> : null}
            {decisions ? <span className="whitespace-nowrap text-ink-2">{decisions} {decisions === 1 ? 'decision' : 'decisions'}</span> : null}
            {open ? <Badge tone="warning">{open} open</Badge> : null}
            {seriesIdOf(m) ? (
              <span className="text-ink-3" title="Part of a repeating series">
                {Icon.repeat}
                <span className="sr-only">Repeats</span>
              </span>
            ) : null}
          </div>
        </div>
      </div>
    </article>
  );
}
