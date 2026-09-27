import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams, Link, useSearchParams } from 'react-router-dom';
import {
  meetingsApi,
  MEETING_STATUS_LABELS,
  ATTENDANCE_LABELS,
  NOTE_TYPE_LABELS,
  ACTION_STATUS_LABELS,
  type Attendee,
  type AttendanceStatus,
  type AttendeeRole,
  type AgendaItem,
  type MeetingNote,
  type MeetingNoteType,
  type ActionItemStatus,
  type Priority,
} from '../api/meetings';
import { projectsApi } from '../api/projects';
import { usersApi, type DirectoryUser } from '../api/users';
import { apiClient } from '../api/client';
import { ApiError } from '../lib/api-client';
import { useAuthStore } from '../stores/auth-store';
import { MeetingFormModal } from '../components/MeetingFormModal';
import { CreateTaskFromNoteModal } from '../components/CreateTaskFromNoteModal';
import { PageHeader } from '../components/ui/PageHeader';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Avatar } from '../components/ui/Avatar';
import { FieldLabel, fieldClass } from '../components/ui/Field';
import { SearchableSelect } from '../components/ui/SearchableSelect';
import {
  meetingStatusTone,
  attendanceTone,
  noteTypeTone,
  actionStatusTone,
  formatMeetingRange,
  formatClockTime,
  formatDueDate,
  isActionItemOverdue,
  safeMeetingHref,
} from '../lib/meetingFormat';
import { useCompanyTimeZone } from '../lib/useCompanyTimeZone';
import { useMeetingRealtime, type MeetingChangeKind } from '../lib/useMeetingRealtime';
import { downloadBlob } from '../lib/download';

const ATTENDANCE_OPTIONS = (['INVITED', 'PRESENT', 'LATE', 'ABSENT', 'EXCUSED'] as AttendanceStatus[]).map((s) => ({ value: s, label: ATTENDANCE_LABELS[s] }));
/** While a meeting is running, poll its live parts so standalone meetings (no socket room) stay current too. */
const LIVE_POLL_MS = 10_000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Our sentence, plus the server's reason for a rejected request (and a plain word for 403). */
function failure(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    if (err.status === 403) return `${fallback} You don’t have permission to do that.`;
    if (err.status >= 400 && err.status < 500 && err.message && !/^Request failed/.test(err.message)) return `${fallback} ${err.message}`;
  }
  if (err instanceof TypeError) return `${fallback} Check your connection and try again.`;
  return fallback;
}

