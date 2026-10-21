import { describe, it, expect } from 'vitest';
import { PEOPLE_FIRST, filterNotes, findMeeting, meetingDetailRows, noteFilters, type DetailInput, type DetailRow } from './meeting-screen';
import type { ApiActionItem, ApiAgendaItem, ApiFinalMinutes, ApiMeeting, ApiMeetingAttendee, ApiMeetingNote } from './types';

const meeting = (over: Partial<ApiMeeting> = {}): ApiMeeting => ({
  id: 'm1',
  title: 'Weekly review',
  description: null,
  status: 'SCHEDULED',
  projectId: 'p1',
  organizerId: 'u1',
  location: null,
  onlineLink: null,
  startAt: '2026-10-20T06:00:00.000Z',
  endAt: '2026-10-20T07:00:00.000Z',
  timeZone: 'Asia/Muscat',
  recurrenceRule: null,
  recurrenceParentId: null,
  ...over,
});

const note = (id: string, over: Partial<ApiMeetingNote> = {}): ApiMeetingNote => ({
  id,
  meetingId: 'm1',
  agendaItemId: null,
  authorId: 'u1',
  type: 'DISCUSSION',
  body: id,
  highlighted: false,
  taskId: null,
  createdAt: '2026-10-20T06:05:00.000Z',
  editedAt: null,
  ...over,
});

const person = (id: string): ApiMeetingAttendee => ({
  id,
  meetingId: 'm1',
  userId: id,
  externalName: null,
  externalEmail: null,
  role: 'REQUIRED',
  attendance: 'INVITED',
  response: 'PENDING',
  department: null,
  createdAt: '2026-10-01T00:00:00.000Z',
});

const agendaItem = (id: string): ApiAgendaItem => ({ id, meetingId: 'm1', title: id, ownerId: null, expectedMinutes: 10, position: 0, completed: false });
const action = (id: string): ApiActionItem => ({
  id,
  meetingId: 'm1',
  projectId: null,
  description: id,
  assigneeId: null,
  priority: 'NORMAL',
  status: 'OPEN',
  dueDate: null,
  progress: 0,
  completedAt: null,
  taskId: null,
  sourceNoteId: null,
  createdById: 'u1',
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
  overdue: false,
});
const minutes: ApiFinalMinutes = { status: 'NONE', content: null, savedAt: null, approvedBy: null, approvedAt: null, canEdit: false };

const loaded = <T>(data: T) => ({ data, loading: false, failed: false });
const input = (over: Partial<DetailInput> = {}): DetailInput => ({
  meeting: meeting(),
  canRsvp: false,
  agenda: loaded([agendaItem('a1')]),
  people: loaded([person('u1'), person('u2')]),
  notes: loaded([note('n1')]),
  actions: loaded([action('i1')]),
  minutes: loaded(minutes),
  showAllPeople: false,
  noteFilter: 'ALL',
  ...over,
});
const kinds = (rows: DetailRow[]) => rows.map((r) => (r.kind === 'title' ? `# ${r.section}` : r.kind));

