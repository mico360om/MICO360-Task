import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../api/client';
import { meetingsApi, seriesIdOf, MEETING_STATUS_LABELS, type Meeting, type MeetingPatch, type MeetingStatus, type NewMeetingInput, type RecurrenceRule, type SeriesScope } from '../api/meetings';
import { useProjectsWith } from '../lib/useProjectsWith';
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
import { dialogLayer, dialogPanel, useTwoColumns } from './ui/dialog-size';
import { projectOption } from './project-option';
import { RecurrenceEditor, REPEAT_FREQUENCIES, REPEAT_LABEL, withFrequency } from './RecurrenceEditor';
import { SeriesScopeChoice } from './meeting/series-scope';
import { PeopleField, type MeetingPerson } from './meeting-form/PeopleField';
import { AgendaField, newAgendaKey, type AgendaDraft } from './meeting-form/AgendaField';
import { FreeTimes } from './meeting-form/FreeTimes';
import { DescribeMeeting, type DescribedMeetingPatch } from './meeting-form/DescribeMeeting';
import { WriteDescription } from './meeting-form/WriteDescription';
import { aiApi } from '../api/ai';
import { todayKey } from '../lib/due-date';
import { usersApi } from '../api/users';
import { useAuthStore } from '../stores/auth-store';
import { useMyCompanies } from '../hooks/useMyCompanies';
import { COMPANY_GONE_CODE } from '../lib/companies';
import { DateTimeField } from './ui/DateTimeField';
import { useDateSettings } from '../lib/useDatePrefs';
import { TeamsLinkField } from './meeting-form/TeamsLinkField';
import { TeamsSaveProblem } from './meeting-form/TeamsSaveProblem';
import { useMicrosoftTeams } from '../lib/useMicrosoftTeams';
import type { TeamsNotice } from '../api/microsoft';

export interface MeetingFormModalProps {
  /** When provided, the modal edits this meeting; otherwise it creates a new one. */
  meeting?: Meeting;
  /** A new meeting's project (e.g. scheduled from the project's dashboard). */
  defaultProjectId?: string;
  /** 1.23: a new meeting starts with "Create a Teams link" ticked (e.g. the next meeting of a series whose link Teams made). */
  defaultTeamsLink?: boolean;
  onClose: () => void;
  onSaved?: (id: string) => void;
}

