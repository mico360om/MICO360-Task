import { useState } from 'react';
import { useShortcut } from '../components/shortcuts/ShortcutProvider';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { meetingsApi, type Meeting, type MeetingStatus } from '../api/meetings';
import { projectsApi } from '../api/projects';
import { usersApi } from '../api/users';
import { apiClient } from '../api/client';
import { MeetingFormModal } from '../components/MeetingFormModal';
import { PageProblem, isMissing } from '../components/ui/PageProblem';
import { MeetingHeader } from '../components/meeting/MeetingHeader';
import { AgendaSection } from '../components/meeting/AgendaSection';
import { NotesSection } from '../components/meeting/NotesSection';
import { ActionItemsSection } from '../components/meeting/ActionItemsSection';
import { AttendeesPanel } from '../components/meeting/AttendeesPanel';
import { InviteDialog } from '../components/meeting/InviteDialog';
import { MinutesEmailDialog } from '../components/meeting/MinutesEmailDialog';
import { FinalMinutesSection } from '../components/meeting/FinalMinutesSection';
import { CancelMeetingDialog, DeleteMeetingDialog, exportMinutes, meetingFailure, useDuplicateMeeting } from '../components/meeting/meeting-actions';
import { Section, userName } from '../components/meeting/kit';
import type { ActionMenuItem } from '../components/meeting/ActionMenu';
import { primaryAction } from '../lib/meeting-flow';
import { recurrenceSummary } from '../lib/recurrence-summary';
import type { RecurrenceRule } from '../lib/recurrence';
import { useCompanyTimeZone } from '../lib/useCompanyTimeZone';
import { useMeetingRealtime, type MeetingChangeKind } from '../lib/useMeetingRealtime';
import { useCurrentProject } from '../components/CurrentProject';
import { usePageName } from '../lib/page-meta';

/** While a meeting is running, poll its live parts so standalone meetings (no socket room) stay current too. */
const LIVE_POLL_MS = 10_000;

type Dialog = 'edit' | 'invite' | 'minutes' | 'cancel' | 'delete' | null;

