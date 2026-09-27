import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../api/client';
import { meetingsApi, MEETING_STATUS_LABELS, type Meeting, type MeetingStatus } from '../api/meetings';
import { projectsApi } from '../api/projects';
import { ApiError } from '../lib/api-client';
import { fromLocalInputValue, nextHourInputValue, normalizeMeetingLink, toLocalInputValue } from '../lib/meetingFormat';
import { useCompanyTimeZone } from '../lib/useCompanyTimeZone';
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

/**
 * Create or edit a meeting. Project is optional — blank means a standalone meeting.
 * Start/end are entered and shown in the company time zone (not the device's), and the zone is
 * sent with the meeting so invitations, reminders and minutes print the right local time.
 */
export function MeetingFormModal({ meeting, onClose, onSaved }: MeetingFormModalProps) {
  const qc = useQueryClient();
  const dialogRef = useDialog(onClose);
  const timeZone = useCompanyTimeZone();
  const editing = !!meeting;
  const [title, setTitle] = useState(meeting?.title ?? '');
  const [start, setStart] = useState(() => (meeting ? toLocalInputValue(meeting.startAt, timeZone) : nextHourInputValue(timeZone)));
  const [end, setEnd] = useState(() => (meeting ? toLocalInputValue(meeting.endAt, timeZone) : ''));
  const [location, setLocation] = useState(meeting?.location ?? '');
  const [onlineLink, setOnlineLink] = useState(meeting?.onlineLink ?? '');
  const [projectId, setProjectId] = useState(meeting?.projectId ?? '');
  const [status, setStatus] = useState<MeetingStatus>(meeting?.status ?? 'SCHEDULED');
  const [description, setDescription] = useState(meeting?.description ?? '');
  const [error, setError] = useState<string | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const linkRef = useRef<HTMLInputElement>(null);

  // If the company zone arrives after the form opened (cold cache), re-show untouched times in it.
  const timesTouched = useRef(false);
  const zoneUsed = useRef(timeZone);
  useEffect(() => {
    if (zoneUsed.current === timeZone) return;
    zoneUsed.current = timeZone;
    if (timesTouched.current) return;
    setStart(meeting ? toLocalInputValue(meeting.startAt, timeZone) : nextHourInputValue(timeZone));
    setEnd(meeting ? toLocalInputValue(meeting.endAt, timeZone) : '');
  }, [timeZone, meeting]);

  const projectsQ = useQuery({ queryKey: ['projects'], queryFn: () => projectsApi(apiClient).list() });
  const projectOptions = [
    { value: '', label: 'No project (standalone)' },
    ...(Array.isArray(projectsQ.data) ? projectsQ.data : []).map((p) => ({ value: p.id, label: p.name, hint: p.code })),
  ];
  const statusOptions = (editing ? ALL_STATUS : CREATE_STATUS).map((s) => ({ value: s, label: MEETING_STATUS_LABELS[s] }));

  const saveMut = useMutation({
    mutationFn: () => {
      const startAt = fromLocalInputValue(start, timeZone);
      if (!startAt) throw new Error('bad-start');
      const link = normalizeMeetingLink(onlineLink);
      const payload = {
        title: title.trim(),
        startAt,
        endAt: fromLocalInputValue(end, timeZone),
        timeZone,
        location: location.trim() || null,
        onlineLink: link ?? null,
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
    onError: (err) => {
      if (err instanceof ApiError && err.status === 403) {
        setError(editing ? 'You don’t have permission to change this meeting.' : 'You don’t have access to that project.');
        return;
      }
      setError(editing ? 'Couldn’t save changes. Check the title, times and link.' : 'Couldn’t create the meeting. Check the title, times and link.');
    },
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLinkError(null);
    if (!title.trim()) {
      setError('A meeting title is required.');
      titleRef.current?.focus();
      return;
    }
    const startAt = fromLocalInputValue(start, timeZone);
    if (!startAt) {
      setError('Choose when the meeting starts.');
      return;
    }
    const endAt = fromLocalInputValue(end, timeZone);
    if (end && endAt && endAt < startAt) {
      setError('The end time can’t be before the start time.');
      return;
    }
    const link = normalizeMeetingLink(onlineLink);
    if (link === undefined) {
      setLinkError('Enter a web link that starts with https:// (for example https://meet.google.com/abc-defg-hij).');
      linkRef.current?.focus();
      return;
    }
    if (link && link !== onlineLink.trim()) setOnlineLink(link); // show what will be saved
    saveMut.mutate();
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-4">
      <div className="absolute inset-0 bg-ink/40 animate-fade-in" onClick={onClose} aria-hidden="true" />
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-label={editing ? 'Edit meeting' : 'New meeting'} className="card relative max-h-[92vh] w-full max-w-lg animate-scale-in overflow-y-auto p-6">
        <h2 className="mb-4 font-display text-xl font-bold text-ink">{editing ? 'Edit meeting' : 'Schedule a meeting'}</h2>
        {error ? (
          <p role="alert" className="mb-3 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>
        ) : null}
        <form onSubmit={submit} className="flex flex-col gap-3" noValidate>
          <div className="flex flex-col gap-1.5">
            <FieldLabel htmlFor="mf-title" required>Title</FieldLabel>
            <input id="mf-title" ref={titleRef} dir="auto" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Weekly project sync" className={fieldClass(false)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <FieldLabel htmlFor="mf-start" required>Starts</FieldLabel>
              <input
                id="mf-start"
                type="datetime-local"
                value={start}
                aria-describedby="mf-tz"
                onChange={(e) => { timesTouched.current = true; setStart(e.target.value); }}
                className={fieldClass(false)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <FieldLabel htmlFor="mf-end">Ends</FieldLabel>
              <input
                id="mf-end"
                type="datetime-local"
                value={end}
                aria-describedby="mf-tz"
                onChange={(e) => { timesTouched.current = true; setEnd(e.target.value); }}
                className={fieldClass(false)}
              />
            </div>
            <p id="mf-tz" className="col-span-2 -mt-1 text-xs text-ink-2">Times are in company time ({timeZone.replace(/_/g, ' ')}).</p>
          </div>
          <div className="flex flex-col gap-1.5">
            <FieldLabel>Project</FieldLabel>
            <SearchableSelect ariaLabel="Project" placeholder="No project (standalone)" options={projectOptions} value={projectId} onChange={setProjectId} />
            <p className="text-xs text-ink-2">Optional — leave blank for a standalone meeting.</p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <FieldLabel htmlFor="mf-loc">Location</FieldLabel>
              <input id="mf-loc" dir="auto" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Room 2 / Office" className={fieldClass(false)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <FieldLabel htmlFor="mf-link">Online link</FieldLabel>
              <input
                id="mf-link"
                ref={linkRef}
                type="url"
                inputMode="url"
                dir="ltr"
                value={onlineLink}
                aria-invalid={linkError ? true : undefined}
                aria-describedby={linkError ? 'mf-link-error' : undefined}
                onChange={(e) => { setOnlineLink(e.target.value); if (linkError) setLinkError(null); }}
                onBlur={() => { const n = normalizeMeetingLink(onlineLink); if (n && n !== onlineLink) setOnlineLink(n); }}
                placeholder="https://…"
                className={fieldClass(!!linkError)}
              />
            </div>
            {linkError ? <p id="mf-link-error" role="alert" className="col-span-2 -mt-1 text-xs font-medium text-danger">{linkError}</p> : null}
          </div>
          <div className="flex flex-col gap-1.5">
            <FieldLabel>Status</FieldLabel>
            <SearchableSelect ariaLabel="Status" options={statusOptions} value={status} onChange={(v) => setStatus(v as MeetingStatus)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <FieldLabel htmlFor="mf-desc">Description</FieldLabel>
            <textarea id="mf-desc" dir="auto" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} placeholder="Optional agenda summary" className={fieldClass(false)} />
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