export function MeetingDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const timeZone = useCompanyTimeZone();
  const [showEdit, setShowEdit] = useState(false);
  const [actionMsg, setActionMsg] = useState<{ text: string; error?: boolean } | null>(null);

  const meetingQ = useQuery({
    queryKey: ['meeting', id],
    queryFn: () => meetingsApi(apiClient).get(id),
    enabled: !!id,
    // Poll while the meeting is running so status/details changed by others show up.
    refetchInterval: (q) => (q.state.data?.status === 'IN_PROGRESS' ? LIVE_POLL_MS : false),
  });
  const meeting = meetingQ.data;
  const live = meeting?.status === 'IN_PROGRESS';
  const pollMs = live ? LIVE_POLL_MS : false;
  const attendeesQ = useQuery({ queryKey: ['meeting', id, 'attendees'], queryFn: () => meetingsApi(apiClient).listAttendees(id), enabled: !!id, refetchInterval: pollMs });
  const projectsQ = useQuery({ queryKey: ['projects'], queryFn: () => projectsApi(apiClient).list() });
  const dirQ = useQuery({ queryKey: ['directory'], queryFn: () => usersApi(apiClient).directory() });

  // Live updates from other people in the meeting (notes, agenda, attendees, action items).
  useMeetingRealtime(id, meeting?.projectId ?? null, (kind: MeetingChangeKind) => {
    if (kind === 'reconnect') {
      void qc.invalidateQueries({ queryKey: ['meeting', id] });
      return;
    }
    if (kind === 'meeting') {
      void qc.invalidateQueries({ queryKey: ['meeting', id], exact: true });
      void qc.invalidateQueries({ queryKey: ['meetings'] });
      return;
    }
    void qc.invalidateQueries({ queryKey: ['meeting', id, kind] });
    if (kind === 'action-items') void qc.invalidateQueries({ queryKey: ['my-action-items'] });
  });

  const projectName = meeting?.projectId
    ? (Array.isArray(projectsQ.data) ? projectsQ.data : []).find((p) => p.id === meeting.projectId)?.name ?? null
    : null;

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['meeting', id] });
    qc.invalidateQueries({ queryKey: ['meetings'] });
  };

  const cancelMut = useMutation({
    mutationFn: () => meetingsApi(apiClient).cancel(id),
    onSuccess: invalidate,
    onError: (err) => setActionMsg({ text: failure(err, 'Couldn’t cancel the meeting.'), error: true }),
  });
  const duplicateMut = useMutation({
    mutationFn: () => meetingsApi(apiClient).duplicate(id),
    onSuccess: (m) => { qc.invalidateQueries({ queryKey: ['meetings'] }); navigate(`/meetings/${m.id}`); },
    onError: (err) => setActionMsg({ text: failure(err, 'Couldn’t duplicate the meeting.'), error: true }),
  });
  const deleteMut = useMutation({
    mutationFn: () => meetingsApi(apiClient).remove(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['meetings'] }); navigate('/meetings'); },
    onError: (err) => setActionMsg({ text: failure(err, 'Couldn’t delete the meeting.'), error: true }),
  });
  const exportMut = useMutation({
    mutationFn: () => meetingsApi(apiClient).exportMinutesPdf(id),
    onSuccess: (blob) => {
      const slug = (meeting?.title ?? 'meeting').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'meeting';
      downloadBlob(`minutes-${slug}.pdf`, blob);
    },
    onError: (err) => setActionMsg({ text: failure(err, 'Couldn’t export the minutes.'), error: true }),
  });
  const invitesMut = useMutation({
    mutationFn: () => meetingsApi(apiClient).sendInvites(id),
    onSuccess: (r) => { setActionMsg({ text: `Calendar invitations sent to ${r.sent} ${r.sent === 1 ? 'person' : 'people'}.` }); invalidate(); },
    onError: (err) => setActionMsg({ text: failure(err, 'Couldn’t send invitations — email may not be configured.'), error: true }),
  });
  const emailMinutesMut = useMutation({
    mutationFn: () => meetingsApi(apiClient).sendMinutes(id),
    onSuccess: (r) => setActionMsg({ text: `Minutes emailed to ${r.sent} ${r.sent === 1 ? 'person' : 'people'}.` }),
    onError: (err) => setActionMsg({ text: failure(err, 'Couldn’t email the minutes — email may not be configured.'), error: true }),
  });

  if (meetingQ.isLoading) {
    return (
      <div>
        <div className="skeleton h-4 w-24" />
        <div className="skeleton mt-4 h-8 w-80" />
        <div className="skeleton mt-6 h-40 w-full" />
      </div>
    );
  }
  if (meetingQ.isError || !meeting) {
    return (
      <div>
        <Link to="/meetings" className="text-sm text-ink-2 hover:text-ink">← Back to meetings</Link>
        <p role="alert" className="mt-4 text-danger">This meeting couldn’t be found, or you don’t have access to it.</p>
      </div>
    );
  }

  const terminal = meeting.status === 'CANCELLED' || meeting.status === 'COMPLETED';
  // Only organizers/managers may manage the meeting; older servers don't send the flag (→ allowed).
  const canEdit = meeting.canEdit !== false;
  const joinHref = safeMeetingHref(meeting.onlineLink);
  const directory = Array.isArray(dirQ.data) ? dirQ.data : [];

  return (
    <div>
      <Link to="/meetings" className="text-sm text-ink-2 hover:text-ink">← Back to meetings</Link>

      <PageHeader
        eyebrow={projectName ? <span dir="auto">Project · {projectName}</span> : 'Standalone meeting'}
        title={<span dir="auto">{meeting.title}</span>}
        actions={
          <div className="flex flex-wrap gap-2">
            {canEdit && !terminal ? (
              <Button variant="primary" size="sm" loading={invitesMut.isPending} onClick={() => invitesMut.mutate()}>
                {meeting.invitesSentAt ? 'Re-send invites' : 'Send invites'}
              </Button>
            ) : null}
            <Button variant="secondary" size="sm" loading={exportMut.isPending} onClick={() => exportMut.mutate()}>Export minutes (PDF)</Button>
            {canEdit ? (
              <Button variant="secondary" size="sm" loading={emailMinutesMut.isPending} onClick={() => emailMinutesMut.mutate()}>Email minutes</Button>
            ) : null}
            {canEdit ? <Button variant="secondary" size="sm" onClick={() => setShowEdit(true)}>Edit</Button> : null}
            <Button variant="secondary" size="sm" loading={duplicateMut.isPending} onClick={() => duplicateMut.mutate()}>Duplicate</Button>
            {canEdit && !terminal ? (
              <Button
                variant="secondary"
                size="sm"
                loading={cancelMut.isPending}
                onClick={() => { if (window.confirm('Cancel this meeting? Invited people will be notified.')) cancelMut.mutate(); }}
              >
                Cancel meeting
              </Button>
            ) : null}
            {canEdit ? (
              <Button
                variant="danger"
                size="sm"
                loading={deleteMut.isPending}
                onClick={() => { if (window.confirm('Delete this meeting? This cannot be undone.')) deleteMut.mutate(); }}
              >
                Delete
              </Button>
            ) : null}
          </div>
        }
      />

      {actionMsg ? (
        <div
          role={actionMsg.error ? 'alert' : 'status'}
          className={`mb-4 flex items-center justify-between gap-3 rounded-lg px-3 py-2 text-sm ${actionMsg.error ? 'bg-danger-soft text-danger' : 'bg-success-soft text-success'}`}
        >
          <span>{actionMsg.text}</span>
          <button onClick={() => setActionMsg(null)} aria-label="Dismiss" className="shrink-0 rounded px-1 opacity-80 hover:opacity-100">✕</button>
        </div>
      ) : null}

      <div className="mb-6 flex flex-wrap items-center gap-2">
        <Badge tone={meetingStatusTone(meeting.status)}>{MEETING_STATUS_LABELS[meeting.status]}</Badge>
        {meeting.invitesSentAt ? <Badge tone="info">✉ Invites sent</Badge> : null}
        {live ? <Badge tone="brand">● Live — updates automatically</Badge> : null}
        <span className="text-sm text-ink-2" title={`Company time (${timeZone})`}>{formatMeetingRange(meeting.startAt, meeting.endAt, timeZone)}</span>
        {meeting.location ? <span dir="auto" className="text-sm text-ink-3">· 📍 {meeting.location}</span> : null}
        {joinHref ? (
          <a href={joinHref} target="_blank" rel="noopener noreferrer" className="text-sm text-brand hover:underline">· 🔗 Join online</a>
        ) : null}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 flex flex-col gap-6">
          {meeting.description ? (
            <section className="card p-5">
              <h2 className="mb-2 font-display text-sm font-semibold uppercase tracking-wide text-ink-3">Description</h2>
              <p dir="auto" className="whitespace-pre-wrap text-start text-sm text-ink">{meeting.description}</p>
            </section>
          ) : null}

          <AgendaCard meetingId={id} directory={directory} canEdit={canEdit} pollMs={pollMs} />

          <LiveNotesCard meetingId={id} directory={directory} meetingProjectId={meeting.projectId} canEdit={canEdit} pollMs={pollMs} timeZone={timeZone} />

          <ActionItemsCard meetingId={id} directory={directory} canEdit={canEdit} pollMs={pollMs} timeZone={timeZone} />
        </div>

        <div className="lg:col-span-1">
          <AttendeesCard
            meetingId={id}
            attendees={Array.isArray(attendeesQ.data) ? attendeesQ.data : []}
            directory={directory}
            loading={attendeesQ.isLoading}
            loadError={attendeesQ.isError}
            onRetry={() => void attendeesQ.refetch()}
            canEdit={canEdit}
          />
        </div>
      </div>

      {showEdit ? <MeetingFormModal meeting={meeting} onClose={() => setShowEdit(false)} /> : null}
    </div>
  );
}

