import { useRef, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../api/client';
import { meetingsApi, MEETING_STATUS_LABELS, type Meeting, type MeetingStatus } from '../api/meetings';
import { projectsApi } from '../api/projects';
import { fromLocalInputValue, toLocalInputValue } from '../lib/meetingFormat';
import { Button } from './ui/Button';
import { FieldLabel, fieldClass } from './ui/Field';
import { SearchableSelect } from './ui/SearchableSelect';
import { useDialog } from '../hooks/useDialog';

export interface MeetingFormModalProps {
  /** When provided, the modal edits this meeting; otherwise it creates a new one. */
  meeting?: Meeting;
  onClose: () => void;
  onSaved?: (id: string) => void;
}

const CREATE_STATUS: MeetingStatus[] = ['DRAFT', 'SCHEDULED', 'IN_PROGRESS'];
const ALL_STATUS: MeetingStatus[] = ['DRAFT', 'SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'];

function defaultStart(): string {
  const d = new Date();
  d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() + 1);
  return toLocalInputValue(d.toISOString());
}

/** Create or edit a meeting. Project is optional — blank means a standalone meeting. */
export function MeetingFormModal({ meeting, onClose, onSaved }: MeetingFormModalProps) {
  const qc = useQueryClient();
  const dialogRef = useDialog(onClose);
  const editing = !!meeting;
  const [title, setTitle] = useState(meeting?.title ?? '');
  const [start, setStart] = useState(() => (meeting ? toLocalInputValue(meeting.startAt) : defaultStart()));
  const [end, setEnd] = useState(() => (meeting ? toLocalInputValue(meeting.endAt) : ''));
  const [location, setLocation] = useState(meeting?.location ?? '');
  const [onlineLink, setOnlineLink] = useState(meeting?.onlineLink ?? '');
  const [projectId, setProjectId] = useState(meeting?.projectId ?? '');
  const [status, setStatus] = useState<MeetingStatus>(meeting?.status ?? 'SCHEDULED');
  const [description, setDescription] = useState(meeting?.description ?? '');
  const [error, setError] = useState<string | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);

  const projectsQ = useQuery({ queryKey: ['projects'], queryFn: () => projectsApi(apiClient).list() });
  const projectOptions = [
    { value: '', label: 'No project (standalone)' },
    ...(Array.isArray(projectsQ.data) ? projectsQ.data : []).map((p) => ({ value: p.id, label: p.name, hint: p.code })),
  ];
  const statusOptions = (editing ? ALL_STATUS : CREATE_STATUS).map((s) => ({ value: s, label: MEETING_STATUS_LABELS[s] }));

  const saveMut = useMutation({
    mutationFn: () => {
      const startAt = fromLocalInputValue(start);
      if (!startAt) throw new Error('bad-start');
      const payload = {
        title: title.trim(),
        startAt,
        endAt: fromLocalInputValue(end),
        location: location.trim() || null,
        onlineLink: onlineLink.trim() || null,
        projectId: projectId || null,
        status,
        description: description.trim() || null,
      };
      return editing ? meetingsApi(apiClient).update(meeting!.id, payload) : meetingsApi(apiClient).create(payload);
    },
    onSuccess: (saved) => {
      qc.invalidateQueries({ queryKey: ['meetings'] });
      if (editing) qc.invalidateQueries({ queryKey: ['meeting', saved.id] });
      onSaved?.(saved.id);
      onClose();
    },
    onError: () => setError(editing ? 'Couldn’t save changes. Check the title and times.' : 'Couldn’t create the meeting. Check the title and times.'),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!title.trim()) {
      setError('A meeting title is required.');
      titleRef.current?.focus();
      return;
    }
    if (end && fromLocalInputValue(end)! < fromLocalInputValue(start)!) {
      setError('The end time can’t be before the start time.');
      return;
    }
    saveMut.mutate();
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-4">
      <div className="absolute inset-0 bg-ink/40 animate-fade-in" onClick={onClose} aria-hidden="true" />
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-label={editing ? 'Edit meeting' : 'New meeting'} className="card relative w-full max-w-lg animate-scale-in p-6">
        <h2 className="mb-4 font-display text-xl font-bold text-ink">{editing ? 'Edit meeting' : 'Schedule a meeting'}</h2>
        {error ? (
          <p role="alert" className="mb-3 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>
        ) : null}
        <form onSubmit={submit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <FieldLabel htmlFor="mf-title" required>Title</FieldLabel>
            <input id="mf-title" ref={titleRef} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Weekly project sync" className={fieldClass(false)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <FieldLabel htmlFor="mf-start" required>Starts</FieldLabel>
              <input id="mf-start" type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} className={fieldClass(false)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <FieldLabel htmlFor="mf-end">Ends</FieldLabel>
              <input id="mf-end" type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} className={fieldClass(false)} />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <FieldLabel>Project</FieldLabel>
            <SearchableSelect ariaLabel="Project" placeholder="No project (standalone)" options={projectOptions} value={projectId} onChange={setProjectId} />
            <p className="text-xs text-ink-2">Optional — leave blank for a standalone meeting.</p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <FieldLabel htmlFor="mf-loc">Location</FieldLabel>
              <input id="mf-loc" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Room 2 / Office" className={fieldClass(false)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <FieldLabel htmlFor="mf-link">Online link</FieldLabel>
              <input id="mf-link" value={onlineLink} onChange={(e) => setOnlineLink(e.target.value)} placeholder="https://…" className={fieldClass(false)} />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <FieldLabel>Status</FieldLabel>
            <SearchableSelect ariaLabel="Status" options={statusOptions} value={status} onChange={(v) => setStatus(v as MeetingStatus)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <FieldLabel htmlFor="mf-desc">Description</FieldLabel>
            <textarea id="mf-desc" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} placeholder="Optional agenda summary" className={fieldClass(false)} />
          </div>
          <Button type="submit" loading={saveMut.isPending}>
            {saveMut.isPending ? (editing ? 'Saving…' : 'Scheduling…') : editing ? 'Save changes' : 'Schedule meeting'}
          </Button>
          <button type="button" onClick={onClose} className="w-full rounded-lg py-2 text-sm font-medium text-ink-2 transition-colors hover:bg-ground">
            Cancel
          </button>
        </form>
      </div>
    </div>
  );
}