export function MeetingDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const timeZone = useCompanyTimeZone();
  const [dialog, setDialog] = useState<Dialog>(null);
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
  const live = meeting?.status === 'IN_PROGRESS';
  const pollMs = live ? LIVE_POLL_MS : false;
  const attendeesQ = useQuery({ queryKey: ['meeting', id, 'attendees'], queryFn: () => meetingsApi(apiClient).listAttendees(id), enabled: !!id, refetchInterval: pollMs });
  const projectsQ = useQuery({ queryKey: ['projects'], queryFn: () => projectsApi(apiClient).list() });
  const dirQ = useQuery({ queryKey: ['directory'], queryFn: () => usersApi(apiClient).directory() });
  // The final minutes (Final MOM), shared with their card: once final, the minutes PDF opens with them.
  const finalQ = useQuery({ queryKey: ['meeting', id, 'final-minutes'], queryFn: () => meetingsApi(apiClient).getFinalMinutes(id), enabled: !!id });

  // Live updates from other people in the meeting (notes, agenda, attendees, action items).
  useMeetingRealtime(id, meeting?.projectId ?? null, (kind: MeetingChangeKind) => {
    if (kind === 'reconnect') {
      void qc.invalidateQueries({ queryKey: ['meeting', id] });
      return;
    }
    if (kind === 'meeting') {
      void qc.invalidateQueries({ queryKey: ['meeting', id], exact: true });
      void qc.invalidateQueries({ queryKey: ['meeting', id, 'final-minutes'] }); // saved, approved or reopened by someone else
      void qc.invalidateQueries({ queryKey: ['meetings'] });
      return;
    }
    void qc.invalidateQueries({ queryKey: ['meeting', id, kind] });
    if (kind === 'action-items') void qc.invalidateQueries({ queryKey: ['my-action-items'] });
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
        <div className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
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

  // Only organizers/managers may manage the meeting; older servers don't send the flag (→ allowed).
  const canEdit = meeting.canEdit !== false;
  const directory = Array.isArray(dirQ.data) ? dirQ.data : [];
  const project = meeting.projectId ? (Array.isArray(projectsQ.data) ? projectsQ.data : []).find((p) => p.id === meeting.projectId) ?? null : null;
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
  if (canEdit && !ended) menu.push({ label: 'Cancel meeting…', danger: true, onSelect: () => setDialog('cancel') });
  if (canEdit) menu.push({ label: 'Delete meeting…', danger: true, shortcut: 'delete', onSelect: () => setDialog('delete') });

  const about = [
    meeting.category ? { k: 'Category', v: <bdi>{meeting.category}</bdi> } : null,
    meeting.recurrenceRule ? { k: 'Repeats', v: recurrenceSummary(meeting.recurrenceRule as unknown as RecurrenceRule).replace(/^Repeats /, '') } : null,
    { k: 'Created by', v: userName(directory, meeting.createdById) ? <bdi>{userName(directory, meeting.createdById)}</bdi> : '—' },
  ].filter(Boolean) as { k: string; v: React.ReactNode }[];

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
      />

      {notice ? (
        <div role={notice.error ? 'alert' : 'status'} className={`mb-4 flex items-center justify-between gap-3 rounded-lg px-3 py-2 text-sm ${notice.error ? 'bg-danger-soft text-danger' : 'bg-success-soft text-success'}`}>
          <span>{notice.text}</span>
          <button type="button" onClick={() => setNotice(null)} aria-label="Dismiss" className="shrink-0 rounded px-1 opacity-80 hover:opacity-100">✕</button>
        </div>
      ) : null}

      {/* Phone: one column in reading order. Desktop: the work in the middle, people and facts on the side. */}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem] lg:gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex min-w-0 flex-col gap-4 lg:gap-5">
          <AgendaSection
            meetingId={id}
            startAt={meeting.startAt}
            endAt={meeting.endAt}
            directory={directory}
            canEdit={canEdit}
            pollMs={pollMs}
            // Draft agenda: the meeting's details, and its organizer and invited team members as leads.
            draftFrom={{
              title: meeting.title,
              description: meeting.description,
              projectId: meeting.projectId,
              peopleIds: [...new Set([meeting.organizerId, ...(Array.isArray(attendeesQ.data) ? attendeesQ.data : []).flatMap((a) => (a.userId ? [a.userId] : []))])],
            }}
          />
          <NotesSection meetingId={id} meetingProjectId={meeting.projectId} directory={directory} canEdit={canEdit} pollMs={pollMs} timeZone={timeZone} />
          <ActionItemsSection meetingId={id} directory={directory} canEdit={canEdit} pollMs={pollMs} timeZone={timeZone} />
          <FinalMinutesSection meetingId={id} meetingTitle={meeting.title} canEdit={canEdit} timeZone={timeZone} />
        </div>
        <aside className="flex min-w-0 flex-col gap-4 lg:gap-5" aria-label="Meeting information">
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
        </aside>
      </div>

      {dialog === 'edit' ? <MeetingFormModal meeting={meeting} onClose={() => setDialog(null)} /> : null}
      {dialog === 'invite' ? <InviteDialog meeting={meeting} onClose={() => setDialog(null)} /> : null}
      {dialog === 'minutes' ? <MinutesEmailDialog meeting={meeting} onClose={() => setDialog(null)} /> : null}
      {dialog === 'cancel' ? <CancelMeetingDialog meeting={meeting} onClose={() => setDialog(null)} onDone={(scope) => setNotice({ text: scope === 'series' ? 'The upcoming meetings of the series are cancelled.' : 'Meeting cancelled.' })} /> : null}
      {dialog === 'delete' ? <DeleteMeetingDialog meeting={meeting} onClose={() => setDialog(null)} onDone={() => navigate('/meetings')} /> : null}
    </div>
  );
}