/**
 * A ✕ that asks before deleting: the first click turns it into "Delete? [Delete] [Keep]" (focus
 * lands on Keep), so a stray click next to Edit can't remove a note, agenda item or attendee.
 */
function ConfirmRemoveButton({ label, onConfirm, disabled }: { label: string; onConfirm: () => void; disabled?: boolean }) {
  const [asking, setAsking] = useState(false);
  const keepRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (asking) keepRef.current?.focus();
  }, [asking]);
  if (!asking) {
    return (
      <button
        type="button"
        onClick={() => setAsking(true)}
        disabled={disabled}
        aria-label={label}
        title={label}
        className="ml-1 rounded-md px-1.5 py-1 text-xs text-ink-3 transition-colors hover:bg-danger-soft hover:text-danger disabled:opacity-40"
      >
        ✕
      </button>
    );
  }
  return (
    <span
      role="group"
      aria-label={`Confirm: ${label}`}
      className="ml-1 inline-flex items-center gap-1 rounded-md bg-danger-soft px-1.5 py-0.5"
      onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setAsking(false); } }}
    >
      <span className="text-xs font-medium text-danger">Delete?</span>
      <button type="button" onClick={() => { setAsking(false); onConfirm(); }} className="rounded bg-danger px-1.5 py-0.5 text-xs font-semibold text-white hover:brightness-95">
        Delete
      </button>
      <button type="button" ref={keepRef} onClick={() => setAsking(false)} className="rounded px-1.5 py-0.5 text-xs font-medium text-ink-2 hover:bg-surface">
        Keep
      </button>
    </span>
  );
}

function CardLoadError({ what, onRetry }: { what: string; onRetry: () => void }) {
  return (
    <p role="alert" className="text-sm text-danger">
      Couldn’t load {what}.{' '}
      <button type="button" onClick={onRetry} className="font-semibold underline">Retry</button>
    </p>
  );
}

function CardError({ message, onDismiss }: { message: string | null; onDismiss: () => void }) {
  if (!message) return null;
  return (
    <div role="alert" className="mb-3 flex items-start justify-between gap-2 rounded-lg bg-danger-soft px-3 py-2 text-xs font-medium text-danger">
      <span>{message}</span>
      <button type="button" onClick={onDismiss} aria-label="Dismiss" className="shrink-0 opacity-80 hover:opacity-100">✕</button>
    </div>
  );
}

function ownerName(dir: DirectoryUser[], ownerId: string | null): string | null {
  if (!ownerId) return null;
  const u = dir.find((d) => d.id === ownerId);
  return u ? `${u.firstName} ${u.lastName}`.trim() || u.username : 'Unknown';
}

interface CardProps {
  meetingId: string;
  directory: DirectoryUser[];
  canEdit: boolean;
  pollMs: number | false;
}

