import { useMemo, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../api/client';
import { meetingsApi, NOTE_TYPE_LABELS, type MeetingNote, type NoteTask, type Priority } from '../api/meetings';
import { projectsApi } from '../api/projects';
import { usersApi } from '../api/users';
import { Button } from './ui/Button';
import { FieldLabel, fieldClass } from './ui/Field';
import { SearchableSelect } from './ui/SearchableSelect';
import { Badge } from './ui/Badge';
import { useDialog } from '../hooks/useDialog';

export interface CreateTaskFromNoteModalProps {
  meetingId: string;
  note: MeetingNote;
  /** The meeting's project, pre-selected by default (null for a standalone meeting). */
  defaultProjectId: string | null;
  onClose: () => void;
  onCreated: () => void;
  /** Open the created task (the global task drawer). */
  onOpenTask?: (taskId: string) => void;
}

const PRIORITY_OPTIONS: { value: Priority; label: string }[] = [
  { value: 'LOW', label: 'Low' },
  { value: 'NORMAL', label: 'Normal' },
  { value: 'HIGH', label: 'High' },
  { value: 'URGENT', label: 'Urgent' },
];

function deriveTitle(body: string): string {
  const first = body.split('\n').map((l) => l.trim()).find((l) => l.length > 0) ?? body.trim();
  const clean = first.replace(/\s+/g, ' ');
  return clean.length > 120 ? clean.slice(0, 117).trimEnd() + '…' : clean;
}

/** ⭐ Create a board task from a meeting note, with editable, auto-populated details. */
export function CreateTaskFromNoteModal({ meetingId, note, defaultProjectId, onClose, onCreated, onOpenTask }: CreateTaskFromNoteModalProps) {
  const qc = useQueryClient();
  const dialogRef = useDialog(onClose);
  const [title, setTitle] = useState(() => deriveTitle(note.body));
  const [projectId, setProjectId] = useState(defaultProjectId ?? '');
  const [priority, setPriority] = useState<Priority>('NORMAL');
  const [dueDate, setDueDate] = useState('');
  const [assigneeId, setAssigneeId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<NoteTask | null>(null);

  const projectsQ = useQuery({ queryKey: ['projects'], queryFn: () => projectsApi(apiClient).list() });
  const dirQ = useQuery({ queryKey: ['directory'], queryFn: () => usersApi(apiClient).directory() });

  const projectOptions = useMemo(
    () => (Array.isArray(projectsQ.data) ? projectsQ.data : []).map((p) => ({ value: p.id, label: p.name, hint: p.code })),
    [projectsQ.data],
  );
  const assigneeOptions = useMemo(
    () => [{ value: '', label: 'Unassigned' }, ...(Array.isArray(dirQ.data) ? dirQ.data : []).map((u) => ({ value: u.id, label: `${u.firstName} ${u.lastName}`.trim() || u.username, hint: `@${u.username}` }))],
    [dirQ.data],
  );

  const createMut = useMutation({
    mutationFn: () =>
      meetingsApi(apiClient).createTaskFromNote(meetingId, note.id, {
        title: title.trim(),
        projectId: projectId || null,
        priority,
        dueDate: dueDate ? new Date(dueDate).toISOString() : null,
        assigneeId: assigneeId || null,
      }),
    onSuccess: (res) => {
      setCreated(res.task);
      qc.invalidateQueries({ queryKey: ['meeting', meetingId, 'notes'] });
      qc.invalidateQueries({ queryKey: ['tasks'] });
      onCreated();
    },
    onError: () => setError('Couldn’t create the task. Pick a project and try again.'),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!title.trim()) { setError('Give the task a title.'); return; }
    if (!projectId) { setError('Choose a project for this task.'); return; }
    createMut.mutate();
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-4">
      <div className="absolute inset-0 bg-ink/40 animate-fade-in" onClick={onClose} aria-hidden="true" />
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-label="Create task from note" className="card relative w-full max-w-md animate-scale-in p-6">
        <h2 className="mb-1 flex items-center gap-2 font-display text-xl font-bold text-ink">
          <span aria-hidden="true">⭐</span> Create task from note
        </h2>

        {/* Source note context */}
        <div className="mb-4 rounded-lg border border-line bg-ground/50 p-3">
          <Badge tone="brand">{NOTE_TYPE_LABELS[note.type]}</Badge>
          <p className="mt-1.5 line-clamp-3 whitespace-pre-wrap text-sm text-ink-2">{note.body}</p>
        </div>

        {created ? (
          <div className="flex flex-col gap-3">
            <p className="rounded-lg bg-success-soft px-3 py-2 text-sm text-success">
              Task <span className="font-semibold">{created.key}</span> created — “{created.title}”.
            </p>
            <div className="flex gap-2">
              {onOpenTask ? <Button onClick={() => { onOpenTask(created.id); onClose(); }}>Open task</Button> : null}
              <button type="button" onClick={onClose} className="rounded-lg px-4 py-2 text-sm font-medium text-ink-2 transition-colors hover:bg-ground">Done</button>
            </div>
          </div>
        ) : (
          <form onSubmit={submit} className="flex flex-col gap-3">
            {error ? <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p> : null}
            <div className="flex flex-col gap-1.5">
              <FieldLabel htmlFor="ctn-title" required>Title</FieldLabel>
              <input id="ctn-title" value={title} onChange={(e) => setTitle(e.target.value)} className={fieldClass(false)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <FieldLabel required>Project</FieldLabel>
              <SearchableSelect ariaLabel="Project" placeholder="Choose a project…" options={projectOptions} value={projectId} onChange={setProjectId} />
              {!defaultProjectId ? <p className="text-xs text-ink-2">This is a standalone meeting — pick a board for the task.</p> : null}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <FieldLabel>Priority</FieldLabel>
                <SearchableSelect ariaLabel="Priority" options={PRIORITY_OPTIONS} value={priority} onChange={(v) => setPriority(v as Priority)} />
              </div>
              <div className="flex flex-col gap-1.5">
                <FieldLabel htmlFor="ctn-due">Due date</FieldLabel>
                <input id="ctn-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className={fieldClass(false)} />
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <FieldLabel>Assignee</FieldLabel>
              <SearchableSelect ariaLabel="Assignee" placeholder="Unassigned" options={assigneeOptions} value={assigneeId} onChange={setAssigneeId} />
            </div>
            <Button type="submit" loading={createMut.isPending}>{createMut.isPending ? 'Creating…' : 'Create task'}</Button>
            <button type="button" onClick={onClose} className="w-full rounded-lg py-2 text-sm font-medium text-ink-2 transition-colors hover:bg-ground">Cancel</button>
          </form>
        )}
      </div>
    </div>
  );
}
