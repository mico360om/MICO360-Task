import { describe, it, expect } from 'vitest';
import { ApiError, NetworkError } from './api-client';
import { newMeetingDraft, type MeetingDraft } from './meeting-form';
import {
  addAgendaTopic,
  addDraftedItems,
  addGuest,
  addInTurn,
  addTeamMember,
  agendaLeads,
  agendaMinutesInput,
  agendaTotal,
  applyDescribed,
  busyLines,
  chosenPatch,
  clashLine,
  describeBaseline,
  describeFields,
  AGENDA_MAX,
  PEOPLE_MAX,
  freeTimesView,
  recheckFreeTimes,
  describeSuggestions,
  draftAddText,
  descriptionRequest,
  formAgendaRequest,
  freeTimesFailure,
  freeTimesInput,
  invitableOptions,
  meetingAiFailure,
  meetingMinutes,
  moveAgendaDraft,
  newMeetingExtras,
  pageAgendaRequest,
  pickedTime,
  readFreeTimes,
  withPeople,
  type AgendaDraft,
  type DescribeSuggestion,
  type MeetingPerson,
} from './meeting-ai';
import type { AiMeetingDraft, ApiDirectoryUser, ApiMeeting, ApiMeetingAttendee } from './types';

const TZ = 'Asia/Muscat'; // UTC+4
const ME = 'u1';
const user = (id: string, firstName: string, lastName = '', over: Partial<ApiDirectoryUser> = {}): ApiDirectoryUser => ({ id, username: firstName.toLowerCase(), firstName, lastName, ...over });
const directory = [user('u1', 'Ahmed', 'Al Harthy'), user('u2', 'Sara', 'Al Balushi'), user('u3', 'Omar', 'Said'), user('u4', 'Layla', 'Hinai', { active: false })];
// A new meeting's form, opened at 05:00 UTC on 22 Oct (09:00 company time): it starts at 10:00.
const form = (over: Partial<MeetingDraft> = {}): MeetingDraft => ({ ...newMeetingDraft(TZ, new Date('2026-10-22T05:00:00.000Z')), ...over });
const omar: MeetingPerson = { kind: 'user', id: 'u3', name: 'Omar Said', role: 'REQUIRED' };
const guest: MeetingPerson = { kind: 'guest', email: 'sami@contractor.om', name: 'sami', role: 'REQUIRED' };

const nothing: AiMeetingDraft = {
  title: null,
  description: null,
  date: null,
  startTime: null,
  minutes: null,
  recurrence: null,
  project: null,
  location: null,
  onlineLink: null,
  people: { found: [], choices: [], notFound: [] },
  guests: [],
  agenda: [],
};

describe('people in a new meeting (2c)', () => {
  it('offers active team members not yet invited — never the organizer, nor an inactive account', () => {
    expect(invitableOptions(directory, ME, [omar]).map((o) => o.value)).toEqual(['u2']);
    expect(invitableOptions(directory, ME, []).map((o) => o.label)).toEqual(['Omar Said', 'Sara Al Balushi']);
  });

  it('adds a team member once, and a guest by email (named from the part before the @ unless named)', () => {
    expect(addTeamMember([], directory, 'u3')).toEqual([omar]);
    expect(addTeamMember([omar], directory, 'u3')).toEqual([omar]);
    expect(addGuest([], 'Sami@Contractor.om ', '')).toEqual({ ok: true, people: [{ kind: 'guest', email: 'Sami@Contractor.om', name: 'Sami', role: 'REQUIRED' }] });
    expect(addGuest([], 'not-an-email', 'X')).toEqual({ ok: false, error: 'Enter a valid email address, for example name@company.com.' });
    expect(addGuest([guest], 'SAMI@contractor.om', '')).toEqual({ ok: false, error: 'That guest is already invited.' });
  });

  it('the organizer and the invited team members may lead agenda items; someone taken off no longer leads theirs', () => {
    expect(agendaLeads(ME, 'Ahmed Al Harthy', [omar, guest])).toEqual([
      { id: 'u1', name: 'Ahmed Al Harthy (you)' },
      { id: 'u3', name: 'Omar Said' },
    ]);
    const agenda: AgendaDraft[] = [
      { key: 'a', title: 'Budget', ownerId: 'u3', minutes: 10 },
      { key: 'b', title: 'Plan', ownerId: 'u1', minutes: null },
    ];
    expect(withPeople([guest], agenda, ME).agenda).toEqual([{ ...agenda[0], ownerId: null }, agenda[1]]);
  });

  it('goes with the new meeting in the same request: people and the topics that have a title', () => {
    const agenda: AgendaDraft[] = [
      { key: 'a', title: ' Budget ', ownerId: 'u3', minutes: 10 },
      { key: 'b', title: '   ', ownerId: null, minutes: null },
    ];
    expect(newMeetingExtras([omar, { ...guest, role: 'OPTIONAL' }], agenda)).toEqual({
      attendees: [
        { userId: 'u3', role: 'REQUIRED' },
        { externalEmail: 'sami@contractor.om', externalName: 'sami', role: 'OPTIONAL' },
      ],
      agendaItems: [{ title: 'Budget', ownerId: 'u3', expectedMinutes: 10 }],
    });
    expect(newMeetingExtras([], [])).toEqual({});
  });
});