function AgendaCard({ meetingId, directory, canEdit, pollMs }: CardProps) {
  const qc = useQueryClient();
  const [title, setTitle] = useState('');
  const [minutes, setMinutes] = useState('');
  const [ownerId, setOwnerId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [opError, setOpError] = useState<string | null>(null);

  const agendaQ = useQuery({ queryKey: ['meeting', meetingId, 'agenda'], queryFn: () => meetingsApi(apiClient).listAgenda(meetingId), enabled: !!meetingId, refetchInterval: pollMs });
  const items = Array.isArray(agendaQ.data) ? agendaQ.data : [];
  const refresh = () => qc.invalidateQueries({ queryKey: ['meeting', meetingId, 'agenda'] });
  const totalMinutes = items.reduce((sum, i) => sum + (i.expectedMinutes ?? 0), 0);

  const addMut = useMutation({
    mutationFn: () => meetingsApi(apiClient).addAgendaItem(meetingId, {
      title: title.trim(),
      expectedMinutes: minutes ? Number(minutes) : null,
      ownerId: ownerId || null,
    }),
    onSuccess: () => { setTitle(''); setMinutes(''); setOwnerId(''); setError(null); refresh(); },
    onError: (err) => setError(failure(err, 'Couldn’t add the agenda item.')),
  });
  const toggleMut = useMutation({
    mutationFn: ({ item, completed }: { item: AgendaItem; completed: boolean }) => meetingsApi(apiClient).updateAgendaItem(meetingId, item.id, { completed }),
    onSuccess: refresh,
    onError: (err) => setOpError(failure(err, 'Couldn’t update the agenda item.')),
  });
  const removeMut = useMutation({
    mutationFn: (itemId: string) => meetingsApi(apiClient).removeAgendaItem(meetingId, itemId),
    onSuccess: refresh,
    onError: (err) => setOpError(failure(err, 'Couldn’t delete the agenda item.')),
  });
  const reorderMut = useMutation({
    mutationFn: (orderedIds: string[]) => meetingsApi(apiClient).reorderAgenda(meetingId, orderedIds),
    onSuccess: refresh,
    onError: (err) => setOpError(failure(err, 'Couldn’t reorder the agenda.')),
  });

  function move(index: number, dir: -1 | 1) {
    const next = index + dir;
    if (next < 0 || next >= items.length) return;
    const ids = items.map((i) => i.id);
    const moved = ids.splice(index, 1)[0]!;
    ids.splice(next, 0, moved);
    reorderMut.mutate(ids);
  }

  function submitAdd(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!title.trim()) { setError('Enter an agenda item.'); return; }
    addMut.mutate();
  }

  const ownerOptions = [
    { value: '', label: 'No presenter' },
    ...directory.map((u) => ({ value: u.id, label: `${u.firstName} ${u.lastName}`.trim() || u.username, hint: `@${u.username}` })),
  ];

  return (
    <section className="card p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-display text-sm font-semibold uppercase tracking-wide text-ink-3">Agenda</h2>
        {totalMinutes > 0 ? <span className="text-xs text-ink-3">~{totalMinutes} min planned</span> : null}
      </div>

      <CardError message={opError} onDismiss={() => setOpError(null)} />

      {agendaQ.isLoading ? (
        <div className="skeleton h-16 w-full" />
      ) : agendaQ.isError ? (
        <CardLoadError what="the agenda" onRetry={() => void agendaQ.refetch()} />
      ) : items.length === 0 ? (
        <p className="text-sm text-ink-2">{canEdit ? 'No agenda items yet. Add the topics you plan to cover.' : 'No agenda items yet.'}</p>
      ) : (
        <ol className="flex flex-col divide-y divide-line">
          {items.map((item, index) => {
            const presenter = ownerName(directory, item.ownerId);
            return (
              <li key={item.id} className="flex items-center gap-3 py-2.5">
                <input
                  type="checkbox"
                  checked={item.completed}
                  disabled={!canEdit}
                  onChange={(e) => toggleMut.mutate({ item, completed: e.target.checked })}
                  aria-label={`Mark "${item.title}" done`}
                  className="h-4 w-4 shrink-0 accent-[color:rgb(var(--c-brand))]"
                />
                <div className="min-w-0 flex-1">
                  <span dir="auto" className={`block truncate text-start text-sm font-medium ${item.completed ? 'text-ink-3 line-through' : 'text-ink'}`}>{item.title}</span>
                  {(presenter || item.expectedMinutes) ? (
                    <div className="mt-0.5 flex items-center gap-2 text-xs text-ink-3">
                      {presenter ? <span dir="auto" className="truncate">{presenter}</span> : null}
                      {item.expectedMinutes ? <Badge tone="neutral">{item.expectedMinutes} min</Badge> : null}
                    </div>
                  ) : null}
                </div>
                {canEdit ? (
                  <div className="flex shrink-0 items-center">
                    <button onClick={() => move(index, -1)} disabled={index === 0} aria-label="Move up" className="rounded-md px-1 py-0.5 text-ink-3 transition-colors hover:bg-ground hover:text-ink disabled:opacity-30">↑</button>
                    <button onClick={() => move(index, 1)} disabled={index === items.length - 1} aria-label="Move down" className="rounded-md px-1 py-0.5 text-ink-3 transition-colors hover:bg-ground hover:text-ink disabled:opacity-30">↓</button>
                    <ConfirmRemoveButton label={`Remove "${item.title}"`} onConfirm={() => removeMut.mutate(item.id)} disabled={removeMut.isPending} />
                  </div>
                ) : null}
              </li>
            );
          })}
        </ol>
      )}

      {canEdit ? (
        <form onSubmit={submitAdd} className="mt-4 flex flex-col gap-2 border-t border-line pt-4">
          {error ? <p role="alert" className="text-xs font-medium text-danger">{error}</p> : null}
          <div className="flex gap-2">
            <input aria-label="Agenda item" dir="auto" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Add an agenda item…" className={`${fieldClass(false)} flex-1`} />
            <input aria-label="Expected minutes" type="number" min={0} value={minutes} onChange={(e) => setMinutes(e.target.value)} placeholder="min" className={`${fieldClass(false)} w-20`} />
          </div>
          <div className="flex items-center gap-2">
            <SearchableSelect ariaLabel="Presenter" className="flex-1" placeholder="No presenter" options={ownerOptions} value={ownerId} onChange={setOwnerId} />
            <Button type="submit" size="sm" loading={addMut.isPending}>Add</Button>
          </div>
        </form>
      ) : null}
    </section>
  );
}

const NOTE_TYPES: MeetingNoteType[] = ['DISCUSSION', 'DECISION', 'ACTION', 'ISSUE', 'QUESTION', 'INFORMATION'];

function authorLabel(dir: DirectoryUser[], authorId: string): string {
  const u = dir.find((d) => d.id === authorId);
  return u ? `${u.firstName} ${u.lastName}`.trim() || u.username : 'Someone';
}

