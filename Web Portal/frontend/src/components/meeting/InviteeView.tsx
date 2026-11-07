import { useMutation } from '@tanstack/react-query';
import { ACTION_STATUS_LABELS, type ActionItem, type Attendee, type FinalMinutes, type Meeting } from '../../api/meetings';
import type { DirectoryUser } from '../../api/users';
import { formatDueDate, isActionItemOverdue } from '../../lib/meetingFormat';
import { AgendaSection } from './AgendaSection';
import { AttendeesPanel } from './AttendeesPanel';
import { FinalView } from './FinalMinutesSection';
import { MeetingHeader } from './MeetingHeader';
import { Section, SectionError, userName } from './kit';
import { exportMinutes, meetingFailure } from './meeting-actions';
import type { MeetingSeriesContext } from '../../api/meeting-series';
import { SeriesLine } from './series/SeriesLine';
import { CarryOverSection, SeriesSection } from './series/SeriesSection';
import { carriedTableGroups } from './series/carried-groups';
import { MeetingTable, useMeetingTableAvailable } from './MeetingTable';
import { VIEW_ICONS, ViewSwitch } from '../data-table/ViewSwitch';
import { useViewChoice } from '../data-table/hooks';
import { OVERDUE_CLASS } from '../../lib/colour-classes';

const AGENDA_VIEWS = [
  { value: 'list' as const, label: 'List', icon: VIEW_ICONS.list },
  { value: 'table' as const, label: 'Table', icon: VIEW_ICONS.table },
];

/** The words under the title: why this person sees only part of the meeting. */
export const INVITEE_NOTE = 'You can see this meeting because you were invited.';

/**
 * A meeting as someone invited from outside its project's companies sees it (`view: 'invitee'`):
 * read-only — its header, agenda and people (they may still answer their own invitation), the Final
 * MOM once it is approved ("The minutes aren’t ready yet." before), and their own action items. No
 * notes, decisions, invitations, edits or client controls, and nothing else of the project.
 */