describe('the agenda of a new meeting', () => {
  it('adds a topic (or says what is missing), moves it, and reads minutes leniently', () => {
    expect(addAgendaTopic([], '  ')).toEqual({ ok: false, error: 'Enter an agenda item.' });
    const added = addAgendaTopic([], ' Budget ');
    expect(added.ok && added.agenda.map((i) => i.title)).toEqual(['Budget']);
    const list: AgendaDraft[] = ['A', 'B', 'C'].map((t) => ({ key: t, title: t, ownerId: null, minutes: null }));
    expect(moveAgendaDraft(list, 2, -1).map((i) => i.title)).toEqual(['A', 'C', 'B']);
    expect(moveAgendaDraft(list, 0, -1)).toBe(list);
    expect(agendaMinutesInput('')).toBeNull();
    expect(agendaMinutesInput('١٥')).toBe(15);
    expect(agendaMinutesInput('0')).toBe(1);
    expect(agendaMinutesInput('900')).toBe(600);
  });

  it('totals the minutes against the meeting’s length (an hour when it has no end)', () => {
    expect(meetingMinutes(form(), TZ)).toBe(60);
    expect(meetingMinutes(form({ endTime: '11:30' }), TZ)).toBe(90);
    const items: AgendaDraft[] = [
      { key: 'a', title: 'A', ownerId: null, minutes: 40 },
      { key: 'b', title: 'B', ownerId: null, minutes: 30 },
    ];
    expect(agendaTotal(items, 60)).toEqual({ text: 'Total 70 of 60 minutes', over: true });
    expect(agendaTotal(items.slice(0, 1), 60)).toEqual({ text: 'Total 40 of 60 minutes', over: false });
  });
});

