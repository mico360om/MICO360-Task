import { useMemo, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../api/client';
import { meetingsApi, NOTE_TYPE_LABELS, type MeetingNote, type NoteTask, type Priority } from '../api/meetings';
import { projectsApi } from '../api/projects';
import { membersApi } from '../api/members';
import { ApiError } from '../lib/api-client';
import { invalidateTaskQueries } from '../lib/task-cache';
import { noteWords } from '../lib/rich-note';
import { defaultDueDay, defaultDueNote } from '../lib/default-due';
import { todayKey } from '../lib/due-date';
import { useCompanyTimeZone } from '../lib/company-clock';
import { Button } from './ui/Button';
import { FieldLabel, fieldClass } from './ui/Field';
import { SearchableSelect } from './ui/SearchableSelect';
import { Badge } from './ui/Badge';
import { useDialog } from '../hooks/useDialog';
import { ModalPortal } from './ui/ModalPortal';
import { projectOption } from './project-option';

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
  // A formatted note gives its words (and list structure), never its markup.
  const [title, setTitle] = useState(() => deriveTitle(noteWords(note)));
  const [projectId, setProjectId] = useState(defaultProjectId ?? '');
  const [priority, setPriority] = useState<Priority>('NORMAL');
  const [dueDate, setDueDate] = useState('');
  const [assigneeId, setAssigneeId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<NoteTask | null>(null);
  const [assigneeWarning, setAssigneeWarning] = useState<string | null>(null);
  const [tracked, setTracked] = useState<{ ok: boolean; message?: string } | null>(null);

  const projectsQ = useQuery({ queryKey: ['projects'], queryFn: () => projectsApi(apiClient).list() });
  // Tasks can only be assigned to people on the project, so offer that project's members.
  const membersQ = useQuery({
    queryKey: ['project-members', projectId],
    queryFn: () => membersApi(apiClient).list(projectId),
    enabled: !!projectId,
  });

  const projectOptions = useMemo(
    () => (Array.isArray(projectsQ.data) ? projectsQ.data : []).map(projectOption),
    [projectsQ.data],
  );
  // Left without a date, the task gets today's from a project with "New tasks are due today" (a task
  // made from a note goes on today's board, so there is no later board day here).
  const today = todayKey(useCompanyTimeZone());
  const autoDue = defaultDueDay((Array.isArray(projectsQ.data) ? projectsQ.data : []).find((p) => p.id === projectId), dueDate, null, today);
  const assigneeOptions = useMemo(
    () => [
      { value: '', label: 'Unassigned' },
      ...(projectId && Array.isArray(membersQ.data) ? membersQ.data : []).map((u) => ({
        value: u.id,
        label: `${u.firstName} ${u.lastName}`.trim() || u.username,
        hint: `@${u.username}`,
      })),
    ],
    [projectId, membersQ.data],
  );

  function chooseProject(next: string) {
    setProjectId(next);
    setAssigneeId(''); // the old choice may not be a member of the new project
  }

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
      setAssigneeWarning(res.assigneeError ?? null);
      setTracked(res.actionItem ? { ok: true } : res.actionItemError ? { ok: false, message: res.actionItemError } : null);
      qc.invalidateQueries({ queryKey: ['meeting', meetingId, 'notes'] });
      qc.invalidateQueries({ queryKey: ['meeting', meetingId, 'action-items'] });
      void invalidateTaskQueries(qc);
      onCreated();
    },
    // Show the server's reason (e.g. the note already has a task, or no access to that project).
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Couldn’t create the task. Check your connection and try again.'),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!title.trim()) { setError('Give the task a title.'); return; }
    if (!projectId) { setError('Choose a project for this task.'); return; }
    createMut.mutate();
  }

  const intro = (
    <>
      <h2 className="mb-1 flex items-center gap-2 font-display text-xl font-bold text-ink">
        <span aria-hidden="true">⭐</span> Create task from note
      </h2>

      {/* Source note context */}
      <div className="rounded-lg border border-line bg-ground/50 p-3">
        <Badge tone="brand">{NOTE_TYPE_LABELS[note.type]}</Badge>
        <p dir="auto" className="mt-1.5 line-clamp-3 whitespace-pre-wrap text-sm text-ink-2">{noteWords(note)}</p>
      </div>
    </>
  );

  return (
    <ModalPortal>
      <div className="above-keyboard fixed inset-0 z-50 grid place-items-center p-4">
        <div className="absolute inset-0 bg-ink/40 animate-fade-in" onClick={onClose} aria-hidden="true" />
        <div ref={dialogRef} role="dialog" aria-modal="true" aria-label="Create task from note" className="keyboard-flow-cramped card relative flex max-h-[calc(var(--visible-height)-2rem)] w-full max-w-md animate-scale-in flex-col overflow-hidden">
          {created ? (
            <div className="min-h-0 flex-1 overflow-y-auto p-6">
              {intro}
              <div className="mt-4 flex flex-col gap-3">
                <p className="rounded-lg bg-success-soft px-3 py-2 text-sm text-success">
                  Task <span className="font-semibold">{created.key}</span> created — “<span dir="auto">{created.title}</span>”.
                </p>
                {tracked?.ok ? (
                  <p className="text-sm text-ink-2">It’s also on the meeting’s action items, linked to the task — no need to add it again.</p>
                ) : tracked ? (
                  <p role="status" className="rounded-lg bg-warning-soft px-3 py-2 text-sm text-warning">{tracked.message}</p>
                ) : null}
                {assigneeWarning ? (
                  <p role="status" className="rounded-lg bg-warning-soft px-3 py-2 text-sm text-warning">
                    It couldn’t be assigned: {assigneeWarning} Assign someone from the task instead.
                  </p>
                ) : null}
                <div className="flex gap-2">
                  {onOpenTask ? <Button onClick={() => { onOpenTask(created.id); onClose(); }}>Open task</Button> : null}
                  <button type="button" onClick={onClose} className="rounded-lg px-4 py-2 text-sm font-medium text-ink-2 transition-colors hover:bg-ground">Done</button>
                </div>
              </div>
            </div>
          ) : (
            // The fields scroll; the buttons stay in view — above a phone's keyboard, too.
            <form onSubmit={submit} className="keyboard-flow-body flex min-h-0 flex-1 flex-col">
              <div className="keyboard-flow-body flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-6">
                <div className="mb-1">{intro}</div>
                {error ? <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p> : null}
                <div className="flex flex-col gap-1.5">
                  <FieldLabel htmlFor="ctn-title" required>Title</FieldLabel>
                  <input id="ctn-title" dir="auto" maxLength={191} value={title} onChange={(e) => setTitle(e.target.value)} className={fieldClass(false)} />
                </div>
                <div className="flex flex-col gap-1.5">
                  <FieldLabel required>Project</FieldLabel>
                  <SearchableSelect ariaLabel="Project" placeholder="Choose a project…" options={projectOptions} value={projectId} onChange={chooseProject} />
                  {!defaultProjectId ? <p className="text-xs text-ink-2">This is a standalone meeting — pick a board for the task.</p> : null}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="flex flex-col gap-1.5">
                    <FieldLabel>Priority</FieldLabel>
                    <SearchableSelect ariaLabel="Priority" options={PRIORITY_OPTIONS} value={priority} onChange={(v) => setPriority(v as Priority)} />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <FieldLabel htmlFor="ctn-due">Due date</FieldLabel>
                    <input id="ctn-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} aria-describedby={autoDue ? 'ctn-due-note' : undefined} className={fieldClass(false)} />
                    {autoDue ? <p id="ctn-due-note" className="text-xs text-ink-2">{defaultDueNote(autoDue, today)}</p> : null}
                  </div>
                </div>
                <div className="flex flex-col gap-1.5">
                  <FieldLabel>Assignee</FieldLabel>
                  <SearchableSelect ariaLabel="Assignee" placeholder="Unassigned" options={assigneeOptions} value={assigneeId} onChange={setAssigneeId} />
                  {!projectId ? <p className="text-xs text-ink-2">Choose a project to pick someone from its team.</p> : null}
                </div>
              </div>
              <div className="flex flex-none items-center gap-2 border-t border-line px-6 py-3">
                <button type="button" title="Cancel (Esc)" aria-keyshortcuts="Escape" onClick={onClose} className="!min-h-[44px] flex-1 rounded-xl border border-line px-4 text-sm font-semibold text-ink transition-colors hover:bg-ground disabled:opacity-50">Cancel</button>
                <Button type="submit" shortcut="submit" showShortcut loading={createMut.isPending} className="!min-h-[44px] flex-[2]">{createMut.isPending ? 'Creating…' : 'Create task'}</Button>
              </div>
            </form>
          )}
        </div>
      </div>
    </ModalPortal>
  );
}