describe('meetingDetailRows (one FlatList: long notes and action items stay quick)', () => {
  it('lays the meeting out in reading order: header, your answer, about, agenda, people, notes, action items, final minutes', () => {
    expect(kinds(meetingDetailRows(input({ canRsvp: true })))).toEqual([
      'header',
      'rsvp',
      'about',
      '# agenda',
      'agenda',
      '# people',
      'person',
      'person',
      '# notes',
      'noteFilters',
      'note',
      '# actions',
      'action',
      '# minutes',
      'minutes',
      'footer',
    ]);
  });

  it('asks for your answer only when you’re invited and it can still be given', () => {
    expect(kinds(meetingDetailRows(input()))).not.toContain('rsvp');
  });

  it('gives every row its own key', () => {
    const rows = meetingDetailRows(input({ canRsvp: true }));
    expect(new Set(rows.map((r) => r.key)).size).toBe(rows.length);
  });

  it('says what is loading, what failed (to retry) and what is empty, part by part', () => {
    const rows = meetingDetailRows(
      input({
        agenda: { data: undefined, loading: true, failed: false },
        people: { data: undefined, loading: false, failed: true },
        notes: loaded([]),
        actions: loaded([]),
        minutes: { data: undefined, loading: false, failed: true },
      }),
    );
    const bySection = (section: string) => rows.filter((r) => 'section' in r && r.section === section && r.kind !== 'title').map((r) => (r.kind === 'empty' ? `empty: ${r.text}` : r.kind));
    expect(bySection('agenda')).toEqual(['loading']);
    expect(bySection('people')).toEqual(['failed']);
    expect(bySection('notes')).toEqual(['empty: No notes yet.']);
    expect(bySection('actions')).toEqual(['empty: No action items yet.']);
    expect(bySection('minutes')).toEqual(['failed']);
  });

  it('shows the first people and a “Show all” row, or everyone once asked', () => {
    const many = Array.from({ length: PEOPLE_FIRST + 3 }, (_, i) => person(`u${i}`));
    const short = meetingDetailRows(input({ people: loaded(many) }));
    expect(short.filter((r) => r.kind === 'person')).toHaveLength(PEOPLE_FIRST);
    expect(short.find((r) => r.kind === 'more')).toMatchObject({ kind: 'more', section: 'people', total: PEOPLE_FIRST + 3 });
    const all = meetingDetailRows(input({ people: loaded(many), showAllPeople: true }));
    expect(all.filter((r) => r.kind === 'person')).toHaveLength(PEOPLE_FIRST + 3);
    expect(all.find((r) => r.kind === 'more')).toMatchObject({ kind: 'more', expanded: true });
  });

  it('shows the notes of the category picked, and says when there are none of it', () => {
    const notes = loaded([note('n1', { type: 'DECISION' }), note('n2'), note('n3', { highlighted: true })]);
    const decisions = meetingDetailRows(input({ notes, noteFilter: 'DECISION' })).filter((r) => r.kind === 'note');
    expect(decisions.map((r) => (r.kind === 'note' ? r.note.id : ''))).toEqual(['n1']);
    const none = meetingDetailRows(input({ notes, noteFilter: 'ISSUE' }));
    expect(none.find((r) => r.kind === 'empty' && r.section === 'notes')).toMatchObject({ text: 'No notes in this category.' });
  });

  it('counts in the section titles: people, notes and the open action items', () => {
    const rows = meetingDetailRows(input({ actions: loaded([action('i1'), { ...action('i2'), status: 'COMPLETED' }]) }));
    const title = (section: string) => rows.find((r) => r.kind === 'title' && r.section === section);
    expect(title('people')).toMatchObject({ title: 'People', count: '2' });
    expect(title('notes')).toMatchObject({ title: 'Live notes', count: '1' });
    expect(title('actions')).toMatchObject({ title: 'Action items', count: '1 open of 2' });
    expect(title('agenda')).toMatchObject({ title: 'Agenda', count: '1' });
    expect(title('minutes')).toMatchObject({ title: 'Final MOM' });
  });
});

describe('note filters', () => {
  const notes = [note('a', { type: 'DECISION' }), note('b', { type: 'DECISION', highlighted: true }), note('c', { type: 'ISSUE' })];

  it('offers All, Key points (when there are any) and each category that has notes, with counts', () => {
    expect(noteFilters(notes)).toEqual([
      { key: 'ALL', label: 'All', count: 3 },
      { key: 'KEY', label: 'Key points', count: 1 },
      { key: 'DECISION', label: 'Decision', count: 2 },
      { key: 'ISSUE', label: 'Issue', count: 1 },
    ]);
    expect(noteFilters([note('x')])).toEqual([
      { key: 'ALL', label: 'All', count: 1 },
      { key: 'DISCUSSION', label: 'Discussion', count: 1 },
    ]);
  });

  it('keeps the notes of the filter picked', () => {
    expect(filterNotes(notes, 'ALL').map((n) => n.id)).toEqual(['a', 'b', 'c']);
    expect(filterNotes(notes, 'KEY').map((n) => n.id)).toEqual(['b']);
    expect(filterNotes(notes, 'ISSUE').map((n) => n.id)).toEqual(['c']);
  });
});

describe('findMeeting (the details show at once from a list that holds the meeting)', () => {
  it('finds the meeting in any list, else nothing', () => {
    const lists = [undefined, [meeting({ id: 'a' })], [meeting({ id: 'b', title: 'Found' })], { not: 'a list' }];
    expect(findMeeting(lists, 'b')?.title).toBe('Found');
    expect(findMeeting(lists, 'zzz')).toBeUndefined();
  });
});
