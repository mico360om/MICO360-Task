import { useEffect, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { meetingsApi, NOTE_TYPE_LABELS, type MeetingNote, type MeetingNoteType } from '../../api/meetings';
import type { DirectoryUser } from '../../api/users';
import { apiClient } from '../../api/client';
import { useAuthStore } from '../../stores/auth-store';
import { Button } from '../ui/Button';
import { fieldClass } from '../ui/Field';
import { CreateTaskFromNoteModal } from '../CreateTaskFromNoteModal';
import { SaveIndicator, useSaveState } from '../task-drawer/save-state';
import { ConfirmRemoveButton, Icon, LoadError, Section, SectionError, userName } from './kit';
import { meetingFailure } from './meeting-actions';
import { formatClockTime } from '../../lib/meetingFormat';

const NOTE_TYPES: MeetingNoteType[] = ['DISCUSSION', 'DECISION', 'ACTION', 'ISSUE', 'QUESTION', 'INFORMATION'];

/** Each category's colour: chip when picked, and the stripe on its notes. */
const TYPE_STYLE: Record<MeetingNoteType, { chip: string; stripe: string; text: string }> = {
  DISCUSSION: { chip: 'border-ink-3/40 bg-ground text-ink', stripe: 'bg-ink-3/60', text: 'text-ink-2' },
  DECISION: { chip: 'border-success/40 bg-success-soft text-success', stripe: 'bg-success', text: 'text-success' },
  ACTION: { chip: 'border-brand/40 bg-brand/10 text-brand', stripe: 'bg-brand', text: 'text-brand' },
  ISSUE: { chip: 'border-danger/40 bg-danger-soft text-danger', stripe: 'bg-danger', text: 'text-danger' },
  QUESTION: { chip: 'border-warning/40 bg-warning-soft text-warning', stripe: 'bg-warning', text: 'text-warning' },
  INFORMATION: { chip: 'border-info/40 bg-info-soft text-info', stripe: 'bg-info', text: 'text-info' },
};

function TypePicker({ value, onChange, name, label }: { value: MeetingNoteType; onChange: (t: MeetingNoteType) => void; name: string; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1.5">
      {NOTE_TYPES.map((t) => (
        <label
          key={t}
          className={`inline-flex min-h-8 cursor-pointer items-center rounded-full border px-2.5 text-xs font-medium transition-colors focus-within:ring-2 focus-within:ring-brand/40 ${
            value === t ? TYPE_STYLE[t].chip : 'border-line text-ink-2 hover:bg-ground'
          }`}
        >
          <input type="radio" name={name} value={t} checked={value === t} onChange={() => onChange(t)} className="sr-only" />
          {NOTE_TYPE_LABELS[t]}
        </label>
      ))}
    </div>
  );
}

/** Live notes: capture discussion, decisions, action items, issues, questions and information as the meeting runs. */
export function NotesSection({
  meetingId,
  meetingProjectId,
  directory,
  canEdit,
  pollMs,
  timeZone,
}: {
  meetingId: string;
  meetingProjectId: string | null;
  directory: DirectoryUser[];
  canEdit: boolean;
  pollMs: number | false;
  timeZone: string;
}) {
  const qc = useQueryClient();
  const myId = useAuthStore((s) => s.user?.id);
  const [, setSearchParams] = useSearchParams();
  const [type, setType] = useState<MeetingNoteType>('DISCUSSION');
  const [body, setBody] = useState('');
  const [highlight, setHighlight] = useState(false);
  const [filter, setFilter] = useState<MeetingNoteType | 'ALL' | 'KEY'>('ALL');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [taskForNote, setTaskForNote] = useState<MeetingNote | null>(null);
  const [opError, setOpError] = useState<string | null>(null);
  const compose = useSaveState();

  const openTask = (taskId: string) =>
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('task', taskId);
      return next;
    });

  const notesQ = useQuery({ queryKey: ['meeting', meetingId, 'notes'], queryFn: () => meetingsApi(apiClient).listNotes(meetingId), enabled: !!meetingId, refetchInterval: pollMs });
  // Same query as the action items section: names the task a note became.
  const itemsQ = useQuery({ queryKey: ['meeting', meetingId, 'action-items'], queryFn: () => meetingsApi(apiClient).listActionItems(meetingId), enabled: !!meetingId, refetchInterval: pollMs });
  const notes = Array.isArray(notesQ.data) ? notesQ.data : [];
  const taskKeyOf = (note: MeetingNote) => (Array.isArray(itemsQ.data) ? itemsQ.data : []).find((i) => i.taskId && i.taskId === note.taskId)?.taskKey ?? null;
  const counts = new Map<string, number>();
  for (const n of notes) counts.set(n.type, (counts.get(n.type) ?? 0) + 1);
  const keyCount = notes.filter((n) => n.highlighted).length;
  const shown = filter === 'ALL' ? notes : filter === 'KEY' ? notes.filter((n) => n.highlighted) : notes.filter((n) => n.type === filter);
  const refresh = () => qc.invalidateQueries({ queryKey: ['meeting', meetingId, 'notes'] });
  // Authors manage their own notes; meeting managers can tidy up any note.
  const canManage = (note: MeetingNote) => canEdit || note.authorId === myId;

  const highlightMut = useMutation({
    mutationFn: (note: MeetingNote) => meetingsApi(apiClient).updateNote(meetingId, note.id, { highlighted: !note.highlighted }),
    onSuccess: refresh,
    onError: (err) => setOpError(meetingFailure(err, 'Couldn’t change the key point.')),
  });
  // Deleted notes can be brought back for a few seconds (the server keeps them, MTG-07).
  const [undoNoteId, setUndoNoteId] = useState<string | null>(null);
  useEffect(() => {
    if (!undoNoteId) return;
    const t = setTimeout(() => setUndoNoteId(null), 10_000);
    return () => clearTimeout(t);
  }, [undoNoteId]);
  const removeMut = useMutation({
    mutationFn: (noteId: string) => meetingsApi(apiClient).removeNote(meetingId, noteId),
    onSuccess: (_res, noteId) => {
      setUndoNoteId(noteId);
      void refresh();
    },
    onError: (err) => setOpError(meetingFailure(err, 'Couldn’t delete the note.')),
  });
  const restoreMut = useMutation({
    mutationFn: (noteId: string) => meetingsApi(apiClient).restoreNote(meetingId, noteId),
    onSuccess: () => {
      setUndoNoteId(null);
      void refresh();
    },
    onError: (err) => setOpError(meetingFailure(err, 'Couldn’t restore the note.')),
  });

  async function submitAdd(e?: FormEvent) {
    e?.preventDefault();
    if (!body.trim()) {
      compose.fail('Write the note first.');
      return;
    }
    // The text stays until the server has it, so a failed save loses nothing.
    const ok = await compose.run(() =>
      meetingsApi(apiClient)
        .addNote(meetingId, { body: body.trim(), type, highlighted: highlight })
        .catch((err) => {
          throw new Error(meetingFailure(err, 'Couldn’t save the note — it’s still here, so you can try again.'));
        }),
    );
    if (ok) {
      setBody('');
      setHighlight(false);
      void refresh();
    }
  }
  function onComposerKey(e: ReactKeyboardEvent<HTMLTextAreaElement>) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      void submitAdd();
    }
  }

  const filters: { key: MeetingNoteType | 'ALL' | 'KEY'; label: string; n: number }[] = [
    { key: 'ALL', label: 'All', n: notes.length },
    ...(keyCount ? [{ key: 'KEY' as const, label: 'Key points', n: keyCount }] : []),
    ...NOTE_TYPES.filter((t) => counts.get(t)).map((t) => ({ key: t, label: NOTE_TYPE_LABELS[t], n: counts.get(t)! })),
  ];

  return (
    <Section id="notes" title="Live notes" count={notes.length || undefined}>
      {/* Composer — pick a category, write, ⌘/Ctrl+Enter to add. */}
      <form onSubmit={(e) => void submitAdd(e)} className="mb-4 flex flex-col gap-2 rounded-xl border border-line bg-ground/40 p-3">
        <TypePicker value={type} onChange={setType} name="note-type" label="Note category" />
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={onComposerKey}
          rows={2}
          dir="auto"
          placeholder={`Write a ${NOTE_TYPE_LABELS[type].toLowerCase()}… (Ctrl+Enter to add)`}
          aria-label="New note"
          className={fieldClass(compose.state.status === 'error')}
        />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <label className="flex min-h-9 items-center gap-1.5 text-sm text-ink-2">
            <input type="checkbox" checked={highlight} onChange={(e) => setHighlight(e.target.checked)} className="h-4 w-4 accent-[color:rgb(var(--c-brand))]" />
            Mark as a key point
          </label>
          <div className="flex items-center gap-2">
            <SaveIndicator state={compose.state} />
            <Button type="submit" size="sm" loading={compose.busy}>Add note</Button>
          </div>
        </div>
      </form>

      <SectionError message={opError} onDismiss={() => setOpError(null)} />
      {undoNoteId ? (
        <div role="status" aria-label="Note deleted" className="mb-3 flex items-center justify-between gap-3 rounded-lg border border-line bg-ground px-3 py-2 text-sm text-ink-2">
          <span>Note deleted.</span>
          <button type="button" onClick={() => restoreMut.mutate(undoNoteId)} disabled={restoreMut.isPending} className="min-h-8 rounded-md px-2 font-semibold text-brand hover:bg-surface disabled:opacity-60">
            Undo
          </button>
        </div>
      ) : null}

      {notes.length > 0 ? (
        <div role="group" aria-label="Show notes" className="mb-3 flex flex-wrap gap-1.5">
          {filters.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              aria-pressed={filter === f.key}
              className={`min-h-8 rounded-full px-2.5 text-xs font-medium transition-colors ${filter === f.key ? 'bg-ink text-surface' : 'text-ink-2 hover:bg-ground hover:text-ink'}`}
            >
              {f.label} <span className="tabular-nums opacity-70">{f.n}</span>
            </button>
          ))}
        </div>
      ) : null}

      {notesQ.isLoading ? (
        <div className="skeleton h-20 w-full" />
      ) : notesQ.isError ? (
        <LoadError what="the notes" onRetry={() => void notesQ.refetch()} />
      ) : shown.length === 0 ? (
        <p className="text-sm text-ink-2">{notes.length === 0 ? 'No notes yet. Capture discussion, decisions and actions as the meeting unfolds.' : 'No notes in this category.'}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {shown.map((note) => (
            <li key={note.id} className={`relative overflow-hidden rounded-xl border pl-4 pr-3 py-2.5 ${note.highlighted ? 'border-warning/50 bg-warning-soft/30' : 'border-line bg-surface'}`}>
              <span aria-hidden="true" className={`absolute inset-y-0 left-0 w-1 ${TYPE_STYLE[note.type].stripe}`} />
              {editingId === note.id ? (
                <NoteEditor
                  meetingId={meetingId}
                  note={note}
                  onDone={(saved) => {
                    // Show the saved note straight away (with its "edited" mark), then refresh.
                    if (saved) qc.setQueryData<MeetingNote[]>(['meeting', meetingId, 'notes'], (list) => list?.map((n) => (n.id === saved.id ? saved : n)));
                    setEditingId(null);
                    void refresh();
                  }}
                />
              ) : (
                <>
                  <div className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                    <span className={`font-semibold uppercase tracking-wide ${TYPE_STYLE[note.type].text}`}>{NOTE_TYPE_LABELS[note.type]}</span>
                    {note.highlighted ? <span className="inline-flex items-center gap-0.5 font-medium text-warning">{Icon.star(true)} Key point</span> : null}
                    <span className="text-ink-2"><bdi>{userName(directory, note.authorId) ?? 'Someone'}</bdi></span>
                    <span className="text-ink-3">· {formatClockTime(note.createdAt, timeZone)}{note.editedAt ? ' · edited' : ''}</span>
                    {note.taskId ? (
                      <button type="button" onClick={() => openTask(note.taskId!)} className="inline-flex min-h-7 items-center gap-1 rounded-full bg-success-soft px-2 font-medium text-success hover:brightness-95">
                        {Icon.task} {taskKeyOf(note) ?? 'Task'} <span className="sr-only">— open the task made from this note</span>
                      </button>
                    ) : null}
                  </div>
                  <p dir="auto" className="whitespace-pre-wrap text-start text-sm text-ink">{note.body}</p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1">
                    {!note.taskId && note.type === 'ACTION' ? (
                      <button type="button" onClick={() => setTaskForNote(note)} className="inline-flex min-h-8 items-center gap-1 rounded-md border border-brand/30 px-2 text-xs font-medium text-brand hover:bg-brand/10">
                        {Icon.task} Make it a task
                      </button>
                    ) : null}
                    <div className="ml-auto flex items-center">
                      {!note.taskId && note.type !== 'ACTION' ? (
                        <button type="button" onClick={() => setTaskForNote(note)} aria-label="Create task from note" title="Create task from note" className="grid h-9 w-9 place-items-center rounded-md text-ink-3 hover:bg-ground hover:text-brand sm:h-8 sm:w-8">{Icon.task}</button>
                      ) : null}
                      {canManage(note) ? (
                        <>
                          <button
                            type="button"
                            onClick={() => highlightMut.mutate(note)}
                            aria-pressed={note.highlighted}
                            aria-label={note.highlighted ? 'Unmark key point' : 'Mark as key point'}
                            title={note.highlighted ? 'Unmark key point' : 'Mark as key point'}
                            className={`grid h-9 w-9 place-items-center rounded-md hover:bg-ground sm:h-8 sm:w-8 ${note.highlighted ? 'text-warning' : 'text-ink-3'}`}
                          >
                            {Icon.star(note.highlighted)}
                          </button>
                          <button type="button" onClick={() => setEditingId(note.id)} aria-label="Edit note" title="Edit note" className="grid h-9 w-9 place-items-center rounded-md text-ink-3 hover:bg-ground hover:text-ink sm:h-8 sm:w-8">{Icon.edit}</button>
                          <ConfirmRemoveButton label="Delete note" onConfirm={() => removeMut.mutate(note.id)} disabled={removeMut.isPending} />
                        </>
                      ) : null}
                    </div>
                  </div>
                </>
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
          onCreated={() => {
            void refresh();
            void qc.invalidateQueries({ queryKey: ['meeting', meetingId, 'action-items'] });
            void qc.invalidateQueries({ queryKey: ['my-action-items'] });
          }}
          onOpenTask={openTask}
        />
      ) : null}
    </Section>
  );
}

function NoteEditor({ meetingId, note, onDone }: { meetingId: string; note: MeetingNote; onDone: (saved?: MeetingNote) => void }) {
  const [body, setBody] = useState(note.body);
  const [type, setType] = useState<MeetingNoteType>(note.type);
  const save = useSaveState();
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!body.trim()) {
      save.fail('A note can’t be empty.');
      return;
    }
    let saved: MeetingNote | undefined;
    const ok = await save.run(async () => {
      saved = await meetingsApi(apiClient).updateNote(meetingId, note.id, { body: body.trim(), type }).catch((err) => {
        throw new Error(meetingFailure(err, 'Couldn’t save your changes — they’re still here, so you can try again.'));
      });
    });
    if (ok) onDone(saved);
  }
  return (
    <form
      onSubmit={(e) => void submit(e)}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          onDone();
        }
      }}
      className="flex flex-col gap-2"
    >
      <TypePicker value={type} onChange={setType} name={`note-type-${note.id}`} label="Category" />
      <textarea value={body} dir="auto" autoFocus onChange={(e) => setBody(e.target.value)} rows={3} aria-label="Edit note" className={fieldClass(save.state.status === 'error')} />
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="sm" loading={save.busy}>Save</Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => onDone()} disabled={save.busy}>Cancel</Button>
        <SaveIndicator state={save.state} />
      </div>
    </form>
  );
}
