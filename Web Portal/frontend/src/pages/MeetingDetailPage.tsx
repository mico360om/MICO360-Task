import { useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react';
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
import { MeetingFormModal } from '../components/MeetingFormModal';
import { CreateTaskFromNoteModal } from '../components/CreateTaskFromNoteModal';
import { PageHeader } from '../components/ui/PageHeader';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Avatar } from '../components/ui/Avatar';
import { FieldLabel, fieldClass } from '../components/ui/Field';
import { SearchableSelect } from '../components/ui/SearchableSelect';
import { meetingStatusTone, attendanceTone, noteTypeTone, actionStatusTone, formatMeetingRange, formatClockTime, formatDueDate } from '../lib/meetingFormat';
import { downloadBlob } from '../lib/download';

const ATTENDANCE_OPTIONS = (['INVITED', 'PRESENT', 'LATE', 'ABSENT', 'EXCUSED'] as AttendanceStatus[]).map((s) => ({ value: s, label: ATTENDANCE_LABELS[s] }));

export function MeetingDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [showEdit, setShowEdit] = useState(false);
  const [actionMsg, setActionMsg] = useState<string | null>(null);

  const meetingQ = useQuery({ queryKey: ['meeting', id], queryFn: () => meetingsApi(apiClient).get(id), enabled: !!id });
  const attendeesQ = useQuery({ queryKey: ['meeting', id, 'attendees'], queryFn: () => meetingsApi(apiClient).listAttendees(id), enabled: !!id });
  const projectsQ = useQuery({ queryKey: ['projects'], queryFn: () => projectsApi(apiClient).list() });
  const dirQ = useQuery({ queryKey: ['directory'], queryFn: () => usersApi(apiClient).directory() });

  const meeting = meetingQ.data;
  const projectName = meeting?.projectId
    ? (Array.isArray(projectsQ.data) ? projectsQ.data : []).find((p) => p.id === meeting.projectId)?.name ?? null
    : null;

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['meeting', id] });
    qc.invalidateQueries({ queryKey: ['meetings'] });
  };

  const cancelMut = useMutation({ mutationFn: () => meetingsApi(apiClient).cancel(id), onSuccess: invalidate });
  const duplicateMut = useMutation({ mutationFn: () => meetingsApi(apiClient).duplicate(id), onSuccess: (m) => { qc.invalidateQueries({ queryKey: ['meetings'] }); navigate(`/meetings/${m.id}`); } });
  const deleteMut = useMutation({ mutationFn: () => meetingsApi(apiClient).remove(id), onSuccess: () => { qc.invalidateQueries({ queryKey: ['meetings'] }); navigate('/meetings'); } });
  const exportMut = useMutation({
    mutationFn: () => meetingsApi(apiClient).exportMinutesPdf(id),
    onSuccess: (blob) => {
      const slug = (meeting?.title ?? 'meeting').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'meeting';
      downloadBlob(`minutes-${slug}.pdf`, blob);
    },
  });
  const invitesMut = useMutation({
    mutationFn: () => meetingsApi(apiClient).sendInvites(id),
    onSuccess: (r) => { setActionMsg(`Calendar invitations sent to ${r.sent} ${r.sent === 1 ? 'person' : 'people'}.`); invalidate(); },
    onError: () => setActionMsg('Couldn’t send invitations — email may not be configured.'),
  });
  const emailMinutesMut = useMutation({
    mutationFn: () => meetingsApi(apiClient).sendMinutes(id),
    onSuccess: (r) => setActionMsg(`Minutes emailed to ${r.sent} ${r.sent === 1 ? 'person' : 'people'}.`),
    onError: () => setActionMsg('Couldn’t email the minutes — email may not be configured.'),
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

  return (
    <div>
      <Link to="/meetings" className="text-sm text-ink-2 hover:text-ink">← Back to meetings</Link>

      <PageHeader
        eyebrow={projectName ? `Project · ${projectName}` : 'Standalone meeting'}
        title={meeting.title}
        actions={
          <div className="flex flex-wrap gap-2">
            {!terminal ? (
              <Button variant="primary" size="sm" loading={invitesMut.isPending} onClick={() => invitesMut.mutate()}>
                {meeting.invitesSentAt ? 'Re-send invites' : 'Send invites'}
              </Button>
            ) : null}
            <Button variant="secondary" size="sm" loading={exportMut.isPending} onClick={() => exportMut.mutate()}>Export minutes (PDF)</Button>
            <Button variant="secondary" size="sm" loading={emailMinutesMut.isPending} onClick={() => emailMinutesMut.mutate()}>Email minutes</Button>
            <Button variant="secondary" size="sm" onClick={() => setShowEdit(true)}>Edit</Button>
            <Button variant="secondary" size="sm" loading={duplicateMut.isPending} onClick={() => duplicateMut.mutate()}>Duplicate</Button>
            {!terminal ? (
              <Button variant="secondary" size="sm" loading={cancelMut.isPending} onClick={() => cancelMut.mutate()}>Cancel meeting</Button>
            ) : null}
            <Button
              variant="danger"
              size="sm"
              loading={deleteMut.isPending}
              onClick={() => { if (window.confirm('Delete this meeting? This cannot be undone.')) deleteMut.mutate(); }}
            >
              Delete
            </Button>
          </div>
        }
      />

      {actionMsg ? (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-lg bg-success-soft px-3 py-2 text-sm text-success">
          <span>{actionMsg}</span>
          <button onClick={() => setActionMsg(null)} aria-label="Dismiss" className="shrink-0 rounded px-1 text-success/80 hover:text-success">✕</button>
        </div>
      ) : null}

      <div className="mb-6 flex flex-wrap items-center gap-2">
        <Badge tone={meetingStatusTone(meeting.status)}>{MEETING_STATUS_LABELS[meeting.status]}</Badge>
        {meeting.invitesSentAt ? <Badge tone="info">✉ Invites sent</Badge> : null}
        <span className="text-sm text-ink-2">{formatMeetingRange(meeting.startAt, meeting.endAt)}</span>
        {meeting.location ? <span className="text-sm text-ink-3">· 📍 {meeting.location}</span> : null}
        {meeting.onlineLink ? (
          <a href={meeting.onlineLink} target="_blank" rel="noopener noreferrer" className="text-sm text-brand hover:underline">· 🔗 Join online</a>
        ) : null}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 flex flex-col gap-6">
          {meeting.description ? (
            <section className="card p-5">
              <h2 className="mb-2 font-display text-sm font-semibold uppercase tracking-wide text-ink-3">Description</h2>
              <p className="whitespace-pre-wrap text-sm text-ink">{meeting.description}</p>
            </section>
          ) : null}

          <AgendaCard meetingId={id} directory={Array.isArray(dirQ.data) ? dirQ.data : []} />

          <LiveNotesCard meetingId={id} directory={Array.isArray(dirQ.data) ? dirQ.data : []} meetingProjectId={meeting.projectId} />

          <ActionItemsCard meetingId={id} directory={Array.isArray(dirQ.data) ? dirQ.data : []} />
        </div>

        <div className="lg:col-span-1">
          <AttendeesCard
            meetingId={id}
            attendees={Array.isArray(attendeesQ.data) ? attendeesQ.data : []}
            directory={Array.isArray(dirQ.data) ? dirQ.data : []}
            loading={attendeesQ.isLoading}
          />
        </div>
      </div>

      {showEdit ? <MeetingFormModal meeting={meeting} onClose={() => setShowEdit(false)} /> : null}
    </div>
  );
}

function ownerName(dir: DirectoryUser[], ownerId: string | null): string | null {
  if (!ownerId) return null;
  const u = dir.find((d) => d.id === ownerId);
  return u ? `${u.firstName} ${u.lastName}`.trim() || u.username : 'Unknown';
}

function AgendaCard({ meetingId, directory }: { meetingId: string; directory: DirectoryUser[] }) {
  const qc = useQueryClient();
  const [title, setTitle] = useState('');
  const [minutes, setMinutes] = useState('');
  const [ownerId, setOwnerId] = useState('');
  const [error, setError] = useState<string | null>(null);

  const agendaQ = useQuery({ queryKey: ['meeting', meetingId, 'agenda'], queryFn: () => meetingsApi(apiClient).listAgenda(meetingId), enabled: !!meetingId });
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
    onError: () => setError('Couldn’t add the agenda item.'),
  });
  const toggleMut = useMutation({
    mutationFn: ({ item, completed }: { item: AgendaItem; completed: boolean }) => meetingsApi(apiClient).updateAgendaItem(meetingId, item.id, { completed }),
    onSuccess: refresh,
  });
  const removeMut = useMutation({ mutationFn: (itemId: string) => meetingsApi(apiClient).removeAgendaItem(meetingId, itemId), onSuccess: refresh });
  const reorderMut = useMutation({ mutationFn: (orderedIds: string[]) => meetingsApi(apiClient).reorderAgenda(meetingId, orderedIds), onSuccess: refresh });

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

      {agendaQ.isLoading ? (
        <div className="skeleton h-16 w-full" />
      ) : items.length === 0 ? (
        <p className="text-sm text-ink-2">No agenda items yet. Add the topics you plan to cover.</p>
      ) : (
        <ol className="flex flex-col divide-y divide-line">
          {items.map((item, index) => {
            const presenter = ownerName(directory, item.ownerId);
            return (
              <li key={item.id} className="flex items-center gap-3 py-2.5">
                <input
                  type="checkbox"
                  checked={item.completed}
                  onChange={(e) => toggleMut.mutate({ item, completed: e.target.checked })}
                  aria-label={`Mark "${item.title}" done`}
                  className="h-4 w-4 shrink-0 accent-[color:rgb(var(--c-brand))]"
                />
                <div className="min-w-0 flex-1">
                  <span className={`block truncate text-sm font-medium ${item.completed ? 'text-ink-3 line-through' : 'text-ink'}`}>{item.title}</span>
                  {(presenter || item.expectedMinutes) ? (
                    <div className="mt-0.5 flex items-center gap-2 text-xs text-ink-3">
                      {presenter ? <span className="truncate">{presenter}</span> : null}
                      {item.expectedMinutes ? <Badge tone="neutral">{item.expectedMinutes} min</Badge> : null}
                    </div>
                  ) : null}
                </div>
                <div className="flex shrink-0 items-center">
                  <button onClick={() => move(index, -1)} disabled={index === 0} aria-label="Move up" className="rounded-md px-1 py-0.5 text-ink-3 transition-colors hover:bg-ground hover:text-ink disabled:opacity-30">↑</button>
                  <button onClick={() => move(index, 1)} disabled={index === items.length - 1} aria-label="Move down" className="rounded-md px-1 py-0.5 text-ink-3 transition-colors hover:bg-ground hover:text-ink disabled:opacity-30">↓</button>
                  <button onClick={() => removeMut.mutate(item.id)} aria-label={`Remove "${item.title}"`} className="ml-1 rounded-md px-1.5 py-1 text-ink-3 transition-colors hover:bg-danger-soft hover:text-danger">✕</button>
                </div>
              </li>
            );
          })}
        </ol>
      )}

      <form onSubmit={submitAdd} className="mt-4 flex flex-col gap-2 border-t border-line pt-4">
        {error ? <p role="alert" className="text-xs font-medium text-danger">{error}</p> : null}
        <div className="flex gap-2">
          <input aria-label="Agenda item" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Add an agenda item…" className={`${fieldClass(false)} flex-1`} />
          <input aria-label="Expected minutes" type="number" min={0} value={minutes} onChange={(e) => setMinutes(e.target.value)} placeholder="min" className={`${fieldClass(false)} w-20`} />
        </div>
        <div className="flex items-center gap-2">
          <SearchableSelect ariaLabel="Presenter" className="flex-1" placeholder="No presenter" options={ownerOptions} value={ownerId} onChange={setOwnerId} />
          <Button type="submit" size="sm" loading={addMut.isPending}>Add</Button>
        </div>
      </form>
    </section>
  );
}

