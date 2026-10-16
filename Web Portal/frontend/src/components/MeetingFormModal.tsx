import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../api/client';
import { meetingsApi, seriesIdOf, MEETING_STATUS_LABELS, type Meeting, type MeetingPatch, type MeetingStatus, type NewMeetingInput, type RecurrenceRule, type SeriesScope } from '../api/meetings';
import { projectsApi } from '../api/projects';
import { ApiError } from '../lib/api-client';
import { fromLocalInputValue, nextHourInputValue, normalizeMeetingLink, toLocalInputValue } from '../lib/meetingFormat';
import { firstMeetingDay, meetingRepeatText, repeatProblem } from '../lib/meeting-repeat';
import { dayLabel } from './calendar/calendar-ui';
import { recurrenceSummary } from '../lib/recurrence-summary';
import { useCompanyTimeZone } from '../lib/useCompanyTimeZone';
import { Button } from './ui/Button';
import { FieldLabel, fieldClass } from './ui/Field';
import { SearchableSelect } from './ui/SearchableSelect';
import { ConfirmDialog } from './ui/ConfirmDialog';
import { useDialog } from '../hooks/useDialog';
import { ModalPortal } from './ui/ModalPortal';
import { projectOption } from './project-option';
import { RecurrenceEditor, REPEAT_FREQUENCIES, REPEAT_LABEL, withFrequency } from './RecurrenceEditor';
import { SeriesScopeChoice } from './meeting/series-scope';

export interface MeetingFormModalProps {
  /** When provided, the modal edits this meeting; otherwise it creates a new one. */
  meeting?: Meeting;
  /** A new meeting's project (e.g. scheduled from the project's dashboard). */
  defaultProjectId?: string;
  onClose: () => void;
  onSaved?: (id: string) => void;
}

const CREATE_STATUS: MeetingStatus[] = ['DRAFT', 'SCHEDULED', 'IN_PROGRESS'];
const ALL_STATUS: MeetingStatus[] = ['DRAFT', 'SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'];
const REPEAT_OPTIONS = [{ value: 'NONE', label: 'Does not repeat' }, ...REPEAT_FREQUENCIES.map((f) => ({ value: f, label: REPEAT_LABEL[f] }))];
const sameRule = (a: RecurrenceRule | null, b: RecurrenceRule | null) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

const RepeatIcon = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="mt-0.5 flex-none text-brand">
    <path d="M17 2l4 4-4 4" /><path d="M3 11V9a3 3 0 0 1 3-3h15" /><path d="M7 22l-4-4 4-4" /><path d="M21 13v2a3 3 0 0 1-3 3H3" />
  </svg>
);

/**
 * Create or edit a meeting. Project is optional — blank means a standalone meeting.
 * Start/end are entered and shown in the company time zone (not the device's), and the zone is
 * sent with the meeting so invitations, reminders and minutes print the right local time.
 * A meeting can repeat (daily, weekly on chosen days, monthly…, ending never, after a number of
 * meetings or on a date); editing a meeting of a series asks whether the change is for this
 * meeting only or for all its upcoming meetings.
 */