const CREATE_STATUS: MeetingStatus[] = ['DRAFT', 'SCHEDULED', 'IN_PROGRESS'];
const ALL_STATUS: MeetingStatus[] = ['DRAFT', 'SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'];
const REPEAT_OPTIONS = [{ value: 'NONE', label: 'Does not repeat' }, ...REPEAT_FREQUENCIES.map((f) => ({ value: f, label: REPEAT_LABEL[f] }))];
const sameRule = (a: RecurrenceRule | null, b: RecurrenceRule | null) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
/** Describe's "not yours" baseline: every field empty. */
const UNSET = { title: '', description: '', start: '', end: '', rule: null, projectId: '', location: '', onlineLink: '' };

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
export function MeetingFormModal({ meeting, defaultProjectId, defaultTeamsLink = false, onClose, onSaved }: MeetingFormModalProps) {
  const qc = useQueryClient();
  const dialogRef = useDialog(onClose);
  const timeZone = useCompanyTimeZone();
  // The calendar's week starts on the person's (or company's) week start; today in company time.
  const { weekStart } = useDateSettings();
  const today = todayKey(timeZone);
  const twoColumns = useTwoColumns();
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
  // 1.23 "Create a Teams link": ticked for a meeting whose link Teams made (or is to make).
  const hadTeams = meeting?.onlineMeetingProvider === 'TEAMS';
  const teamsPending = hadTeams && meeting?.teamsLinkPending === true;
  const [teamsLink, setTeamsLink] = useState(editing ? hadTeams : defaultTeamsLink);
  const { available: teamsAvailable, status: teamsStatus } = useMicrosoftTeams();
  // Saved, but Teams couldn't make the link: the notice and Make Teams link take the form's place.
  const [teamsProblem, setTeamsProblem] = useState<{ id: string; notice: TeamsNotice } | null>(null);
  const changeTeamsLink = (on: boolean) => {
    setTeamsLink(on);
    if (linkError) setLinkError(null);
    // Taking a Teams link away leaves the field empty (a link of your own can be pasted); ticking
    // again brings the meeting's own Teams link back.
    if (hadTeams) setOnlineLink(on ? (meeting?.onlineLink ?? '') : '');
  };
  const [projectId, setProjectId] = useState(meeting?.projectId ?? defaultProjectId ?? '');
  const [status, setStatus] = useState<MeetingStatus>(meeting?.status ?? 'SCHEDULED');
  const [description, setDescription] = useState(meeting?.description ?? '');
  // A new meeting's people and agenda (an existing meeting's are on its page).
  const [people, setPeople] = useState<MeetingPerson[]>([]);
  const [agenda, setAgenda] = useState<AgendaDraft[]>([]);
  const organizerId = useAuthStore((s) => s.user?.id ?? null);
  // 1.23: the tick counts only where a Teams link can be had — the meeting has one (or waits for it), or I
  // organize it and my Microsoft account is connected (a pre-ticked form for someone not connected stays a
  // plain form, its Online link usable).
  const organizerIsMe = !editing || meeting?.organizerId === organizerId;
  const teamsOn = teamsAvailable && teamsLink && (hadTeams || (organizerIsMe && teamsStatus?.connected === true));
  // The last sentence given to "Describe the meeting": Draft agenda and Write description use it too.
  const [sentence, setSentence] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const linkRef = useRef<HTMLInputElement>(null);
  // companies: a meeting without a project belongs to one of my companies — the picked one, else my
  // primary one (a meeting's own when editing). The field shows with two or more to choose from.
  const myCompanies = useMyCompanies();
  const [companyChoice, setCompanyChoice] = useState<string | null>(null);
  const companyId = companyChoice ?? (editing ? (meeting?.companyId ?? null) : (myCompanies.effective?.id ?? null));
  const companyOptions = [...myCompanies.companies].sort((a, b) => a.name.localeCompare(b.name, 'en'));
  // (A meeting kept in a company that isn't one of mine stays there: no field to move it.)
  const showCompany = !projectId && companyOptions.length >= 2 && (companyId === null || companyOptions.some((c) => c.id === companyId));
  // What the meeting's people and its free times are worked out for: its project, else its company.
  const target = projectId ? { projectId, companyId: null } : { projectId: null, companyId };

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

  // (1.22: also the meeting's own project when an administrator's "Show my projects only" leaves it off the list.)
  const { projects: projectList } = useProjectsWith(meeting?.projectId ?? defaultProjectId);
  const projectOptions = [
    { value: '', label: 'No project (standalone)' },
    ...projectList.map(projectOption),
  ];
  const statusOptions = (editing ? ALL_STATUS : CREATE_STATUS).map((s) => ({ value: s, label: MEETING_STATUS_LABELS[s] }));

  const startDay = start.slice(0, 10);
  const startIso = fromLocalInputValue(start, timeZone);
  // A new series starts on one of the repeat's days: say so when the chosen day isn't one.
  const firstDay = rule && !seriesId ? firstMeetingDay(startDay, rule) : startDay;
  // The end date is checked for a new repeat — against the day the first meeting will really be
  // on; a meeting of a series moved on its own keeps the series'.
  const untilProblem = !seriesId || ruleChanged ? repeatProblem(rule, rule ? firstMeetingDay(startDay, rule) : startDay) : null;
  const summary = rule ? (startIso ? meetingRepeatText(rule, startIso, timeZone) : recurrenceSummary(rule)) : '';

  // The meeting's length (an hour when no end is set), and who may lead an agenda item: the
  // organizer and the team members invited.
  const endIso = fromLocalInputValue(end, timeZone);
  const lengthMinutes = startIso && endIso && endIso > startIso ? Math.round((Date.parse(endIso) - Date.parse(startIso)) / 60_000) : 60;
  const dirQ = useQuery({ queryKey: ['directory'], queryFn: () => usersApi(apiClient).directory(), enabled: !editing });
  const me = (Array.isArray(dirQ.data) ? dirQ.data : []).find((u) => u.id === organizerId);
  const leads = [
    ...(organizerId ? [{ id: organizerId, name: me ? `${`${me.firstName} ${me.lastName}`.trim() || me.username} (you)` : 'You' }] : []),
    ...people.flatMap((p) => (p.kind === 'user' ? [{ id: p.id, name: p.name }] : [])),
  ];
  // Free times are checked for the organizer and the invited team members (an existing meeting's
  // are on its page).
  const attendeesQ = useQuery({ queryKey: ['meeting', meeting?.id, 'attendees'], queryFn: () => meetingsApi(apiClient).listAttendees(meeting!.id), enabled: editing });
  const freeTimeUsers = editing
    ? [meeting!.organizerId, ...(Array.isArray(attendeesQ.data) ? attendeesQ.data : []).flatMap((a) => (a.userId ? [a.userId] : []))]
    : leads.map((l) => l.id);
  /** A suggested time: the start moves there and an end set keeps the meeting's length. */
  const pickTime = (iso: string) => {
    timesTouched.current = true;
    setStart(toLocalInputValue(iso, timeZone));
    if (end && endIso && startIso) setEnd(toLocalInputValue(new Date(Date.parse(iso) + (Date.parse(endIso) - Date.parse(startIso))).toISOString(), timeZone));
  };
  const changePeople = (next: MeetingPerson[]) => {
    setPeople(next);
    // Someone taken off the list no longer leads their agenda items.
    const still = new Set([organizerId, ...next.flatMap((p) => (p.kind === 'user' ? [p.id] : []))]);
    setAgenda((items) => items.map((i) => (i.ownerId && !still.has(i.ownerId) ? { ...i, ownerId: null } : i)));
  };

  const repeatText = (r: RecurrenceRule, from: string | null) => (from ? meetingRepeatText(r, from, timeZone) : recurrenceSummary(r));
  /** "Use selected details": the ticked suggestions go into the form (people and agenda points are added). */
  function applyDescribed(patch: DescribedMeetingPatch) {
    if (patch.title !== undefined) setTitle(patch.title);
    if (patch.description !== undefined) setDescription(patch.description);
    if (patch.location !== undefined) setLocation(patch.location);
    if (patch.onlineLink !== undefined) setOnlineLink(patch.onlineLink);
    if (patch.projectId !== undefined) setProjectId(patch.projectId);
    if (patch.rule !== undefined) changeRule(patch.rule);
    if (patch.start !== undefined || patch.minutes !== undefined) {
      timesTouched.current = true;
      const nextStart = patch.start ?? start;
      setStart(nextStart);
      // A length given sets the end; otherwise an end already set keeps the meeting's length.
      const keep = startIso && endIso ? (Date.parse(endIso) - Date.parse(startIso)) / 60_000 : null;
      const length = patch.minutes ?? keep;
      const from = fromLocalInputValue(nextStart, timeZone);
      if (length && from) setEnd(toLocalInputValue(new Date(Date.parse(from) + length * 60_000).toISOString(), timeZone));
    }
    if (patch.people?.length) changePeople([...people, ...patch.people]);
    if (patch.agenda?.length) setAgenda((items) => [...items, ...patch.agenda!.map((t) => ({ key: newAgendaKey(), title: t, ownerId: null, minutes: null }))]);
  }
  const openProjects = projectList.map((p) => ({ id: p.id, name: p.name, code: p.code, number: p.number ?? null }));

  const saveMut = useMutation({
    mutationFn: (as: SeriesScope) => {
      const startAt = fromLocalInputValue(start, timeZone);
      if (!startAt) throw new Error('bad-start');
      // 1.23: with "Create a Teams link" the Teams link fills Online link (the meeting's own, once made).
      const link = teamsOn ? (hadTeams ? (meeting?.onlineLink ?? null) : null) : normalizeMeetingLink(onlineLink);
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
        ...(showCompany && companyId ? { companyId } : {}),
        // Sent only where Teams links are set up, and only when it matters (made, kept, or taken away).
        ...(teamsAvailable && (teamsOn || hadTeams) ? { teamsLink: teamsOn } : {}),
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
        if (payload.companyId && payload.companyId !== (was.companyId ?? null)) changes.companyId = payload.companyId;
        if (status !== was.status) changes.status = status;
        if (!same(payload.description, was.description)) changes.description = payload.description;
        if (ruleChanged) changes.recurrenceRule = rule;
        // 1.23: a Teams link made (or tried again) or taken away.
        if (payload.teamsLink !== undefined && (payload.teamsLink !== hadTeams || (payload.teamsLink && teamsPending))) changes.teamsLink = payload.teamsLink;
        // Nothing changed: nothing to send (and nobody to email).
        if (Object.keys(changes).length === 0) return Promise.resolve(was);
        return meetingsApi(apiClient).update(was.id, changes, 'series');
      }
      // A new meeting or a one-off given a repeat takes the rule; one meeting of a series keeps the series' repeat.
      if (!seriesId && rule) payload.recurrenceRule = rule;
      if (!editing) {
        // Saved with the meeting in the same request, so nothing is half-created.
        if (people.length) payload.attendees = people.map((p) => (p.kind === 'user' ? { userId: p.id } : { externalEmail: p.email, externalName: p.name }));
        const items = agenda.filter((i) => i.title.trim());
        if (items.length) payload.agendaItems = items.map((i) => ({ title: i.title.trim(), ownerId: i.ownerId, expectedMinutes: i.minutes }));
      }
      return editing ? meetingsApi(apiClient).update(meeting!.id, payload, 'one') : meetingsApi(apiClient).create(payload);
    },
    onSuccess: (saved) => {
      void qc.invalidateQueries({ queryKey: ['meetings'] });
      void qc.invalidateQueries({ queryKey: ['meeting'] });
      if (editing) void qc.invalidateQueries({ queryKey: ['meeting', saved.id] });
      // 1.23: saved, but its Teams link couldn't be made — say so, with Make Teams link (Done goes on).
      const notice = (saved as Meeting).teamsNotice;
      if (notice) {
        setAskScope(false);
        setTeamsProblem({ id: saved.id, notice });
        return;
      }
      onSaved?.(saved.id);
      onClose();
    },
    onError: (err) => {
      setAskScope(false);
      // companies: a company of mine no longer (the server's words; the picker's pick stays as it is).
      if (err instanceof ApiError && err.code === COMPANY_GONE_CODE && err.message) {
        setError(err.message);
        return;
      }
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
    // (With "Create a Teams link" ticked, Teams fills the link: nothing typed to check.)
    const link = teamsOn ? null : normalizeMeetingLink(onlineLink);
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

  const describeField = (
              <DescribeMeeting
                onParse={(text) => {
                  setSentence(text);
                  return aiApi(apiClient).parseMeeting(text, todayKey(timeZone));
                }}
                current={{ title, description, start, end, rule, projectId, location, onlineLink }}
                // Untouched times aren't the person's own (the start is the next whole hour).
                // What isn't the person's own, so a suggestion may start ticked over it: nothing in
                // an existing meeting (its saved details are theirs), nor a project the page chose;
                // only a new meeting's untouched times (the next whole hour).
                initial={{ ...UNSET, ...(editing || timesTouched.current ? {} : { start, end }) }}
                onApply={applyDescribed}
                withPeopleAndAgenda={!editing}
                projects={openProjects}
                people={people}
                repeatText={repeatText}
              />
  );
  const titleField = (
              <div className="flex flex-col gap-1.5">
                <FieldLabel htmlFor="mf-title" required>Title</FieldLabel>
                <input id="mf-title" ref={titleRef} dir="auto" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Weekly project sync" className={fieldClass(false)} />
              </div>
  );
  // The day and time as the site writes them ("Wed 4 Nov 2026" · "13:00", 24-hour), not the browser's box.
  const whenFields = (
              /* Side by side from sm up; on a phone each date-time takes the row, so its time shows in full.
                 In the two-column dialog the details column is narrower: one each per row there too. */
              <div className={twoColumns ? 'grid gap-3' : 'grid gap-3 sm:grid-cols-2'}>
                <div className="flex min-w-0 flex-col gap-1.5">
                  <FieldLabel id="mf-start-label" required>Starts</FieldLabel>
                  <DateTimeField
                    label="Starts"
                    labelId="mf-start-label"
                    value={start}
                    describedBy="mf-tz"
                    today={today}
                    weekStart={weekStart}
                    onChange={(v) => { timesTouched.current = true; setStart(v); }}
                  />
                </div>
                <div className="flex min-w-0 flex-col gap-1.5">
                  <FieldLabel id="mf-end-label">Ends</FieldLabel>
                  <DateTimeField
                    label="Ends"
                    labelId="mf-end-label"
                    value={end}
                    describedBy="mf-tz"
                    today={today}
                    weekStart={weekStart}
                    clearable
                    // An end set from nothing starts an hour after the start.
                    fill={startIso ? toLocalInputValue(new Date(Date.parse(startIso) + 60 * 60_000).toISOString(), timeZone) : undefined}
                    onChange={(v) => { timesTouched.current = true; setEnd(v); }}
                  />
                </div>
                {/* (Spanning two columns would make a second column in the stacked layout.) */}
                <p id="mf-tz" className={`-mt-1 text-xs text-ink-2 ${twoColumns ? '' : 'sm:col-span-2'}`}>Times are in company time ({timeZone.replace(/_/g, ' ')}).</p>
              </div>
  );
  const freeTimesField = (
              <FreeTimes userIds={freeTimeUsers} startAt={startIso} minutes={lengthMinutes} rule={seriesId ? null : rule} excludeMeetingId={meeting?.id} projectId={target.projectId} companyId={target.companyId} onPick={pickTime} />
  );
  const repeatFields = (
    <>
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
    </>
  );
  const projectFields = (
    <>
              <div className="flex flex-col gap-1.5">
                <FieldLabel>Project</FieldLabel>
                <SearchableSelect ariaLabel="Project" placeholder="No project (standalone)" options={projectOptions} value={projectId} onChange={setProjectId} />
                <p className="text-xs text-ink-2">Optional — leave blank for a standalone meeting.</p>
              </div>
              {showCompany ? (
                <div className="flex flex-col gap-1.5">
                  <FieldLabel>Company</FieldLabel>
                  {/* The same select as Project, Repeat and Status. */}
                  <SearchableSelect
                    ariaLabel="Company"
                    placeholder="Choose a company"
                    options={companyOptions.map((c) => ({ value: c.id, label: c.name }))}
                    value={companyId ?? ''}
                    onChange={(v) => setCompanyChoice(v || null)}
                    describedBy="mf-company-help"
                  />
                  <p id="mf-company-help" className="text-xs text-ink-2">A meeting without a project belongs to one of your companies.</p>
                </div>
              ) : null}
    </>
  );
  const placeFields = (
              <div className="grid gap-3 sm:grid-cols-2">
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
                    // 1.23: with "Create a Teams link" ticked, Teams fills this in (the meeting's own link once made).
                    value={teamsOn ? (hadTeams ? (meeting?.onlineLink ?? '') : '') : onlineLink}
                    disabled={teamsOn}
                    aria-invalid={linkError ? true : undefined}
                    aria-describedby={linkError ? 'mf-link-error' : undefined}
                    onChange={(e) => { setOnlineLink(e.target.value); if (linkError) setLinkError(null); }}
                    onBlur={() => { const n = normalizeMeetingLink(onlineLink); if (n && n !== onlineLink) setOnlineLink(n); }}
                    placeholder={teamsOn ? 'The Teams link goes here' : 'https://…'}
                    className={`${fieldClass(!!linkError)} disabled:cursor-not-allowed disabled:opacity-70`}
                  />
                </div>
                {linkError ? <p id="mf-link-error" role="alert" className="-mt-1 text-xs font-medium text-danger sm:col-span-2">{linkError}</p> : null}
                <TeamsLinkField
                  checked={teamsLink}
                  onChange={changeTeamsLink}
                  organizerIsMe={organizerIsMe}
                  hadTeams={hadTeams}
                  pending={teamsPending}
                  repeating={!!rule || !!seriesId}
                />
              </div>
  );
  const statusField = (
              <div className="flex flex-col gap-1.5">
                <FieldLabel>Status</FieldLabel>
                <SearchableSelect ariaLabel="Status" options={statusOptions} value={status} onChange={(v) => setStatus(v as MeetingStatus)} />
              </div>
  );
  const descriptionField = (
              <div className="flex flex-col gap-1.5">
                <FieldLabel htmlFor="mf-desc">Description</FieldLabel>
                <textarea id="mf-desc" dir="auto" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} placeholder="Optional agenda summary" className={fieldClass(false)} />
                <WriteDescription
                  current={description}
                  disabled={!title.trim()}
                  onUse={setDescription}
                  onWrite={() =>
                    aiApi(apiClient).writeMeetingDescription({
                      title: title.trim(),
                      ...(agenda.some((i) => i.title.trim()) ? { agenda: agenda.map((i) => i.title.trim()).filter(Boolean).slice(0, 30) } : {}),
                      ...(sentence.trim() ? { text: sentence.trim() } : {}),
                    })
                  }
                />
              </div>
  );
  // A new meeting's people and agenda (an existing meeting's are on its page).
  const peopleFields = !editing ? (
                <>
                  <PeopleField value={people} onChange={changePeople} organizerId={organizerId} target={target} />
                  <AgendaField
                    value={agenda}
                    onChange={setAgenda}
                    leads={leads}
                    minutes={lengthMinutes}
                    draftHint={!title.trim() ? 'Add a title first.' : !startIso ? 'Choose when it starts first.' : null}
                    onDraft={() =>
                      aiApi(apiClient).draftAgenda({
                        title: title.trim(),
                        ...(description.trim() ? { description: description.trim() } : {}),
                        ...(sentence.trim() ? { text: sentence.trim() } : {}),
                        projectId: projectId || null,
                        startAt: startIso!,
                        minutes: Math.min(720, Math.max(5, lengthMinutes)),
                        peopleIds: leads.map((l) => l.id),
                      })
                    }
                  />
                </>
  ) : null;

  return (
    <ModalPortal>
      <div className={dialogLayer('wide')}>
        <div className="absolute inset-0 bg-scrim animate-fade-in" onClick={onClose} aria-hidden="true" />
        {/* A big form on the shared scale: 720px on a tablet, 960px (two columns) from 1024px, full screen on a phone. */}
        <div ref={dialogRef} role="dialog" aria-modal="true" aria-label={editing ? 'Edit meeting' : 'New meeting'} className={`keyboard-flow-cramped card relative flex ${dialogPanel('wide')} animate-scale-in flex-col overflow-hidden`}>
          {/* 1.23: saved, but Teams couldn't make its link — the notice and Make Teams link (never the form again). */}
          {teamsProblem ? (
            <TeamsSaveProblem
              meetingId={teamsProblem.id}
              notice={teamsProblem.notice}
              onDone={() => {
                onSaved?.(teamsProblem.id);
                onClose();
              }}
            />
          ) : (
          /* The fields scroll; the buttons stay in view — above a phone's keyboard, too. */
          <form onSubmit={submit} className="keyboard-flow-body flex min-h-0 flex-1 flex-col" noValidate>
            <div className="keyboard-flow-body flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4 sm:p-6">
              <h2 className="mb-1 font-display text-xl font-bold text-ink">{editing ? 'Edit meeting' : 'Schedule a meeting'}</h2>
              {error ? (
                <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>
              ) : null}
              {twoColumns ? (
                // From 1024px: the meeting's details on the left; the helpers (Describe, Free times) and its
                // people and agenda on the right. Each column in reading order (the DOM's, not CSS order).
                <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] items-start gap-6">
                  <div data-form-column="details" className="flex min-w-0 flex-col gap-3">
                    {titleField}
                    {whenFields}
                    {repeatFields}
                    {projectFields}
                    {placeFields}
                    {statusField}
                    {descriptionField}
                  </div>
                  <div data-form-column="helpers" className="flex min-w-0 flex-col gap-3">
                    {describeField}
                    {freeTimesField}
                    {peopleFields}
                  </div>
                </div>
              ) : (
                <>
                  {describeField}
                  {titleField}
                  {whenFields}
                  {freeTimesField}
                  {repeatFields}
                  {projectFields}
                  {placeFields}
                  {statusField}
                  {descriptionField}
                  {peopleFields}
                </>
              )}
            </div>
            <div className="flex flex-none items-center gap-2 border-t border-line px-4 py-3 sm:px-6">
              <button type="button" title="Cancel (Esc)" aria-keyshortcuts="Escape" onClick={onClose} className="!min-h-[44px] flex-1 rounded-xl border border-line px-4 text-sm font-semibold text-ink transition-colors hover:bg-ground disabled:opacity-50">
                Cancel
              </button>
              <Button type="submit" shortcut={editing ? 'save' : 'submit'} showShortcut loading={saveMut.isPending} className="!min-h-[44px] flex-[2]">
                {saveMut.isPending ? (editing ? 'Saving…' : 'Scheduling…') : editing ? 'Save changes' : 'Schedule meeting'}
              </Button>
            </div>
          </form>
          )}
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