describe('Describe the meeting', () => {
  const ctx = (over: Partial<Parameters<typeof describeSuggestions>[1]> = {}) => ({
    current: describeFields(form()),
    initial: describeBaseline(form(), { editing: false, timesTouched: false }),
    withPeopleAndAgenda: true,
    projects: [{ id: 'p1', name: 'Pump station', code: 'PUMP', number: 'J-12' }],
    people: [] as MeetingPerson[],
    timeZone: TZ,
    ...over,
  });
  const keyed = (found: DescribeSuggestion[]) => Object.fromEntries(found.map((s) => [s.key, s]));

  it('suggests what the sentence gives; nothing is changed until the ticked ones are used', () => {
    const found = describeSuggestions(
      {
        ...nothing,
        title: 'Weekly site review',
        date: '2026-10-26',
        startTime: '10:00',
        minutes: 90,
        recurrence: { freq: 'WEEKLY', interval: 1, weekdays: [1] },
        project: { id: 'p1', code: 'PUMP', number: 'J-12', name: 'Pump station' },
        location: 'RIG1',
        people: { found: [{ id: 'u3', name: 'Omar Said' }], choices: [], notFound: ['Zainab'] },
        guests: [{ email: 'sami@contractor.om', name: 'Sami' }],
        agenda: ['Safety', 'Progress'],
      },
      ctx(),
    );
    const by = keyed(found);
    expect(Object.keys(by)).toEqual(['title', 'start', 'minutes', 'rule', 'projectId', 'location', 'u:u3', 'e:sami@contractor.om', 'agenda-0', 'agenda-1']);
    expect(found.every((s) => s.kind !== 'choice' && s.checked)).toBe(true);
    expect(by['projectId']).toMatchObject({ label: 'Project', shown: 'Pump station · PUMP · J-12' });
    expect(by['minutes']).toMatchObject({ label: 'Length', shown: '90 minutes', replaces: null });
    expect(by['rule']).toMatchObject({ label: 'Repeat', shown: 'Repeats every week on Mon' });
    expect(by['e:sami@contractor.om']).toMatchObject({ label: 'Guest', shown: 'Sami (sami@contractor.om)' });
  });

  it('a suggestion that would replace your own value starts unticked and says what it replaces; the untouched start doesn’t count as yours', () => {
    const mine = form({ title: 'My own title', location: 'Room 2' });
    const found = describeSuggestions({ ...nothing, title: 'Weekly site review', location: 'RIG1', date: '2026-10-26', startTime: '09:00' }, ctx({ current: describeFields(mine) }));
    const by = keyed(found);
    expect(by['title']).toMatchObject({ checked: false, replaces: '“My own title”' });
    expect(by['location']).toMatchObject({ checked: false });
    expect(by['start']).toMatchObject({ checked: true });
    // Once the times are touched, they are yours too; in an existing meeting, everything is.
    const touched = describeSuggestions({ ...nothing, date: '2026-10-26', startTime: '09:00' }, ctx({ initial: describeBaseline(form(), { editing: false, timesTouched: true }) }));
    expect(touched[0]).toMatchObject({ key: 'start', checked: false });
  });

  it('a name more than one person goes by asks which one (Neither to start); a project outside the list is left out', () => {
    const found = describeSuggestions(
      {
        ...nothing,
        people: { found: [], choices: [{ said: 'Sara', options: [{ id: 'u2', name: 'Sara Al Balushi', username: 'sara' }, { id: 'u9', name: 'Sara Hinai', username: 'sara_h' }] }], notFound: [] },
        project: { id: 'p9', code: 'X', number: null, name: 'Not mine' },
      },
      ctx(),
    );
    expect(found).toEqual([{ kind: 'choice', key: 'choice-0', said: 'Sara', options: [{ id: 'u2', name: 'Sara Al Balushi', username: 'sara' }, { id: 'u9', name: 'Sara Hinai', username: 'sara_h' }], chosen: null }]);
    expect(chosenPatch(found)).toEqual({});
    expect(chosenPatch([{ ...(found[0] as Extract<DescribeSuggestion, { kind: 'choice' }>), chosen: 'u9' }])).toEqual({ people: [{ kind: 'user', id: 'u9', name: 'Sara Hinai', role: 'REQUIRED' }] });
  });

  it('editing offers no people or agenda, and nobody already invited is offered again', () => {
    const d = { ...nothing, title: 'Sync', people: { found: [{ id: 'u3', name: 'Omar Said' }], choices: [], notFound: [] }, agenda: ['Budget'] };
    expect(describeSuggestions(d, ctx({ withPeopleAndAgenda: false })).map((s) => s.key)).toEqual(['title']);
    expect(describeSuggestions(d, ctx({ people: [omar] })).map((s) => s.key)).toEqual(['title', 'agenda-0']);
  });

  it('using the ticked ones fills the form: the start moves, a length sets the end, people and topics are added', () => {
    const found = describeSuggestions({ ...nothing, title: 'Site review', date: '2026-10-26', startTime: '09:30', minutes: 45, people: { found: [{ id: 'u3', name: 'Omar Said' }], choices: [], notFound: [] }, agenda: ['Safety'] }, ctx());
    const patch = chosenPatch(found.map((s) => (s.key === 'title' && s.kind === 'field' ? { ...s, checked: false } : s)));
    const next = applyDescribed({ draft: form(), people: [], agenda: [] }, patch, { timeZone: TZ, organizerId: ME });
    expect(next.draft).toMatchObject({ title: '', startDay: '2026-10-26', startTime: '09:30', endTime: '10:15', endDay: '' });
    expect(next.people).toEqual([omar]);
    expect(next.agenda.map((i) => [i.title, i.ownerId, i.minutes])).toEqual([['Safety', null, null]]);
    // A new start keeps an end that was set: the meeting's length stays.
    const moved = applyDescribed({ draft: form({ endTime: '11:30' }), people: [], agenda: [] }, { start: '2026-10-26T14:00' }, { timeZone: TZ, organizerId: ME });
    expect(moved.draft).toMatchObject({ startDay: '2026-10-26', startTime: '14:00', endTime: '15:30' });
    // Past midnight, the end day is kept.
    const late = applyDescribed({ draft: form(), people: [], agenda: [] }, { start: '2026-10-26T23:30', minutes: 60 }, { timeZone: TZ, organizerId: ME });
    expect(late.draft).toMatchObject({ startTime: '23:30', endTime: '00:30', endDay: '2026-10-27' });
  });
});

