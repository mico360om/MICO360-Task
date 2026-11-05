import { useMemo, useState } from 'react';
import { useShortcut } from '../components/shortcuts/ShortcutProvider';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { meetingsApi, type Meeting, type MeetingPerson, type MeetingStatus } from '../api/meetings';
import { useProjectsWith } from '../lib/useProjectsWith';
import { usersApi, type DirectoryUser } from '../api/users';
import { apiClient } from '../api/client';
import { MeetingFormModal } from '../components/MeetingFormModal';
import { PageProblem, isMissing } from '../components/ui/PageProblem';
import { MeetingHeader } from '../components/meeting/MeetingHeader';
import { AgendaSection } from '../components/meeting/AgendaSection';
import { NotesSection } from '../components/meeting/NotesSection';
import { ActionItemsSection } from '../components/meeting/ActionItemsSection';
import { AttendeesPanel } from '../components/meeting/AttendeesPanel';
import { InviteDialog } from '../components/meeting/InviteDialog';
import { MinutesEmailDialog, type MinutesPrefill } from '../components/meeting/MinutesEmailDialog';
import { MinutesSentLog } from '../components/meeting/MinutesSentLog';
import { FinalMinutesSection } from '../components/meeting/FinalMinutesSection';
import { InviteeView } from '../components/meeting/InviteeView';
import { TeamsLinkNotice } from '../components/meeting/TeamsLinkNotice';
import { CancelMeetingDialog, DeleteMeetingDialog, exportMinutes, meetingFailure, useDuplicateMeeting } from '../components/meeting/meeting-actions';
import { Section, userName, type MeetingPageUser } from '../components/meeting/kit';
import type { ActionMenuItem } from '../components/meeting/ActionMenu';
import { primaryAction } from '../lib/meeting-flow';
import { recurrenceSummary } from '../lib/recurrence-summary';
import type { RecurrenceRule } from '../lib/recurrence';
import { useCompanyTimeZone } from '../lib/useCompanyTimeZone';
import { useMeetingRealtime, type MeetingChangeKind } from '../lib/useMeetingRealtime';
import { useCurrentProject } from '../components/CurrentProject';
import { usePageName } from '../lib/page-meta';
import { useFoundAnchor } from '../lib/useFoundAnchor';
import { meetingSeriesApi } from '../api/meeting-series';
import { SeriesLine } from '../components/meeting/series/SeriesLine';
import { CarryOverSection, SeriesSection } from '../components/meeting/series/SeriesSection';
import { AddToSeriesDialog, RemoveFromSeriesDialog } from '../components/meeting/series/SeriesDialogs';
import { MeetingTable, useMeetingTableAvailable } from '../components/meeting/MeetingTable';
import { VIEW_ICONS, ViewSwitch } from '../components/data-table/ViewSwitch';
import { useViewChoice } from '../components/data-table/hooks';
import { isProjectArchived } from '../lib/project-archive';

/** While a meeting is running, poll its live parts so standalone meetings (no socket room) stay current too. */
const LIVE_POLL_MS = 10_000;

type Dialog = 'edit' | 'invite' | 'minutes' | 'cancel' | 'delete' | 'add-series' | 'remove-series' | null;
const AGENDA_VIEWS = [
  { value: 'list' as const, label: 'List', icon: VIEW_ICONS.list },
  { value: 'table' as const, label: 'Table', icon: VIEW_ICONS.table },
];