const NOTE_TYPES: MeetingNoteType[] = ['DISCUSSION', 'DECISION', 'ACTION', 'ISSUE', 'QUESTION', 'INFORMATION'];

function authorLabel(dir: DirectoryUser[], authorId: string): string {
  const u = dir.find((d) => d.id === authorId);
  return u ? `${u.firstName} ${u.lastName}`.trim() || u.username : 'Someone';
}

function LiveNotesCard({ meetingId, directory, meetingProjectId }: { meetingId: string; directory: DirectoryUser[]; meetingProjectId: string | null }) {
  const qc = useQueryClient();
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

  const openTask = (taskId: string) => setSearchParams((prev) => { const next = new URLSearchParams(prev); next.set('task', taskId); return next; });

  const notesQ = useQuery({ queryKey: ['meeting', meetingId, 'notes'], queryFn: () => meetingsApi(apiClient).listNotes(meetingId), enabled: !!meetingId });
  const notes = Array.isArray(notesQ.data) ? notesQ.data : [];
  const filtered = filter === 'ALL' ? notes : notes.filter((n) => n.type === filter);
  const refresh = () => qc.invalidateQueries({ queryKey: ['meeting', meetingId, 'notes'] });

  const addMut = useMutation({
    mutationFn: () => meetingsApi(apiClient).addNote(meetingId, { body: body.trim(), type, highlighted: highlight }),
    onSuccess: () => { setBody(''); setHighlight(false); setError(null); refresh(); },
    onError: () => setError('Couldn’t save the note.'),
  });
  const saveEditMut = useMutation({
    mutationFn: (noteId: string) => meetingsApi(apiClient).updateNote(meetingId, noteId, { body: editBody.trim(), type: editType }),
    onSuccess: () => { setEditingId(null); refresh(); },
  });
  const toggleHighlightMut = useMutation({
    mutationFn: ({ note }: { note: MeetingNote }) => meetingsApi(apiClient).updateNote(meetingId, note.id, { highlighted: !note.highlighted }),
    onSuccess: refresh,
  });
  const removeMut = useMutation({ mutationFn: (noteId: string) => meetingsApi(apiClient).removeNote(meetingId, noteId), onSuccess: refresh });

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

      {/* Type filter */}
      {notes.length > 0 ? (
        <div className="mb-3 flex flex-wrap gap-1.5">
          {(['ALL', ...NOTE_TYPES] as (MeetingNoteType | 'ALL')[]).map((t) => (
            <button
              key={t}
              onClick={() => setFilter(t)}
              className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-colors ${filter === t ? 'bg-ink text-surface' : 'text-ink-3 hover:text-ink'}`}
            >
              {t === 'ALL' ? 'All' : NOTE_TYPE_LABELS[t]}
            </button>
          ))}
        </div>
      ) : null}

      {notesQ.isLoading ? (
        <div className="skeleton h-20 w-full" />
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
                <span className="text-xs font-medium text-ink-2">{authorLabel(directory, note.authorId)}</span>
                <span className="text-xs text-ink-3">· {formatClockTime(note.createdAt)}{note.editedAt ? ' · edited' : ''}</span>
                {note.taskId ? (
                  <button onClick={() => openTask(note.taskId!)} className="rounded-full" aria-label="Open the task created from this note">
                    <Badge tone="success">✓ Task created</Badge>
                  </button>
                ) : null}
                <div className="ml-auto flex items-center gap-0.5">
                  {!note.taskId ? (
                    <button onClick={() => setTaskForNote(note)} aria-label="Create task from note" title="Create task from note" className="rounded-md px-1 py-0.5 text-xs text-ink-3 transition-colors hover:bg-ground hover:text-brand">⭐</button>
                  ) : null}
                  <button onClick={() => toggleHighlightMut.mutate({ note })} aria-label={note.highlighted ? 'Remove highlight' : 'Highlight'} className={`rounded-md px-1 py-0.5 text-xs transition-colors hover:bg-ground ${note.highlighted ? 'text-warning' : 'text-ink-3'}`}>★</button>
                  <button onClick={() => startEdit(note)} aria-label="Edit note" className="rounded-md px-1 py-0.5 text-xs text-ink-3 transition-colors hover:bg-ground hover:text-ink">✎</button>
                  <button onClick={() => removeMut.mutate(note.id)} aria-label="Delete note" className="rounded-md px-1 py-0.5 text-xs text-ink-3 transition-colors hover:bg-danger-soft hover:text-danger">✕</button>
                </div>
              </div>
              {editingId === note.id ? (
                <div className="flex flex-col gap-2">
                  <div className="flex flex-wrap gap-1.5">
                    {NOTE_TYPES.map((t) => (
                      <button key={t} type="button" onClick={() => setEditType(t)} className={`rounded-full px-2 py-0.5 text-[11px] font-medium transition-colors ${editType === t ? 'bg-brand-gradient text-white' : 'border border-line text-ink-2 hover:bg-ground'}`}>
                        {NOTE_TYPE_LABELS[t]}
                      </button>
                    ))}
                  </div>
                  <textarea value={editBody} onChange={(e) => setEditBody(e.target.value)} rows={2} aria-label="Edit note" className={fieldClass(false)} />
                  <div className="flex gap-2">
                    <Button size="sm" loading={saveEditMut.isPending} onClick={() => saveEditMut.mutate(note.id)}>Save</Button>
                    <button type="button" onClick={() => setEditingId(null)} className="rounded-lg px-3 py-1 text-sm font-medium text-ink-2 hover:bg-ground">Cancel</button>
                  </div>
                </div>
              ) : (
                <p className="whitespace-pre-wrap text-sm text-ink">{note.body}</p>
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

function ActionItemsCard({ meetingId, directory }: { meetingId: string; directory: DirectoryUser[] }) {
  const qc = useQueryClient();
  const [description, setDescription] = useState('');
  const [assigneeId, setAssigneeId] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [priority, setPriority] = useState<Priority>('NORMAL');
  const [error, setError] = useState<string | null>(null);

  const itemsQ = useQuery({ queryKey: ['meeting', meetingId, 'action-items'], queryFn: () => meetingsApi(apiClient).listActionItems(meetingId), enabled: !!meetingId });
  const items = Array.isArray(itemsQ.data) ? itemsQ.data : [];
  const refresh = () => { qc.invalidateQueries({ queryKey: ['meeting', meetingId, 'action-items'] }); qc.invalidateQueries({ queryKey: ['my-action-items'] }); };
  const openCount = items.filter((i) => i.status !== 'COMPLETED' && i.status !== 'CANCELLED').length;

  const addMut = useMutation({
    mutationFn: () => meetingsApi(apiClient).addActionItem(meetingId, { description: description.trim(), assigneeId: assigneeId || null, dueDate: dueDate ? new Date(dueDate).toISOString() : null, priority }),
    onSuccess: () => { setDescription(''); setAssigneeId(''); setDueDate(''); setPriority('NORMAL'); setError(null); refresh(); },
    onError: () => setError('Couldn’t add the action item.'),
  });
  const statusMut = useMutation({ mutationFn: ({ id, status }: { id: string; status: ActionItemStatus }) => meetingsApi(apiClient).updateActionItem(id, { status }), onSuccess: refresh });
  const assignMut = useMutation({ mutationFn: ({ id, assigneeId: a }: { id: string; assigneeId: string | null }) => meetingsApi(apiClient).updateActionItem(id, { assigneeId: a }), onSuccess: refresh });
  const removeMut = useMutation({ mutationFn: (id: string) => meetingsApi(apiClient).removeActionItem(id), onSuccess: refresh });

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

      {itemsQ.isLoading ? (
        <div className="skeleton h-16 w-full" />
      ) : items.length === 0 ? (
        <p className="text-sm text-ink-2">No action items yet. Capture what needs doing and who owns it.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-line">
          {items.map((item) => (
            <li key={item.id} className="py-2.5">
              <div className="flex items-start gap-2.5">
                <div className="min-w-0 flex-1">
                  <p className={`text-sm ${item.status === 'COMPLETED' || item.status === 'CANCELLED' ? 'text-ink-3 line-through' : 'text-ink'}`}>{item.description}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
                    <Badge tone={actionStatusTone(item.status)}>{ACTION_STATUS_LABELS[item.status]}</Badge>
                    <span className="text-ink-3">{nameFor(item.assigneeId)}</span>
                    {item.dueDate ? <span className={item.overdue ? 'font-medium text-danger' : 'text-ink-3'}>· due {formatDueDate(item.dueDate)}{item.overdue ? ' (overdue)' : ''}</span> : null}
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
                  <button onClick={() => removeMut.mutate(item.id)} aria-label={`Remove ${item.description}`} className="rounded-md px-1.5 py-1 text-ink-3 transition-colors hover:bg-danger-soft hover:text-danger">✕</button>
                </div>
              </div>
              <div className="mt-1.5 pl-0">
                <SearchableSelect ariaLabel={`Assignee for ${item.description}`} className="max-w-[16rem]" placeholder="Unassigned" options={assigneeOptions} value={item.assigneeId ?? ''} onChange={(v) => assignMut.mutate({ id: item.id, assigneeId: v || null })} />
              </div>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={submitAdd} className="mt-4 flex flex-col gap-2 border-t border-line pt-4">
        {error ? <p role="alert" className="text-xs font-medium text-danger">{error}</p> : null}
        <input aria-label="Action item" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What needs to be done?" className={fieldClass(false)} />
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

function AttendeesCard({ meetingId, attendees, directory, loading }: { meetingId: string; attendees: Attendee[]; directory: DirectoryUser[]; loading: boolean }) {
  const qc = useQueryClient();
  const [mode, setMode] = useState<'internal' | 'external'>('internal');
  const [pickUser, setPickUser] = useState('');
  const [role, setRole] = useState<AttendeeRole>('REQUIRED');
  const [extName, setExtName] = useState('');
  const [extEmail, setExtEmail] = useState('');
  const [error, setError] = useState<string | null>(null);

  const refresh = () => qc.invalidateQueries({ queryKey: ['meeting', meetingId, 'attendees'] });

  const addMut = useMutation({
    mutationFn: () =>
      mode === 'internal'
        ? meetingsApi(apiClient).addAttendee(meetingId, { userId: pickUser, role })
        : meetingsApi(apiClient).addAttendee(meetingId, { externalName: extName.trim(), externalEmail: extEmail.trim() || null, role }),
    onSuccess: () => { setPickUser(''); setExtName(''); setExtEmail(''); setError(null); refresh(); },
    onError: () => setError('Couldn’t add attendee. They may already be invited.'),
  });
  const attendanceMut = useMutation({
    mutationFn: ({ attendeeId, attendance }: { attendeeId: string; attendance: AttendanceStatus }) =>
      meetingsApi(apiClient).updateAttendee(meetingId, attendeeId, { attendance }),
    onSuccess: refresh,
  });
  const removeMut = useMutation({
    mutationFn: (attendeeId: string) => meetingsApi(apiClient).removeAttendee(meetingId, attendeeId),
    onSuccess: refresh,
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
    addMut.mutate();
  }

  return (
    <section className="card p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-display text-sm font-semibold uppercase tracking-wide text-ink-3">Attendees</h2>
        <span className="text-xs text-ink-3">{attendees.length}</span>
      </div>

      {loading ? (
        <div className="skeleton h-16 w-full" />
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
                    <span className="truncate text-sm font-medium text-ink">{personName(directory, a)}</span>
                    {a.role === 'OPTIONAL' ? <Badge tone="neutral">Optional</Badge> : null}
                    {!a.userId ? <Badge tone="info">Guest</Badge> : null}
                  </div>
                  {a.externalEmail ? <p className="truncate text-xs text-ink-3">{a.externalEmail}</p> : null}
                </div>
                <button
                  onClick={() => removeMut.mutate(a.id)}
                  aria-label={`Remove ${personName(directory, a)}`}
                  className="shrink-0 rounded-md px-1.5 py-1 text-ink-3 transition-colors hover:bg-danger-soft hover:text-danger"
                >
                  ✕
                </button>
              </div>
              <div className="mt-1.5 flex items-center gap-2 pl-[2.375rem]">
                <Badge tone={attendanceTone(a.attendance)}>{ATTENDANCE_LABELS[a.attendance]}</Badge>
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
              </div>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={submitAdd} className="mt-4 flex flex-col gap-2 border-t border-line pt-4">
        <div className="inline-flex self-start rounded-lg border border-line bg-surface p-0.5 text-xs">
          {(['internal', 'external'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
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
            <input aria-label="Guest name" value={extName} onChange={(e) => setExtName(e.target.value)} placeholder="Guest name" className={fieldClass(false)} />
            <input aria-label="Guest email" value={extEmail} onChange={(e) => setExtEmail(e.target.value)} placeholder="Email (optional)" className={fieldClass(false)} />
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
    </section>
  );
}