describe('Draft agenda', () => {
  it('in the form: from the title, description, sentence and the people who may lead — and says what is missing first', () => {
    const leads = [{ id: 'u1', name: 'Me' }, { id: 'u3', name: 'Omar' }];
    expect(formAgendaRequest({ draft: form(), timeZone: TZ, sentence: '', leads })).toEqual({ ok: false, hint: 'Add a title first.' });
    expect(formAgendaRequest({ draft: form({ title: 'Sync', startDay: '' }), timeZone: TZ, sentence: '', leads })).toEqual({ ok: false, hint: 'Choose when it starts first.' });
    expect(formAgendaRequest({ draft: form({ title: ' Sync ', description: ' Plans ', projectId: 'p1', endTime: '10:03' }), timeZone: TZ, sentence: ' weekly sync ', leads })).toEqual({
      ok: true,
      input: { title: 'Sync', description: 'Plans', text: 'weekly sync', projectId: 'p1', startAt: '2026-10-22T06:00:00.000Z', minutes: 5, peopleIds: ['u1', 'u3'] },
    });
  });

  it('on the meeting’s page: its details, its organizer and invited team members, and its own id (for last time’s leftovers)', () => {
    const m = { id: 'm1', title: 'Sync', description: null, projectId: null, startAt: '2026-10-22T06:00:00.000Z', endAt: '2026-10-22T06:45:00.000Z', organizerId: 'u1' } as ApiMeeting;
    const people = [{ id: 'a1', userId: 'u3' }, { id: 'a2', userId: null }, { id: 'a3', userId: 'u1' }] as ApiMeetingAttendee[];
    expect(pageAgendaRequest(m, people)).toEqual({ title: 'Sync', projectId: null, startAt: m.startAt, minutes: 45, peopleIds: ['u1', 'u3'], meetingId: 'm1' });
    expect(pageAgendaRequest({ ...m, endAt: null }, []).minutes).toBe(60);
  });

  it('adds only the ticked items, keeping a lead only when they may lead', () => {
    const next = addDraftedItems([], [{ title: 'Budget', ownerId: 'u3', minutes: 20 }, { title: 'Risks', ownerId: 'u8', minutes: 0 }], [{ id: 'u3', name: 'Omar' }]);
    expect(next.map((i) => [i.title, i.ownerId, i.minutes])).toEqual([['Budget', 'u3', 20], ['Risks', null, null]]);
  });

  it('adds drafted items to a meeting one after another; on a failure says which are left, so none is added twice', async () => {
    const added: string[] = [];
    const add = async (t: string) => {
      if (t === 'C') throw new NetworkError('offline');
      added.push(t);
    };
    const r = await addInTurn(['A', 'B', 'C', 'D'], add);
    expect(added).toEqual(['A', 'B']);
    expect(r).toMatchObject({ added: ['A', 'B'], left: ['C', 'D'] });
    expect(r.error).toBeInstanceOf(NetworkError);
    expect(await addInTurn(['A'], async () => undefined)).toEqual({ added: ['A'], left: [], error: null });
  });
});