export function MeetingFormModal({ meeting, defaultProjectId, onClose, onSaved }: MeetingFormModalProps) {
  const qc = useQueryClient();
  const dialogRef = useDialog(onClose);
  const timeZone = useCompanyTimeZone();
  const editing = !!meeting;
  const seriesId = meeting ? seriesIdOf(meeting) : null;
  // The meeting as the form opened it: a series change sends only what was changed from this, even
  // if someone else changes the meeting (and the page refreshes it) while the form is open.
  const [opened] = useState(meeting);
  const [title, setTitle] = useState(meeting?.title ?? '');
  const [start, setStart] = useState(() => (meeting ? toLocalInputValue(meeting.startAt, timeZone) : nextHourInputValue(timeZone)));
  const [end, setEnd] = useState(() => (meeting ? toLocalInputValue(meeting.endAt, timeZone) : ''));
  const [location, setLocation] = useState(meeting?.location ?? '');
  const [onlineLink, setOnlineLink] = useState(meeting?.onlineLink ?? '');
  const [projectId, setProjectId] = useState(meeting?.projectId ?? defaultProjectId ?? '');
  const [status, setStatus] = useState<MeetingStatus>(meeting?.status ?? 'SCHEDULED');
  const [description, setDescription] = useState(meeting?.description ?? '');
  const [error, setError] = useState<string | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const linkRef = useRef<HTMLInputElement>(null);

  // A later meeting of a series doesn't carry the rule — its own record names the series'.
  const ownQ = useQuery({
    queryKey: ['meeting', meeting?.id],
    queryFn: () => meetingsApi(apiClient).get(meeting!.id),
    enabled: !!seriesId && !meeting?.series && !meeting?.recurrenceRule,
  });
  const seriesRule: RecurrenceRule | null = meeting?.series?.rule ?? meeting?.recurrenceRule ?? ownQ.data?.series?.rule ?? null;
  const [rule, setRule] = useState<RecurrenceRule | null>(seriesRule);
  const ruleTouched = useRef(false);
  const seriesKey = JSON.stringify(seriesRule);
  useEffect(() => {
    if (!ruleTouched.current) setRule(seriesRule);
    // The series' rule arrived (or changed) while the repeat was untouched.
  }, [seriesKey]);
  const changeRule = (next: RecurrenceRule | null) => {
    ruleTouched.current = true;
    setRule(next);
  };
  const ruleChanged = !sameRule(rule, seriesRule);
  const [askScope, setAskScope] = useState(false);
  const [scope, setScope] = useState<SeriesScope>('one');

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
    ...(Array.isArray(projectsQ.data) ? projectsQ.data : []).map(projectOption),
  ];
  const statusOptions = (editing ? ALL_STATUS : CREATE_STATUS).map((s) => ({ value: s, label: MEETING_STATUS_LABELS[s] }));

  const startDay = start.slice(0, 10);
  const startIso = fromLocalInputValue(start, timeZone);
  // The end date is checked for a new repeat; a meeting of a series moved on its own keeps the series'.
  const untilProblem = !seriesId || ruleChanged ? repeatProblem(rule, startDay) : null;
  // A new series starts on one of the repeat's days: say so when the chosen day isn't one.
  const firstDay = rule && !seriesId ? firstMeetingDay(startDay, rule) : startDay;
  const summary = rule ? (startIso ? meetingRepeatText(rule, startIso, timeZone) : recurrenceSummary(rule)) : '';

  const saveMut = useMutation({
    mutationFn: (as: SeriesScope) => {
      const startAt = fromLocalInputValue(start, timeZone);
      if (!startAt) throw new Error('bad-start');
      const link = normalizeMeetingLink(onlineLink);
      const payload: NewMeetingInput = {
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
      if (editing && seriesId && as === 'series') {
        // The series' upcoming meetings get only what was changed here, so a meeting changed on its
        // own (another room, say) keeps its other details.
        const was = opened!;
        const same = (a: string | null | undefined, b: string | null | undefined) => (a ?? '').trim() === (b ?? '').trim();
        const changes: MeetingPatch = {};
        if (!same(payload.title, was.title)) changes.title = payload.title;
        if (start !== toLocalInputValue(was.startAt, timeZone) || end !== toLocalInputValue(was.endAt, timeZone)) {
          Object.assign(changes, { startAt: payload.startAt, endAt: payload.endAt, timeZone });
        }
        if (!same(payload.location, was.location)) changes.location = payload.location;
        if (!same(payload.onlineLink, was.onlineLink)) changes.onlineLink = payload.onlineLink;
        if ((payload.projectId ?? null) !== (was.projectId ?? null)) changes.projectId = payload.projectId;
        if (status !== was.status) changes.status = status;
        if (!same(payload.description, was.description)) changes.description = payload.description;
        if (ruleChanged) changes.recurrenceRule = rule;
        // Nothing changed: nothing to send (and nobody to email).
        if (Object.keys(changes).length === 0) return Promise.resolve(was);
        return meetingsApi(apiClient).update(was.id, changes, 'series');
      }
      // A new meeting or a one-off given a repeat takes the rule; one meeting of a series keeps the series' repeat.
      if (!seriesId && rule) payload.recurrenceRule = rule;
      return editing ? meetingsApi(apiClient).update(meeting!.id, payload, 'one') : meetingsApi(apiClient).create(payload);
    },
    onSuccess: (saved) => {
      void qc.invalidateQueries({ queryKey: ['meetings'] });
      void qc.invalidateQueries({ queryKey: ['meeting'] });
      if (editing) void qc.invalidateQueries({ queryKey: ['meeting', saved.id] });
      onSaved?.(saved.id);
      onClose();
    },
    onError: (err) => {
      setAskScope(false);
      if (err instanceof ApiError && err.status === 403) {
        setError(editing ? 'You don’t have permission to change this meeting.' : 'You don’t have access to that project.');
        return;
      }
      if (err instanceof ApiError && err.status === 400 && err.message && !/^Request failed/.test(err.message)) {
        setError(err.message);
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
    if (end && endAt && endAt <= startAt) {
      setError(endAt < startAt ? 'The end time can’t be before the start time.' : 'The end time must be after the start time.');
      return;
    }
    const link = normalizeMeetingLink(onlineLink);
    if (link === undefined) {
      setLinkError('Enter a web link that starts with https:// (for example https://meet.google.com/abc-defg-hij).');
      linkRef.current?.focus();
      return;
    }
    if (untilProblem) {
      setError('Check the repeat schedule below.');
      return;
    }
    if (link && link !== onlineLink.trim()) setOnlineLink(link); // show what will be saved
    if (editing && seriesId) {
      setScope(ruleChanged ? 'series' : 'one');
      setAskScope(true);
      return;
    }
    saveMut.mutate('one');
  }

  return (
    <ModalPortal>
      <div className="above-keyboard fixed inset-0 z-50 grid place-items-center p-4">
        <div className="absolute inset-0 bg-ink/40 animate-fade-in" onClick={onClose} aria-hidden="true" />
        <div ref={dialogRef} role="dialog" aria-modal="true" aria-label={editing ? 'Edit meeting' : 'New meeting'} className="keyboard-flow-cramped card relative flex max-h-[calc(var(--visible-height)-2rem)] w-full max-w-lg animate-scale-in flex-col overflow-hidden">
          {/* The fields scroll; the buttons stay in view — above a phone's keyboard, too. */}
          <form onSubmit={submit} className="keyboard-flow-body flex min-h-0 flex-1 flex-col" noValidate>
            <div className="keyboard-flow-body flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-6">
              <h2 className="mb-1 font-display text-xl font-bold text-ink">{editing ? 'Edit meeting' : 'Schedule a meeting'}</h2>
              {error ? (
                <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>
              ) : null}
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
                <FieldLabel>Repeat</FieldLabel>
                <SearchableSelect
                  ariaLabel="Repeat"
                  options={REPEAT_OPTIONS}
                  value={rule?.freq ?? 'NONE'}
                  // Picking the same repeat again keeps its days.
                  onChange={(v) => {
                    if (v !== (rule?.freq ?? 'NONE')) changeRule(withFrequency(rule, v));
                  }}
                />
                {seriesId ? <p className="text-xs text-ink-2">This meeting is part of a repeating series.</p> : null}
              </div>
              {rule ? (
                <fieldset role="group" aria-label="Repeat schedule" className="rounded-2xl border border-line bg-ground/50 p-3.5">
                  <p className="mb-3 flex items-start gap-2 text-sm font-semibold text-ink">
                    <RepeatIcon />
                    <span>{summary}</span>
                  </p>
                  <RecurrenceEditor hideFrequency kind="meeting" value={rule} onChange={changeRule} dueDate={startDay || null} />
                  {untilProblem ? <p role="alert" className="mt-2 text-xs font-medium text-danger">{untilProblem}</p> : null}
                  {firstDay !== startDay ? (
                    <p className="mt-2 text-xs font-medium text-ink">
                      The first meeting will be on {dayLabel(firstDay)}, the first day this repeat gives.
                    </p>
                  ) : null}
                  <p className="mt-2 text-xs text-ink-2">
                    {seriesId ? 'A new repeat applies to all upcoming meetings of the series.' : 'Each meeting is created for the next three months, and more follow as time goes on.'}
                  </p>
                </fieldset>
              ) : null}
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
            </div>
            <div className="flex flex-none items-center gap-2 border-t border-line px-6 py-3">
              <button type="button" onClick={onClose} className="!min-h-[44px] flex-1 rounded-xl border border-line px-4 text-sm font-semibold text-ink transition-colors hover:bg-ground disabled:opacity-50">
                Cancel
              </button>
              <Button type="submit" loading={saveMut.isPending} className="!min-h-[44px] flex-[2]">
                {saveMut.isPending ? (editing ? 'Saving…' : 'Scheduling…') : editing ? 'Save changes' : 'Schedule meeting'}
              </Button>
            </div>
          </form>
        </div>
      </div>
      {askScope ? (
        <ConfirmDialog
          title="Save changes to a repeating meeting?"
          confirmLabel="Save"
          keepLabel="Go back"
          tone="primary"
          busy={saveMut.isPending}
          onConfirm={() => saveMut.mutate(scope)}
          onClose={() => setAskScope(false)}
        >
          <SeriesScopeChoice
            value={scope}
            onChange={setScope}
            oneDisabled={ruleChanged ? 'A new repeat changes the whole series.' : null}
            one={{ label: 'This meeting only', hint: 'The other meetings of the series stay as they are.' }}
            series={{ label: 'All upcoming meetings in the series', hint: 'Meetings already held stay as they were.' }}
          />
        </ConfirmDialog>
      ) : null}
    </ModalPortal>
  );
}