function LiveNotesCard({ meetingId, directory, meetingProjectId, canEdit, pollMs, timeZone }: CardProps & { meetingProjectId: string | null; timeZone: string }) {
  const qc = useQueryClient();
  const myId = useAuthStore((s) => s.user?.id);
  const [, setSearchParams] = useSearchParams();
  const [type, setType] = useState<MeetingNoteType>('DISCUSSION');
  const [body, setBody] = useState('');
  const [highlight, setHighlight] = useState(false);
  const [filter, setFilter] = useState<MeetingNoteType | 'ALL'>('ALL');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editBody, setEditBody] = useState('');
  const [editType, setEditType] = useState<MeetingNoteType>('DISCUSSION');
  const [taskForNote, setTaskForNote] = useState<MeetingNote | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [opError, setOpError] = useState<string | null>(null);

  const openTask = (taskId: string) => setSearchParams((prev) => { const next = new URLSearchParams(prev); next.set('task', taskId); return next; });

  const notesQ = useQuery({ queryKey: ['meeting', meetingId, 'notes'], queryFn: () => meetingsApi(apiClient).listNotes(meetingId), enabled: !!meetingId, refetchInterval: pollMs });
  const notes = Array.isArray(notesQ.data) ? notesQ.data : [];
  const filtered = filter === 'ALL' ? notes : notes.filter((n) => n.type === filter);
  const refresh = () => qc.invalidateQueries({ queryKey: ['meeting', meetingId, 'notes'] });
  // Authors manage their own notes; meeting managers can tidy up any note.
  const canManage = (note: MeetingNote) => canEdit || note.authorId === myId;

  const addMut = useMutation({
    mutationFn: () => meetingsApi(apiClient).addNote(meetingId, { body: body.trim(), type, highlighted: highlight }),
    onSuccess: () => { setBody(''); setHighlight(false); setError(null); refresh(); },
    onError: (err) => setError(failure(err, 'Couldn’t save the note.')),
  });
  const saveEditMut = useMutation({
    mutationFn: (noteId: string) => meetingsApi(apiClient).updateNote(meetingId, noteId, { body: editBody.trim(), type: editType }),
    onSuccess: () => { setEditingId(null); refresh(); },
    onError: (err) => setOpError(failure(err, 'Couldn’t save your changes to the note — they’re still open so you can try again.')),
  });
  const toggleHighlightMut = useMutation({
    mutationFn: ({ note }: { note: MeetingNote }) => meetingsApi(apiClient).updateNote(meetingId, note.id, { highlighted: !note.highlighted }),
    onSuccess: refresh,
    onError: (err) => setOpError(failure(err, 'Couldn’t change the highlight.')),
  });
  const removeMut = useMutation({
    mutationFn: (noteId: string) => meetingsApi(apiClient).removeNote(meetingId, noteId),
    onSuccess: refresh,
    onError: (err) => setOpError(failure(err, 'Couldn’t delete the note.')),
  });

  function submitAdd(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!body.trim()) { setError('Write a note first.'); return; }
    addMut.mutate();
  }
  function onComposerKey(e: ReactKeyboardEvent<HTMLTextAreaElement>) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); submitAdd(e as unknown as FormEvent); }
  }
  function startEdit(note: MeetingNote) {
    setEditingId(note.id);
    setEditBody(note.body);
    setEditType(note.type);
  }

  return (
    <section className="card p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-display text-sm font-semibold uppercase tracking-wide text-ink-3">Live Notes</h2>
        <span className="text-xs text-ink-3">{notes.length}</span>
      </div>

      {/* Composer — pick a note type, type the note, ⌘/Ctrl+Enter to capture. */}
      <form onSubmit={submitAdd} className="mb-4 flex flex-col gap-2 rounded-xl border border-line bg-ground/50 p-3">
        <div className="flex flex-wrap gap-1.5">
          {NOTE_TYPES.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setType(t)}
              aria-pressed={type === t}
              className={`rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${type === t ? 'bg-brand-gradient text-white shadow-sm' : 'border border-line text-ink-2 hover:bg-surface'}`}
            >
              {NOTE_TYPE_LABELS[t]}
            </button>
          ))}
        </div>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={onComposerKey}
          rows={2}
          dir="auto"
          placeholder={`Capture a ${NOTE_TYPE_LABELS[type].toLowerCase()}…`}
          aria-label="New note"
          className={fieldClass(false)}
        />
        {error ? <p role="alert" className="text-xs font-medium text-danger">{error}</p> : null}
        <div className="flex items-center justify-between">
          <label className="flex items-center gap-1.5 text-xs text-ink-2">
            <input type="checkbox" checked={highlight} onChange={(e) => setHighlight(e.target.checked)} className="h-3.5 w-3.5 accent-[color:rgb(var(--c-brand))]" />
            Highlight
          </label>
          <Button type="submit" size="sm" loading={addMut.isPending}>Add note</Button>
        </div>
      </form>

      <CardError message={opError} onDismiss={() => setOpError(null)} />

      {/* Type filter */}
      {notes.length > 0 ? (
        <div className="mb-3 flex flex-wrap gap-1.5">
          {(['ALL', ...NOTE_TYPES] as (MeetingNoteType | 'ALL')[]).map((t) => (
            <button
              key={t}
              onClick={() => setFilter(t)}
              aria-pressed={filter === t}
              className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-colors ${filter === t ? 'bg-ink text-surface' : 'text-ink-3 hover:text-ink'}`}
            >
              {t === 'ALL' ? 'All' : NOTE_TYPE_LABELS[t]}
            </button>
          ))}
        </div>
      ) : null}

      {notesQ.isLoading ? (
        <div className="skeleton h-20 w-full" />
      ) : notesQ.isError ? (
        <CardLoadError what="the notes" onRetry={() => void notesQ.refetch()} />
      ) : filtered.length === 0 ? (
        <p className="text-sm text-ink-2">{notes.length === 0 ? 'No notes captured yet. Start typing above as the meeting unfolds.' : 'No notes of this type.'}</p>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {filtered.map((note) => (
            <li
              key={note.id}
              className={`rounded-xl border p-3 ${note.highlighted ? 'border-warning/40 bg-warning-soft/40' : 'border-line bg-surface'}`}
            >
              <div className="mb-1 flex items-center gap-2">
                <Badge tone={noteTypeTone(note.type)}>{NOTE_TYPE_LABELS[note.type]}</Badge>
                <span dir="auto" className="text-xs font-medium text-ink-2">{authorLabel(directory, note.authorId)}</span>
                <span className="text-xs text-ink-3">· {formatClockTime(note.createdAt, timeZone)}{note.editedAt ? ' · edited' : ''}</span>
                {note.taskId ? (
                  <button onClick={() => openTask(note.taskId!)} className="rounded-full" aria-label="Open the task created from this note">
                    <Badge tone="success">✓ Task created</Badge>
                  </button>
                ) : null}
                <div className="ml-auto flex items-center gap-0.5">
                  {!note.taskId ? (
                    <button onClick={() => setTaskForNote(note)} aria-label="Create task from note" title="Create task from note" className="rounded-md px-1 py-0.5 text-xs text-ink-3 transition-colors hover:bg-ground hover:text-brand">⭐</button>
                  ) : null}
                  {canManage(note) ? (
                    <>
                      <button onClick={() => toggleHighlightMut.mutate({ note })} aria-label={note.highlighted ? 'Remove highlight' : 'Highlight'} className={`rounded-md px-1 py-0.5 text-xs transition-colors hover:bg-ground ${note.highlighted ? 'text-warning' : 'text-ink-3'}`}>★</button>
                      <button onClick={() => startEdit(note)} aria-label="Edit note" className="rounded-md px-1 py-0.5 text-xs text-ink-3 transition-colors hover:bg-ground hover:text-ink">✎</button>
                      <ConfirmRemoveButton label="Delete note" onConfirm={() => removeMut.mutate(note.id)} disabled={removeMut.isPending} />
                    </>
                  ) : null}
                </div>
              </div>
              {editingId === note.id ? (
                <div className="flex flex-col gap-2">
                  <div className="flex flex-wrap gap-1.5">
                    {NOTE_TYPES.map((t) => (
                      <button key={t} type="button" onClick={() => setEditType(t)} aria-pressed={editType === t} className={`rounded-full px-2 py-0.5 text-[11px] font-medium transition-colors ${editType === t ? 'bg-brand-gradient text-white' : 'border border-line text-ink-2 hover:bg-ground'}`}>
                        {NOTE_TYPE_LABELS[t]}
                      </button>
                    ))}
                  </div>
                  <textarea value={editBody} dir="auto" onChange={(e) => setEditBody(e.target.value)} rows={2} aria-label="Edit note" className={fieldClass(false)} />
                  <div className="flex gap-2">
                    <Button size="sm" loading={saveEditMut.isPending} disabled={!editBody.trim()} onClick={() => saveEditMut.mutate(note.id)}>Save</Button>
                    <button type="button" onClick={() => setEditingId(null)} className="rounded-lg px-3 py-1 text-sm font-medium text-ink-2 hover:bg-ground">Cancel</button>
                  </div>
                </div>
              ) : (
                <p dir="auto" className="whitespace-pre-wrap text-start text-sm text-ink">{note.body}</p>
              )}
            </li>
          ))}
        </ul>
      )}

      {taskForNote ? (
        <CreateTaskFromNoteModal
          meetingId={meetingId}
          note={taskForNote}
          defaultProjectId={meetingProjectId}
          onClose={() => setTaskForNote(null)}
          onCreated={refresh}
          onOpenTask={openTask}
        />
      ) : null}
    </section>
  );
}

const ACTION_STATUSES: ActionItemStatus[] = ['OPEN', 'IN_PROGRESS', 'PENDING', 'COMPLETED', 'CANCELLED'];
const PRIORITIES: Priority[] = ['LOW', 'NORMAL', 'HIGH', 'URGENT'];

function ActionItemsCard({ meetingId, directory, canEdit, pollMs, timeZone }: CardProps & { timeZone: string }) {
  const qc = useQueryClient();
  const myId = useAuthStore((s) => s.user?.id);
  const [description, setDescription] = useState('');
  const [assigneeId, setAssigneeId] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [priority, setPriority] = useState<Priority>('NORMAL');
  const [error, setError] = useState<string | null>(null);
  const [opError, setOpError] = useState<string | null>(null);

  const itemsQ = useQuery({ queryKey: ['meeting', meetingId, 'action-items'], queryFn: () => meetingsApi(apiClient).listActionItems(meetingId), enabled: !!meetingId, refetchInterval: pollMs });
  const items = Array.isArray(itemsQ.data) ? itemsQ.data : [];
  const refresh = () => { qc.invalidateQueries({ queryKey: ['meeting', meetingId, 'action-items'] }); qc.invalidateQueries({ queryKey: ['my-action-items'] }); };
  const openCount = items.filter((i) => i.status !== 'COMPLETED' && i.status !== 'CANCELLED').length;

  const addMut = useMutation({
    // A due date is a calendar day: send the picked day itself (stored as that day, UTC midnight).
    mutationFn: () => meetingsApi(apiClient).addActionItem(meetingId, { description: description.trim(), assigneeId: assigneeId || null, dueDate: dueDate ? `${dueDate}T00:00:00.000Z` : null, priority }),
    onSuccess: () => { setDescription(''); setAssigneeId(''); setDueDate(''); setPriority('NORMAL'); setError(null); refresh(); },
    onError: (err) => setError(failure(err, 'Couldn’t add the action item.')),
  });
  const statusMut = useMutation({
    mutationFn: ({ id, status }: { id: string; status: ActionItemStatus }) => meetingsApi(apiClient).updateActionItem(id, { status }),
    onSuccess: refresh,
    onError: (err) => setOpError(failure(err, 'Couldn’t change the status.')),
  });
  const assignMut = useMutation({
    mutationFn: ({ id, assigneeId: a }: { id: string; assigneeId: string | null }) => meetingsApi(apiClient).updateActionItem(id, { assigneeId: a }),
    onSuccess: refresh,
    onError: (err) => setOpError(failure(err, 'Couldn’t change the assignee.')),
  });
  const removeMut = useMutation({
    mutationFn: (id: string) => meetingsApi(apiClient).removeActionItem(id),
    onSuccess: refresh,
    onError: (err) => setOpError(failure(err, 'Couldn’t delete the action item.')),
  });

  const nameFor = (uid: string | null) => (uid ? authorLabel(directory, uid) : 'Unassigned');
  const assigneeOptions = [{ value: '', label: 'Unassigned' }, ...directory.map((u) => ({ value: u.id, label: `${u.firstName} ${u.lastName}`.trim() || u.username, hint: `@${u.username}` }))];

  function submitAdd(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!description.trim()) { setError('Describe the action item.'); return; }
    addMut.mutate();
  }

  return (
    <section className="card p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-display text-sm font-semibold uppercase tracking-wide text-ink-3">Action Items</h2>
        {openCount > 0 ? <span className="text-xs text-ink-3">{openCount} open</span> : null}
      </div>

      <CardError message={opError} onDismiss={() => setOpError(null)} />

      {itemsQ.isLoading ? (
        <div className="skeleton h-16 w-full" />
      ) : itemsQ.isError ? (
        <CardLoadError what="the action items" onRetry={() => void itemsQ.refetch()} />
      ) : items.length === 0 ? (
        <p className="text-sm text-ink-2">No action items yet. Capture what needs doing and who owns it.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-line">
          {items.map((item) => {
            const overdue = isActionItemOverdue(item, timeZone);
            return (
              <li key={item.id} className="py-2.5">
                <div className="flex items-start gap-2.5">
                  <div className="min-w-0 flex-1">
                    <p dir="auto" className={`text-start text-sm ${item.status === 'COMPLETED' || item.status === 'CANCELLED' ? 'text-ink-3 line-through' : 'text-ink'}`}>{item.description}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
                      <Badge tone={actionStatusTone(item.status)}>{ACTION_STATUS_LABELS[item.status]}</Badge>
                      <span dir="auto" className="text-ink-3">{nameFor(item.assigneeId)}</span>
                      {item.dueDate ? <span className={overdue ? 'font-medium text-danger' : 'text-ink-3'}>· due {formatDueDate(item.dueDate, timeZone)}{overdue ? ' (overdue)' : ''}</span> : null}
                      {item.priority !== 'NORMAL' ? <Badge tone={item.priority === 'URGENT' || item.priority === 'HIGH' ? 'warning' : 'neutral'}>{item.priority[0] + item.priority.slice(1).toLowerCase()}</Badge> : null}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <select
                      aria-label={`Status for ${item.description}`}
                      value={item.status}
                      onChange={(e) => statusMut.mutate({ id: item.id, status: e.target.value as ActionItemStatus })}
                      className={`${fieldClass(false)} !py-1 text-xs`}
                    >
                      {ACTION_STATUSES.map((s) => <option key={s} value={s}>{ACTION_STATUS_LABELS[s]}</option>)}
                    </select>
                    {canEdit || item.createdById === myId ? (
                      <ConfirmRemoveButton label={`Remove ${item.description}`} onConfirm={() => removeMut.mutate(item.id)} disabled={removeMut.isPending} />
                    ) : null}
                  </div>
                </div>
                <div className="mt-1.5 pl-0">
                  <SearchableSelect ariaLabel={`Assignee for ${item.description}`} className="max-w-[16rem]" placeholder="Unassigned" options={assigneeOptions} value={item.assigneeId ?? ''} onChange={(v) => assignMut.mutate({ id: item.id, assigneeId: v || null })} />
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <form onSubmit={submitAdd} className="mt-4 flex flex-col gap-2 border-t border-line pt-4">
        {error ? <p role="alert" className="text-xs font-medium text-danger">{error}</p> : null}
        <input aria-label="Action item" dir="auto" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What needs to be done?" className={fieldClass(false)} />
        <div className="grid grid-cols-2 gap-2">
          <SearchableSelect ariaLabel="Assignee" placeholder="Assign to…" options={assigneeOptions} value={assigneeId} onChange={setAssigneeId} />
          <input aria-label="Due date" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className={fieldClass(false)} />
        </div>
        <div className="flex items-center gap-2">
          <SearchableSelect ariaLabel="Priority" className="flex-1" options={PRIORITIES.map((p) => ({ value: p, label: p[0] + p.slice(1).toLowerCase() }))} value={priority} onChange={(v) => setPriority(v as Priority)} />
          <Button type="submit" size="sm" loading={addMut.isPending}>Add</Button>
        </div>
      </form>
    </section>
  );
}

function personName(dir: DirectoryUser[], a: Attendee): string {
  if (a.userId) {
    const u = dir.find((d) => d.id === a.userId);
    if (u) return `${u.firstName} ${u.lastName}`.trim() || u.username;
    return 'Unknown member';
  }
  return a.externalName ?? 'Guest';
}

function AttendeesCard({
  meetingId,
  attendees,
  directory,
  loading,
  loadError,
  onRetry,
  canEdit,
}: {
  meetingId: string;
  attendees: Attendee[];
  directory: DirectoryUser[];
  loading: boolean;
  loadError: boolean;
  onRetry: () => void;
  canEdit: boolean;
}) {
  const qc = useQueryClient();
  const [mode, setMode] = useState<'internal' | 'external'>('internal');
  const [pickUser, setPickUser] = useState('');
  const [role, setRole] = useState<AttendeeRole>('REQUIRED');
  const [extName, setExtName] = useState('');
  const [extEmail, setExtEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [opError, setOpError] = useState<string | null>(null);

  const refresh = () => qc.invalidateQueries({ queryKey: ['meeting', meetingId, 'attendees'] });

  const addMut = useMutation({
    mutationFn: () =>
      mode === 'internal'
        ? meetingsApi(apiClient).addAttendee(meetingId, { userId: pickUser, role })
        : meetingsApi(apiClient).addAttendee(meetingId, { externalName: extName.trim(), externalEmail: extEmail.trim() || null, role }),
    onSuccess: () => { setPickUser(''); setExtName(''); setExtEmail(''); setError(null); refresh(); },
    onError: (err) => {
      if (err instanceof ApiError && err.status === 409) setError(mode === 'internal' ? 'That person is already invited.' : 'That guest is already invited.');
      else if (err instanceof ApiError && err.status === 400 && mode === 'external') setError('Check the guest’s details — the email address doesn’t look valid.');
      else setError(failure(err, 'Couldn’t add the attendee.'));
    },
  });
  const attendanceMut = useMutation({
    mutationFn: ({ attendeeId, attendance }: { attendeeId: string; attendance: AttendanceStatus }) =>
      meetingsApi(apiClient).updateAttendee(meetingId, attendeeId, { attendance }),
    onSuccess: refresh,
    onError: (err) => setOpError(failure(err, 'Couldn’t update attendance.')),
  });
  const removeMut = useMutation({
    mutationFn: (attendeeId: string) => meetingsApi(apiClient).removeAttendee(meetingId, attendeeId),
    onSuccess: refresh,
    onError: (err) => setOpError(failure(err, 'Couldn’t remove the attendee.')),
  });

  const invitedIds = new Set(attendees.map((a) => a.userId).filter(Boolean));
  const userOptions = directory
    .filter((u) => !invitedIds.has(u.id))
    .map((u) => ({ value: u.id, label: `${u.firstName} ${u.lastName}`.trim() || u.username, hint: `@${u.username}` }));

  function submitAdd(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (mode === 'internal' && !pickUser) { setError('Choose a person to add.'); return; }
    if (mode === 'external' && !extName.trim()) { setError('Enter the guest’s name.'); return; }
    if (mode === 'external' && extEmail.trim() && !EMAIL_RE.test(extEmail.trim())) {
      setError('Enter a valid email address for the guest (for example name@company.com), or leave it blank.');
      return;
    }
    addMut.mutate();
  }

  return (
    <section className="card p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-display text-sm font-semibold uppercase tracking-wide text-ink-3">Attendees</h2>
        <span className="text-xs text-ink-3">{attendees.length}</span>
      </div>

      <CardError message={opError} onDismiss={() => setOpError(null)} />

      {loading ? (
        <div className="skeleton h-16 w-full" />
      ) : loadError ? (
        <CardLoadError what="the attendees" onRetry={onRetry} />
      ) : attendees.length === 0 ? (
        <p className="text-sm text-ink-2">No attendees yet.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-line">
          {attendees.map((a) => (
            <li key={a.id} className="py-2.5">
              <div className="flex items-center gap-2.5">
                <Avatar size="sm" name={personName(directory, a)} src={a.userId ? directory.find((d) => d.id === a.userId)?.avatarUrl : null} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span dir="auto" className="truncate text-sm font-medium text-ink">{personName(directory, a)}</span>
                    {a.role === 'OPTIONAL' ? <Badge tone="neutral">Optional</Badge> : null}
                    {!a.userId ? <Badge tone="info">Guest</Badge> : null}
                  </div>
                  {a.externalEmail ? <p className="truncate text-xs text-ink-3">{a.externalEmail}</p> : null}
                </div>
                {canEdit ? (
                  <ConfirmRemoveButton label={`Remove ${personName(directory, a)}`} onConfirm={() => removeMut.mutate(a.id)} disabled={removeMut.isPending} />
                ) : null}
              </div>
              <div className="mt-1.5 flex items-center gap-2 pl-[2.375rem]">
                <Badge tone={attendanceTone(a.attendance)}>{ATTENDANCE_LABELS[a.attendance]}</Badge>
                {canEdit ? (
                  <select
                    aria-label={`Attendance for ${personName(directory, a)}`}
                    value={a.attendance}
                    onChange={(e) => attendanceMut.mutate({ attendeeId: a.id, attendance: e.target.value as AttendanceStatus })}
                    className={`${fieldClass(false)} flex-1 !py-1 text-xs`}
                  >
                    {ATTENDANCE_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}

      {canEdit ? (
        <form onSubmit={submitAdd} className="mt-4 flex flex-col gap-2 border-t border-line pt-4" noValidate>
          <div className="inline-flex self-start rounded-lg border border-line bg-surface p-0.5 text-xs">
            {(['internal', 'external'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => { setMode(m); setError(null); }}
                aria-pressed={mode === m}
                className={`rounded-md px-2.5 py-1 font-medium transition-colors ${mode === m ? 'bg-brand-gradient text-white' : 'text-ink-2 hover:text-ink'}`}
              >
                {m === 'internal' ? 'Team member' : 'Guest'}
              </button>
            ))}
          </div>
          {error ? <p role="alert" className="text-xs font-medium text-danger">{error}</p> : null}
          {mode === 'internal' ? (
            <SearchableSelect ariaLabel="Add team member" placeholder="Choose a person…" options={userOptions} value={pickUser} onChange={setPickUser} emptyText="Everyone is already invited" />
          ) : (
            <div className="flex flex-col gap-2">
              <input aria-label="Guest name" dir="auto" value={extName} onChange={(e) => setExtName(e.target.value)} placeholder="Guest name" className={fieldClass(false)} />
              <input aria-label="Guest email" type="email" dir="ltr" value={extEmail} onChange={(e) => setExtEmail(e.target.value)} placeholder="Email (optional)" className={fieldClass(false)} />
            </div>
          )}
          <div className="flex items-center gap-2">
            <FieldLabel htmlFor="att-role" className="text-xs">Role</FieldLabel>
            <SearchableSelect
              id="att-role"
              ariaLabel="Attendee role"
              className="flex-1"
              options={[{ value: 'REQUIRED', label: 'Required' }, { value: 'OPTIONAL', label: 'Optional' }]}
              value={role}
              onChange={(v) => setRole(v as AttendeeRole)}
            />
          </div>
          <Button type="submit" size="sm" loading={addMut.isPending}>Add attendee</Button>
        </form>
      ) : null}
    </section>
  );
}