describe('free times (no AI)', () => {
  it('asks for the organizer and the invited team members, the meeting’s length, and a new series’ repeat', () => {
    const rule = { freq: 'WEEKLY' as const, interval: 1, weekdays: [1] };
    expect(freeTimesInput({ organizerId: ME, userIds: ['u3', 'u1', 'u3'], startAt: '2026-10-22T06:00:00.000Z', minutes: 900, rule, seriesId: null })).toEqual({
      userIds: ['u1', 'u3'],
      startAt: '2026-10-22T06:00:00.000Z',
      minutes: 720,
      recurrenceRule: rule,
    });
    // One meeting of a series keeps the series' repeat (not checked); its own time isn't a clash.
    expect(freeTimesInput({ organizerId: ME, userIds: [], startAt: '2026-10-22T06:00:00.000Z', minutes: 2, rule, seriesId: 'm0', meetingId: 'm1' })).toEqual({
      userIds: ['u1'],
      startAt: '2026-10-22T06:00:00.000Z',
      minutes: 5,
      excludeMeetingId: 'm1',
    });
    expect(freeTimesInput({ organizerId: ME, userIds: [], startAt: null, minutes: 60, rule: null, seriesId: null })).toBeNull();
  });

  it('reads the answer warily (an older server, a Wi-Fi page) and words the clashes and the busy day', () => {
    const reply = {
      suggestions: ['2026-10-22T08:00:00.000Z'],
      clashes: [{ userId: 'u3', name: 'Omar Said', start: '2026-10-22T06:00:00.000Z', end: '2026-10-22T07:00:00.000Z', title: null }],
      day: [{ userId: 'u3', name: 'Omar Said', blocks: [{ start: '2026-10-22T06:00:00.000Z', end: '2026-10-22T07:00:00.000Z', title: 'Board review' }] }, { userId: 'u1', name: 'Ahmed', blocks: [] }],
      workingHours: { days: [0, 1, 2, 3, 4], start: '08:00', end: '17:00' },
    };
    expect(readFreeTimes(reply)).toBe(reply);
    expect(readFreeTimes({ suggestions: [] })).toBeUndefined();
    expect(readFreeTimes('<html>')).toBeUndefined();
    expect(clashLine(reply.clashes[0]!, TZ)).toMatch(/^Omar Said — .*10:00 – 11:00 \(Busy\)$/);
    expect(busyLines(reply.day, TZ)).toEqual([
      { userId: 'u3', name: 'Omar Said', text: '10:00 – 11:00 Board review' },
      { userId: 'u1', name: 'Ahmed', text: 'No meetings' },
    ]);
  });

  it('picking a time moves the start and keeps the length', () => {
    expect(pickedTime(form({ endTime: '11:30' }), '2026-10-25T10:00:00.000Z', TZ)).toMatchObject({ startDay: '2026-10-25', startTime: '14:00', endTime: '15:30', endDay: '' });
    expect(pickedTime(form(), '2026-10-25T10:00:00.000Z', TZ)).toMatchObject({ startDay: '2026-10-25', startTime: '14:00', endTime: '' });
  });
});

describe('when a helper can’t answer', () => {
  it('says the server’s own words (AI not set up), the AI being slow, or that it needs a connection', () => {
    expect(meetingAiFailure(new ApiError(503, 'AI_NOT_CONFIGURED', 'AI is not configured yet — ask an admin to set it up.'), 'Couldn’t read that.')).toBe('AI is not configured yet — ask an admin to set it up.');
    expect(meetingAiFailure(new ApiError(500, 'ERROR', 'Request failed (500)'), 'Couldn’t read that.')).toBe('Couldn’t read that.');
    expect(meetingAiFailure(new NetworkError('slow', { timedOut: true }), 'x')).toBe('The AI is taking longer than usual. Please try again in a minute.');
    expect(meetingAiFailure(new NetworkError('offline'), 'x')).toBe('You’re offline — the AI helpers need a connection. Try again when you’re online.');
    expect(freeTimesFailure(new NetworkError('offline'))).toBe('Free times need a connection — try again when you’re online.');
    expect(freeTimesFailure(new ApiError(500, 'ERROR', 'x'))).toBe('Couldn’t check free times. Please try again.');
  });
});

describe('Write description', () => {
  it('writes from the title, the agenda’s topics and the sentence; waits for a title', () => {
    const agenda: AgendaDraft[] = [
      { key: 'a', title: ' Budget ', ownerId: null, minutes: null },
      { key: 'b', title: ' ', ownerId: null, minutes: null },
    ];
    expect(descriptionRequest({ title: '  ', agenda, sentence: 'x' })).toBeNull();
    expect(descriptionRequest({ title: ' Weekly sync ', agenda, sentence: ' weekly sync on Monday ' })).toEqual({ title: 'Weekly sync', agenda: ['Budget'], text: 'weekly sync on Monday' });
    expect(descriptionRequest({ title: 'Sync', agenda: [], sentence: '' })).toEqual({ title: 'Sync' });
  });
});