export function InviteeView({
  meeting,
  minutes,
  myActionItems,
  actionItemsLoading = false,
  attendees,
  directory,
  timeZone,
  attendeesLoading = false,
  attendeesError = false,
  onRetryAttendees = () => {},
  series = null,
}: {
  meeting: Meeting;
  /** The approved minutes, or null while they aren't (the server answers 404 until then). */
  minutes: FinalMinutes | null;
  myActionItems: ActionItem[];
  /** Their action items are still on their way (nothing is said about them yet). */
  actionItemsLoading?: boolean;
  attendees: Attendee[];
  directory: DirectoryUser[];
  timeZone: string;
  attendeesLoading?: boolean;
  attendeesError?: boolean;
  onRetryAttendees?: () => void;
  /** 1.23: its series as they see it — the meetings of it they may open, and their own open items from earlier ones. */
  series?: MeetingSeriesContext | null;
}) {
  const pdf = useMutation({ mutationFn: () => exportMinutes(meeting, 'final') });
  // 1.23.0: List | Table, as on the full page — the table shows what the list does: the agenda and their own items, to read.
  const [agendaView, setAgendaView] = useViewChoice('meeting.view', ['list', 'table'] as const, 'list');
  const tableAvailable = useMeetingTableAvailable(meeting.id, myActionItems);
  const switcher = tableAvailable ? <ViewSwitch label="Show the agenda as" value={agendaView} onChange={setAgendaView} options={AGENDA_VIEWS} /> : null;
  const asTable = tableAvailable && agendaView === 'table' && !actionItemsLoading;
  const finished = meeting.status === 'COMPLETED';
  const approved = minutes && minutes.status === 'FINAL' && minutes.content ? minutes : null;

  const minutesPart = (
    <Section key="final" id="final-minutes" title="Final MOM">
      {pdf.isError ? <SectionError message={meetingFailure(pdf.error, 'Couldn’t download the minutes.')} onDismiss={() => pdf.reset()} /> : null}
      {approved ? (
        <FinalView minutes={approved} content={approved.content!} timeZone={timeZone} canEdit={false} busy={false} downloading={pdf.isPending} onDownload={() => pdf.mutate()} onReopen={() => {}} />
      ) : (
        <p className="text-sm text-ink-3">The minutes aren’t ready yet.</p>
      )}
    </Section>
  );
  const actionsPart = (
    <Section key="actions" id="my-actions" title="Your action items">
      {actionItemsLoading ? (
        <p role="status" className="text-sm text-ink-3">Loading…</p>
      ) : myActionItems.length === 0 ? (
        <p className="text-sm text-ink-3">You have no action items from this meeting.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-line">
          {myActionItems.map((item) => {
            const done = item.status === 'COMPLETED' || item.status === 'CANCELLED';
            const overdue = isActionItemOverdue(item, timeZone);
            return (
              <li key={item.id} className="py-2.5">
                <p className={`text-sm ${done ? 'text-ink-3 line-through' : 'text-ink'}`}>
                  <bdi>{item.description}</bdi>
                </p>
                <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-ink-3">
                  {item.dueDate ? (
                    <span className={overdue ? `font-medium ${OVERDUE_CLASS.text}` : ''}>
                      Due {formatDueDate(item.dueDate, timeZone)}
                      {overdue ? ' — overdue' : ''}
                    </span>
                  ) : (
                    <span>No due date</span>
                  )}
                  <span aria-hidden="true">·</span>
                  <span>{ACTION_STATUS_LABELS[item.status]}</span>
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
  const agendaPart = asTable ? (
    <MeetingTable
      key="table"
      meetingId={meeting.id}
      directory={directory}
      canEdit={false}
      readOnly
      items={myActionItems}
      pollMs={false}
      timeZone={timeZone}
      switcher={switcher}
      // 1.23 series: their own open items from earlier meetings, the last group (to read, as their own items are).
      extraGroups={series ? carriedTableGroups(series.openFromEarlier, { timeZone, editable: false }) : []}
    />
  ) : (
    <AgendaSection key="agenda" meetingId={meeting.id} startAt={meeting.startAt} endAt={meeting.endAt} directory={directory} canEdit={false} ended={finished} pollMs={false} switcher={switcher} />
  );
  // Their own open items from the series' earlier meetings (read-only here, as their own items are).
  const carryPart = series ? <CarryOverSection key="carry-over" context={series} meetingId={meeting.id} timeZone={timeZone} editable={false} /> : null;
  // In the Table view they are the table's last group instead.
  const actionParts = asTable ? [] : [actionsPart];
  const carryParts = asTable ? [] : [carryPart];

  return (
    <div>
      <MeetingHeader
        meeting={meeting}
        project={null}
        organizerName={userName(directory, meeting.organizerId)}
        timeZone={timeZone}
        live={meeting.status === 'IN_PROGRESS'}
        primary={null}
        onPrimary={() => {}}
        menu={[]}
        note={INVITEE_NOTE}
        series={series ? <SeriesLine context={series} timeZone={timeZone} /> : null}
      />
      <div className="grid gap-4 lg:gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex min-w-0 flex-col gap-4 lg:gap-5">{finished ? [minutesPart, ...actionParts, ...carryParts, agendaPart] : [agendaPart, ...carryParts, ...actionParts, minutesPart]}</div>
        <aside className="flex min-w-0 flex-col gap-4 lg:grid lg:grid-cols-2 lg:items-start lg:gap-5 xl:flex xl:items-stretch" aria-label="Meeting information">
          <Section id="about" title="About">
            {meeting.description ? <p dir="auto" className="whitespace-pre-wrap text-start text-sm text-ink">{meeting.description}</p> : <p className="text-sm text-ink-3">No description.</p>}
          </Section>
          <AttendeesPanel meeting={meeting} attendees={attendees} directory={directory} loading={attendeesLoading} loadError={attendeesError} onRetry={onRetryAttendees} canEdit={false} />
          {series ? <SeriesSection context={series} meetingId={meeting.id} timeZone={timeZone} canAddNew={false} /> : null}
        </aside>
      </div>
    </div>
  );
}
