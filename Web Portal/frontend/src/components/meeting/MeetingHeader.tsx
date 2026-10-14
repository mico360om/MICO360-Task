import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { MEETING_STATUS_LABELS, type Meeting } from '../../api/meetings';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { ActionMenu, type ActionMenuItem } from './ActionMenu';
import { Icon } from './kit';
import { ProjectAvatar, type ProjectLook } from '../ProjectAvatar';
import { formatMeetingDay, formatMeetingTimes, meetingStatusTone, safeMeetingHref } from '../../lib/meetingFormat';
import type { PrimaryAction } from '../../lib/meeting-flow';

const PRIMARY_LABEL: Record<PrimaryAction, string> = {
  schedule: 'Schedule & invite',
  invite: 'Send invitations',
  start: 'Start meeting',
  end: 'End meeting',
  'email-minutes': 'Email minutes…',
  'export-minutes': 'Export minutes (PDF)',
  duplicate: 'Duplicate',
};

function Fact({ icon, children, title }: { icon: ReactNode; children: ReactNode; title?: string }) {
  return (
    <li className="flex min-w-0 items-center gap-1.5" title={title}>
      <span className="shrink-0 text-ink-3">{icon}</span>
      <span className="min-w-0 truncate">{children}</span>
    </li>
  );
}

/**
 * The meeting at a glance: title and status, then when, where and who — and one main button for
 * the next step, with everything else in a menu.
 */
export function MeetingHeader({
  meeting,
  project,
  organizerName,
  timeZone,
  live,
  primary,
  primaryBusy,
  onPrimary,
  menu,
}: {
  meeting: Meeting;
  project: ProjectLook | null;
  organizerName: string | null;
  timeZone: string;
  live: boolean;
  primary: PrimaryAction | null;
  primaryBusy?: boolean;
  onPrimary: () => void;
  menu: ActionMenuItem[];
}) {
  const zone = meeting.timeZone || timeZone;
  const joinHref = safeMeetingHref(meeting.onlineLink);
  const cancelled = meeting.status === 'CANCELLED';
  return (
    <header className="mb-5">
      <Link to="/meetings" className="tap inline-flex items-center gap-1 text-sm text-ink-2 hover:text-ink">← Meetings</Link>
      <div className="mt-2 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <div className="mb-1.5 flex flex-wrap items-center gap-2">
            <Badge tone={meetingStatusTone(meeting.status)}>{MEETING_STATUS_LABELS[meeting.status]}</Badge>
            {live ? <Badge tone="brand" dot>Live — updates automatically</Badge> : null}
            {meeting.invitesSentAt ? (
              <span className="inline-flex items-center gap-1 text-xs text-ink-3">{Icon.mail} Invitations sent {formatMeetingDay(meeting.invitesSentAt, timeZone)}</span>
            ) : meeting.status !== 'CANCELLED' && meeting.status !== 'COMPLETED' ? (
              <span className="text-xs text-ink-3">Invitations not sent yet</span>
            ) : null}
          </div>
          {/* Inline title (bdi): an Arabic title stays on the same side as everything else. */}
          <h1 className={`break-words font-display text-2xl font-bold leading-tight text-ink sm:text-[1.7rem] ${cancelled ? 'line-through decoration-2' : ''}`}>
            <bdi>{meeting.title}</bdi>
          </h1>
          <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1.5 text-sm text-ink-2">
            <Fact icon={project ? <ProjectAvatar project={project} size="xs" /> : Icon.folder}>{project ? <bdi>{project.name}</bdi> : meeting.projectId ? 'Project' : 'Standalone meeting'}</Fact>
            <Fact icon={Icon.calendar}>{formatMeetingDay(meeting.startAt, zone)}</Fact>
            <Fact icon={Icon.clock} title={`Company time (${zone})`}>{formatMeetingTimes(meeting.startAt, meeting.endAt, zone)}</Fact>
            <Fact icon={Icon.globe}>{zone}</Fact>
            {meeting.location ? <Fact icon={Icon.pin}><bdi>{meeting.location}</bdi></Fact> : null}
            {joinHref ? (
              <li className="flex items-center gap-1.5">
                <span className="text-ink-3">{Icon.video}</span>
                <a href={joinHref} target="_blank" rel="noopener noreferrer" className="tap font-medium text-brand hover:underline">Join online</a>
              </li>
            ) : null}
            <Fact icon={Icon.user}>Organizer: {organizerName ? <bdi>{organizerName}</bdi> : '—'}</Fact>
          </ul>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {primary ? (
            <Button size="md" variant={primary === 'duplicate' || primary === 'export-minutes' ? 'secondary' : 'primary'} loading={primaryBusy} onClick={onPrimary}>
              {PRIMARY_LABEL[primary]}
            </Button>
          ) : null}
          <ActionMenu
            label="More meeting actions"
            items={menu}
            buttonClassName="grid h-10 w-10 place-items-center rounded-xl border border-line bg-surface text-ink-2 transition-colors hover:border-brand/30 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
          />
        </div>
      </div>
    </header>
  );
}