describe('adding a drafted agenda on the meeting’s page', () => {
  it('says how many were added and why the rest weren’t (tapping again adds only those)', () => {
    expect(draftAddText(2, 4, new NetworkError('offline'))).toBe('Added 2 of 4. Couldn’t add all of the drafted items. You’re offline — this needs a connection.');
    expect(draftAddText(0, 3, new NetworkError('slow', { timedOut: true }))).toBe('The server took too long to answer — it may already be done. Tap “Add selected” again to finish: it won’t happen twice.');
    expect(draftAddText(1, 2, new ApiError(403, 'FORBIDDEN', 'x'))).toBe('Added 1 of 2. Couldn’t add all of the drafted items. You don’t have permission to do that.');
  });
});

describe('the server’s limits, checked on the phone before Schedule (2c review)', () => {
  const many = (n: number): MeetingPerson[] => Array.from({ length: n }, (_, i) => ({ kind: 'guest', email: `g${i}@x.co`, name: `g${i}`, role: 'REQUIRED' }));
  it('up to 100 people and 50 agenda items, a guest name up to 200 characters, and an email the server takes', () => {
    expect(addGuest([], 'name@company.com.', '')).toEqual({ ok: false, error: 'Enter a valid email address, for example name@company.com.' });
    expect(addGuest([], 'name@company..com', '')).toMatchObject({ ok: false });
    expect(addGuest(many(PEOPLE_MAX), 'new@x.co', '')).toEqual({ ok: false, error: 'Up to 100 people can be added here — add more from the meeting’s page once it is saved.' });
    expect(addTeamMember(many(PEOPLE_MAX), directory, 'u3')).toHaveLength(PEOPLE_MAX);
    const long = addGuest([], 'a@x.co', 'n'.repeat(250));
    expect(long.ok && long.people[0]!.name).toHaveLength(200);
    const full: AgendaDraft[] = Array.from({ length: AGENDA_MAX }, (_, i) => ({ key: `k${i}`, title: `T${i}`, ownerId: null, minutes: null }));
    expect(addAgendaTopic(full, 'One more')).toEqual({ ok: false, error: 'Up to 50 agenda items can be added here — add more from the meeting’s page once it is saved.' });
    expect(addDraftedItems(full.slice(0, 48), [1, 2, 3].map((n) => ({ title: `D${n}`, ownerId: null, minutes: 5 })), [])).toHaveLength(AGENDA_MAX);
    const filled = applyDescribed({ draft: form(), people: many(99), agenda: full.slice(0, 49) }, { people: many(102).slice(99), agenda: ['X', 'Y'] }, { timeZone: TZ, organizerId: ME });
    expect(filled.people).toHaveLength(PEOPLE_MAX);
    expect(filled.agenda).toHaveLength(AGENDA_MAX);
  });
});

describe('free times while the form is still changing', () => {
  it('says it is finding them (never an error, nor the last answer) until the time has settled', () => {
    const data = { suggestions: [], clashes: [], day: [], workingHours: { days: [0], start: '08:00', end: '17:00' } };
    expect(freeTimesView({ shown: false, settled: true, fetching: false, error: null, data })).toBe('hidden');
    expect(freeTimesView({ shown: true, settled: false, fetching: false, error: new Error('x'), data })).toBe('finding');
    expect(freeTimesView({ shown: true, settled: true, fetching: true, error: null, data })).toBe('finding');
    expect(freeTimesView({ shown: true, settled: true, fetching: false, error: new Error('x'), data: undefined })).toBe('error');
    expect(freeTimesView({ shown: true, settled: true, fetching: false, error: null, data })).toBe('none');
    expect(freeTimesView({ shown: true, settled: true, fetching: false, error: null, data: { ...data, suggestions: ['2026-10-22T08:00:00.000Z'] } })).toBe('suggestions');
    // Asking again checks afresh — only once what is asked for has settled.
    expect(recheckFreeTimes({ shown: true, stale: false, settled: false })).toBe(false);
    expect(recheckFreeTimes({ shown: true, stale: false, settled: true })).toBe(true);
    expect(recheckFreeTimes({ shown: false, stale: true, settled: true })).toBe(true);
    expect(recheckFreeTimes({ shown: false, stale: false, settled: true })).toBe(false);
  });
});