export function MeetingDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const timeZone = useCompanyTimeZone();
  const [dialog, setDialog] = useState<Dialog>(null);
  // Send again (from the minutes' "Sent" log): the email opens with that send's To and Cc.
  const [minutesPrefill, setMinutesPrefill] = useState<MinutesPrefill | null>(null);
  const [notice, setNotice] = useState<{ text: string; error?: boolean } | null>(null);

  const meetingQ = useQuery({
    queryKey: ['meeting', id],
    queryFn: () => meetingsApi(apiClient).get(id),
    enabled: !!id,
    // Poll while the meeting is running so status/details changed by others show up.
    refetchInterval: (q) => (q.state.data?.status === 'IN_PROGRESS' ? LIVE_POLL_MS : false),
  });
  const meeting = meetingQ.data;
  // A project meeting: New task starts in its project.
  useCurrentProject(meeting?.projectId);
  usePageName(meeting?.title);
  // 1.23: a search result's place in the meeting (#note-…, #final-minutes) comes into view, marked.
  useFoundAnchor(!!meeting);
  const live = meeting?.status === 'IN_PROGRESS';
  const pollMs = live ? LIVE_POLL_MS : false;
  // companies: the roster comes with the meeting's people by name; they are kept beside it (its own
  // cache entry), so the page can name people my directory doesn't know (an invitee's view).
  const peopleKey = ['meeting', id, 'people'] as const;
  const attendeesQ = useQuery({
    queryKey: ['meeting', id, 'attendees'],
    queryFn: async () => {
      const { attendees, people } = await meetingsApi(apiClient).listAttendeesWithPeople(id);
      qc.setQueryData(peopleKey, people);
      return attendees;
    },
    enabled: !!id,
    refetchInterval: pollMs,
  });
  const peopleQ = useQuery<MeetingPerson[]>({ queryKey: peopleKey, queryFn: async () => [], enabled: false });
  // (1.22: also a project off an administrator's "Show my projects only" list, opened by its link.)
  const { projects: projectList } = useProjectsWith(meetingQ.data?.projectId);
  const dirQ = useQuery({ queryKey: ['directory'], queryFn: () => usersApi(apiClient).directory() });
  const people = peopleQ.data;
  const knownPeople = useMemo(() => withMeetingPeople(Array.isArray(dirQ.data) ? dirQ.data : [], Array.isArray(people) ? people : []), [dirQ.data, people]);
  // The final minutes (Final MOM), shared with their card: once final, the minutes PDF opens with them.
  const finalQ = useQuery({ queryKey: ['meeting', id, 'final-minutes'], queryFn: () => meetingsApi(apiClient).getFinalMinutes(id), enabled: !!id });
  // companies: invited from outside its project's companies — the server sends only their own action items.
  const invitee = meeting?.view === 'invitee';
  const myItemsQ = useQuery({ queryKey: ['meeting', id, 'action-items'], queryFn: () => meetingsApi(apiClient).listActionItems(id), enabled: !!id && invitee, refetchInterval: pollMs });
  // 1.23: its series — the meetings of it this person may open, where this one sits, and the carry-over.
  const seriesQ = useQuery({ queryKey: ['meeting', id, 'series'], queryFn: () => meetingSeriesApi(apiClient).ofMeeting(id), enabled: !!id && !!meeting?.seriesId });
  const seriesContext = meeting?.seriesId ? (seriesQ.data ?? null) : null;

  // 1.23.0: the agenda and action items as a list (two sections) or one table — offered once the
  // meeting has a topic or an action item, remembered for the person.
  const [agendaView, setAgendaView] = useViewChoice('meeting.view', ['list', 'table'] as const, 'list');
  const tableAvailable = useMeetingTableAvailable(id);

  // Live updates from other people in the meeting (notes, agenda, attendees, action items).
  useMeetingRealtime(id, meeting?.projectId ?? null, (kind: MeetingChangeKind) => {
    if (kind === 'reconnect') {
      void qc.invalidateQueries({ queryKey: ['meeting', id] });
      return;
    }
    if (kind === 'meeting') {
      void qc.invalidateQueries({ queryKey: ['meeting', id], exact: true });
      void qc.invalidateQueries({ queryKey: ['meeting', id, 'series'] }); // its series changed, or a meeting of it
      void qc.invalidateQueries({ queryKey: ['meeting', id, 'final-minutes'] }); // saved, approved or reopened by someone else
      void qc.invalidateQueries({ queryKey: ['meetings'] });
      return;
    }
    void qc.invalidateQueries({ queryKey: ['meeting', id, kind] });
    if (kind === 'action-items') void qc.invalidateQueries({ queryKey: ['my-action-items'] });
    if (kind === 'action-items') void qc.invalidateQueries({ queryKey: ['meeting', id, 'series'] });
  });

  const statusMut = useMutation({
    mutationFn: (status: MeetingStatus) => meetingsApi(apiClient).update(id, { status }),
    onSuccess: (updated) => {
      qc.setQueryData(['meeting', id], (old: Meeting | undefined) => (old ? { ...old, ...updated } : updated));
      void qc.invalidateQueries({ queryKey: ['meetings'] });
      setNotice({ text: updated.status === 'IN_PROGRESS' ? 'The meeting has started.' : updated.status === 'COMPLETED' ? 'The meeting has ended. You can now send the minutes.' : 'Saved.' });
    },
    onError: (err) => setNotice({ text: meetingFailure(err, 'Couldn’t change the meeting’s status.'), error: true }),
  });
  const duplicate = useDuplicateMeeting(
    (copy) => navigate(`/meetings/${copy.id}`),
    (text) => setNotice({ text, error: true }),
  );
  // One minutes PDF: the Final MOM first once it is approved (the file is then named as final).
  const exportPdf = () =>
    void exportMinutes(meeting!, finalQ.data?.status === 'FINAL' ? 'final' : 'working').catch((err) => setNotice({ text: meetingFailure(err, 'Couldn’t export the minutes.'), error: true }));

  // E edits the meeting and Delete asks to delete it, for those who may.
  const mayEdit = !!meeting && meeting.canEdit !== false;
  useShortcut('edit', () => setDialog('edit'), { enabled: mayEdit && meeting?.status !== 'CANCELLED' });
  useShortcut('delete', () => setDialog('delete'), { enabled: mayEdit });

  if (meetingQ.isLoading) {
    return (
      // Its own key: the page replaces it rather than reusing its boxes, which would slide down.
      <div key="loading" aria-busy="true">
        <div className="skeleton h-4 w-24" />
        <div className="skeleton mt-4 h-8 w-80 max-w-full" />
        <div className="skeleton mt-3 h-4 w-96 max-w-full" />
        <div className="mt-6 grid gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="skeleton h-64 w-full" />
          <div className="skeleton h-48 w-full" />
        </div>
      </div>
    );
  }
  if (meetingQ.isError || !meeting) {
    // A missing meeting and a failed load are different problems: only the second can be retried.
    const missing = !meetingQ.isError || isMissing(meetingQ.error);
    return (
      <PageProblem
        title={missing ? 'Meeting not found' : 'Couldn’t load this meeting'}
        message={missing ? 'It may have been deleted, or you don’t have access to it.' : 'Check your connection and try again.'}
        backTo="/meetings"
        backLabel="Back to meetings"
        onRetry={missing ? undefined : () => void meetingQ.refetch()}
        retrying={meetingQ.isFetching}
      />
    );
  }

  if (meeting.view === 'invitee') {
    // The minutes once approved (a 404 before: not ready), their own action items, the agenda and people.
    return (
      <InviteeView
        meeting={meeting}
        minutes={finalQ.data ?? null}
        myActionItems={Array.isArray(myItemsQ.data) ? myItemsQ.data : []}
        actionItemsLoading={!myItemsQ.data && !myItemsQ.isError}
        attendees={Array.isArray(attendeesQ.data) ? attendeesQ.data : []}
        attendeesLoading={attendeesQ.isLoading}
        attendeesError={attendeesQ.isError}
        onRetryAttendees={() => void attendeesQ.refetch()}
        directory={knownPeople}
        timeZone={timeZone}
        series={seriesContext}
      />
    );
  }

  // Only organizers/managers may manage the meeting; older servers don't send the flag (→ allowed).
  const canEdit = meeting.canEdit !== false;
  const directory = knownPeople;
  const project = meeting.projectId ? projectList.find((p) => p.id === meeting.projectId) ?? null : null;
  const ended = meeting.status === 'CANCELLED' || meeting.status === 'COMPLETED';
  const primary = primaryAction(meeting, canEdit);

  const runPrimary = () => {
    if (primary === 'schedule' || primary === 'invite') setDialog('invite');
    else if (primary === 'start') statusMut.mutate('IN_PROGRESS');
    else if (primary === 'end') statusMut.mutate('COMPLETED');
    else if (primary === 'email-minutes') setDialog('minutes');
    else if (primary === 'export-minutes') exportPdf();
    else if (primary === 'duplicate') duplicate.mutate(meeting.id);
  };

  // Everything that isn't the main button; the destructive pair sits apart at the bottom.
  const menu: ActionMenuItem[] = [];
  if (canEdit && meeting.status !== 'CANCELLED') menu.push({ label: 'Edit details', shortcut: 'edit', onSelect: () => setDialog('edit') });
  if (canEdit && meeting.status === 'DRAFT') menu.push({ label: 'Schedule without inviting', onSelect: () => statusMut.mutate('SCHEDULED') });
  if (canEdit && !ended && primary !== 'invite' && primary !== 'schedule') menu.push({ label: 'Invitations…', onSelect: () => setDialog('invite') });
  if (canEdit && meeting.status === 'SCHEDULED' && primary !== 'start') menu.push({ label: 'Start meeting', onSelect: () => statusMut.mutate('IN_PROGRESS') });
  if (canEdit && meeting.status !== 'CANCELLED' && primary !== 'email-minutes') menu.push({ label: 'Email minutes…', onSelect: () => setDialog('minutes') });
  if (primary !== 'export-minutes') menu.push({ label: 'Export minutes (PDF)', onSelect: exportPdf });
  if (primary !== 'duplicate') menu.push({ label: 'Duplicate', onSelect: () => duplicate.mutate(meeting.id) });
  // 1.23: put it in a series, or take it out (its organizer, the project's managers, an administrator).
  // A repeating meeting is always in a series — its own automatic one until it is put in another (with all its meetings).
  const repeatsInOwnSeries = !!seriesContext?.series.auto && !!seriesContext.meetings.find((m) => m.id === meeting.id)?.repeats;
  if (canEdit && (meeting.seriesId === null || repeatsInOwnSeries)) menu.push({ label: 'Add to a series…', onSelect: () => setDialog('add-series') });
  if (seriesContext?.canRemove) menu.push({ label: 'Remove from series…', onSelect: () => setDialog('remove-series') });
  if (canEdit && !ended) menu.push({ label: 'Cancel meeting…', danger: true, onSelect: () => setDialog('cancel') });
  if (canEdit) menu.push({ label: 'Delete meeting…', danger: true, shortcut: 'delete', onSelect: () => setDialog('delete') });

  const about = [
    meeting.category ? { k: 'Category', v: <bdi>{meeting.category}</bdi> } : null,
    meeting.recurrenceRule ? { k: 'Repeats', v: recurrenceSummary(meeting.recurrenceRule as unknown as RecurrenceRule).replace(/^Repeats /, '') } : null,
    { k: 'Created by', v: userName(directory, meeting.createdById) ? <bdi>{userName(directory, meeting.createdById)}</bdi> : '—' },
  ].filter(Boolean) as { k: string; v: React.ReactNode }[];

  const finished = meeting.status === 'COMPLETED';
  const switcher = tableAvailable ? <ViewSwitch label="Show the agenda as" value={agendaView} onChange={setAgendaView} options={AGENDA_VIEWS} /> : null;
  const asTable = tableAvailable && agendaView === 'table';
  // Each part keyed, so ending the meeting moves them (their state kept) instead of remaking them.
  const agenda = (
    <AgendaSection
      switcher={switcher}
      key="agenda"
      meetingId={id}
      startAt={meeting.startAt}
      endAt={meeting.endAt}
      directory={directory}
      canEdit={canEdit}
      ended={finished}
      pollMs={pollMs}
      // Draft agenda: the meeting's details, and its organizer and invited team members as leads.
      draftFrom={{
        title: meeting.title,
        description: meeting.description,
        projectId: meeting.projectId,
        peopleIds: [...new Set([meeting.organizerId, ...(Array.isArray(attendeesQ.data) ? attendeesQ.data : []).flatMap((a) => (a.userId ? [a.userId] : []))])],
      }}
    />
  );
  const notes = <NotesSection key="notes" meetingId={id} meetingProjectId={meeting.projectId} directory={directory} canEdit={canEdit} pollMs={pollMs} timeZone={timeZone} ended={finished} />;
  const actions = <ActionItemsSection key="actions" meetingId={id} directory={directory} canEdit={canEdit} pollMs={pollMs} timeZone={timeZone} ended={finished} />;
  // 1.23: the open action items of the series' earlier meetings (the same items: their status changes everywhere).
  const carryOver = seriesContext ? <CarryOverSection key="carry-over" context={seriesContext} meetingId={id} timeZone={timeZone} editable /> : null;
  // 1.23.0: the agenda and action items as one table, in the agenda's place (the add forms under it).
  // An archived project's meeting takes no changes on the server: its table is there to look at.
  const table = (
    <MeetingTable key="table" meetingId={id} directory={directory} canEdit={canEdit} pollMs={pollMs} timeZone={timeZone} switcher={switcher} locked={project && isProjectArchived(project) ? 'archived' : null} />
  );
  const agendaParts = asTable ? [table] : [agenda];
  const actionParts = asTable ? [] : [actions];
  // The minutes' "Sent" log ends their card, for the people who may send (Send again: the same To and Cc).
  const sentLog = canEdit ? (
    <MinutesSentLog
      meetingId={id}
      timeZone={timeZone}
      ended={finished}
      canSend={meeting.status !== 'CANCELLED'}
      onSendAgain={(prefill) => {
        setMinutesPrefill(prefill);
        setDialog('minutes');
      }}
    />
  ) : null;
  const finalMom = (
    <FinalMinutesSection
      key="final"
      meetingId={id}
      meetingTitle={meeting.title}
      canEdit={canEdit}
      timeZone={timeZone}
      footer={sentLog}
      // A finished meeting: Notes → Final MOM → Approved → Emailed, with the one next button.
      finished={finished}
      onEmail={() => {
        setMinutesPrefill(null);
        setDialog('minutes');
      }}
    />
  );

  return (
    <div>
      <MeetingHeader
        meeting={meeting}
        project={project}
        organizerName={userName(directory, meeting.organizerId)}
        timeZone={timeZone}
        live={live}
        primary={primary}
        primaryBusy={statusMut.isPending || duplicate.isPending}
        onPrimary={runPrimary}
        menu={menu}
        series={seriesContext ? <SeriesLine context={seriesContext} timeZone={timeZone} /> : null}
      />

      {/* 1.23: waiting for its Teams link — its organizer can make it now. */}
      <TeamsLinkNotice
        meeting={meeting}
        onMade={() => {
          void qc.invalidateQueries({ queryKey: ['meeting', id], exact: true });
          void qc.invalidateQueries({ queryKey: ['meetings'] });
          setNotice({ text: 'The Teams link is made.' });
        }}
      />

      {notice ? (
        <div role={notice.error ? 'alert' : 'status'} className={`mb-4 flex items-center justify-between gap-3 rounded-lg px-3 py-2 text-sm ${notice.error ? 'bg-danger-soft text-danger' : 'bg-success-soft text-success'}`}>
          <span>{notice.text}</span>
          <button type="button" onClick={() => setNotice(null)} aria-label="Dismiss" className="shrink-0 rounded px-1 opacity-80 hover:opacity-100">✕</button>
        </div>
      ) : null}

      {/* Phone to small laptop: one column in reading order, About and People side by side under the
          work from lg. Wide screen (xl): the work in the middle, people and facts on the side — below xl
          a side column left the agenda, notes and action items only about 400px. */}
      <div className="grid gap-4 lg:gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex min-w-0 flex-col gap-4 lg:gap-5">
          {/* Planned or under way: the agenda and the live notes lead. Once finished, what came of it
              leads — the Final MOM and the action items, above the agenda and notes they came from. The
              page's own order (not CSS order), so the keyboard and a screen reader follow it too. */}
          {finished ? [finalMom, ...actionParts, carryOver, ...agendaParts, notes] : [...agendaParts, carryOver, notes, ...actionParts, finalMom]}
        </div>
        <aside className="flex min-w-0 flex-col gap-4 lg:grid lg:grid-cols-2 lg:items-start lg:gap-5 xl:flex xl:items-stretch" aria-label="Meeting information">
          <Section id="about" title="About">
            {meeting.description ? <p dir="auto" className="mb-3 whitespace-pre-wrap text-start text-sm text-ink">{meeting.description}</p> : <p className="mb-3 text-sm text-ink-3">No description.</p>}
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-sm">
              {about.map((row) => (
                <div key={row.k} className="contents">
                  <dt className="text-ink-3">{row.k}</dt>
                  <dd className="min-w-0 text-ink">{row.v}</dd>
                </div>
              ))}
            </dl>
          </Section>
          <AttendeesPanel
            meeting={meeting}
            attendees={Array.isArray(attendeesQ.data) ? attendeesQ.data : []}
            directory={directory}
            loading={attendeesQ.isLoading}
            loadError={attendeesQ.isError}
            onRetry={() => void attendeesQ.refetch()}
            canEdit={canEdit}
          />
          {seriesContext ? <SeriesSection context={seriesContext} meetingId={id} timeZone={timeZone} canAddNew={seriesContext.canAdd !== false} /> : null}
        </aside>
      </div>

      {dialog === 'edit' ? <MeetingFormModal meeting={meeting} onClose={() => setDialog(null)} /> : null}
      {dialog === 'invite' ? <InviteDialog meeting={meeting} onClose={() => setDialog(null)} /> : null}
      {dialog === 'minutes' ? (
        <MinutesEmailDialog
          meeting={meeting}
          prefill={minutesPrefill ?? undefined}
          onClose={() => {
            setDialog(null);
            setMinutesPrefill(null);
          }}
        />
      ) : null}
      {dialog === 'cancel' ? <CancelMeetingDialog meeting={meeting} onClose={() => setDialog(null)} onDone={(scope) => setNotice({ text: scope === 'series' ? 'The upcoming repeats of this meeting are cancelled.' : 'Meeting cancelled.' })} /> : null}
      {dialog === 'delete' ? <DeleteMeetingDialog meeting={meeting} onClose={() => setDialog(null)} onDone={() => navigate('/meetings')} /> : null}
      {dialog === 'add-series' ? <AddToSeriesDialog meeting={meeting} onClose={() => setDialog(null)} onDone={(name) => setNotice({ text: `Added to the series “${name}”.` })} /> : null}
      {dialog === 'remove-series' && seriesContext ? (
        <RemoveFromSeriesDialog
          series={seriesContext.series}
          meetingId={meeting.id}
          repeats={!!seriesContext.meetings.find((m) => m.id === meeting.id)?.repeats}
          onClose={() => setDialog(null)}
          onDone={() => setNotice({ text: 'Removed from the series.' })}
        />
      ) : null}
    </div>
  );
}

/**
 * The people directory plus the meeting's people it doesn't know (named by the roster): they are
 * named on the page, never offered in a picker (colleague: false keeps them out of pickers). 1.23: a
 * client among them is marked (clients aren't in the directory) — "Client" on the People list, and
 * offered as an action item's owner.
 */
function withMeetingPeople(directory: DirectoryUser[], people: MeetingPerson[]): MeetingPageUser[] {
  const known = new Set(directory.map((d) => d.id));
  const extra = people
    .filter((p) => !known.has(p.id))
    .map((p): MeetingPageUser => ({ id: p.id, username: '', firstName: p.name, lastName: '', avatarUrl: p.avatarUrl, colleague: false, ...(p.client ? { client: true } : {}) }));
  return extra.length ? [...directory, ...extra] : directory;
}
