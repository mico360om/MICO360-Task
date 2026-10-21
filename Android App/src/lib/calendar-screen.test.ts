import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  OVERDUE_PREVIEW,
  agendaDays,
  calendarSections,
  canCreateIn,
  chosenDay,
  createDay,
  createPlaceMemory,
  dayPicked,
  meetingsCopyNote,
  newTaskProject,
  nothingText,
  offlineNote,
  timeZoneNote,
} from './calendar-screen';
import { DEFAULT_FILTERS, buildItems, groupByDay, type CalendarTask } from './calendar-model';
import type { CalMeeting } from './calendar-meetings';

const projects = [
  { id: 'p1', name: 'Tower A', status: 'ACTIVE' },
  { id: 'p2', name: 'Villa', status: 'ARCHIVED' },
  { id: 'p3', name: 'Mall', status: 'COMPLETED' },
  { id: 'p4', name: 'Road', status: 'ON_HOLD' },
];

describe('the month’s chosen day', () => {
  it('opens on today when today is in the month shown, else on the 1st; a day of another month falls back too', () => {
    expect(chosenDay('2026-10-21', '2026-10-21', null)).toBe('2026-10-21');
    expect(chosenDay('2026-11-01', '2026-10-21', null)).toBe('2026-11-01');
    expect(chosenDay('2026-10-01', '2026-10-21', '2026-10-05')).toBe('2026-10-05');
    expect(chosenDay('2026-11-01', '2026-10-21', '2026-10-05')).toBe('2026-11-01');
  });

  it('adds a new task on the chosen day in the month, else on the day the calendar shows', () => {
    expect(createDay('month', '2026-10-21', '2026-10-05')).toBe('2026-10-05');
    expect(createDay('week', '2026-10-21', '2026-10-05')).toBe('2026-10-21');
    expect(createDay('agenda', '2026-11-01', '2026-10-05')).toBe('2026-11-01');
  });
});

describe('the agenda’s days', () => {
  it('lists from today when the month holds it, the earlier days behind a button', () => {
    const keys = ['2026-10-25', '2026-10-02', '2026-10-21', '2026-11-03', '2026-10-09'];
    expect(agendaDays(keys, { from: '2026-10-01', to: '2026-10-31', today: '2026-10-21', showEarlier: false })).toEqual({
      earlier: ['2026-10-02', '2026-10-09'],
      listed: ['2026-10-21', '2026-10-25'],
    });
    expect(agendaDays(keys, { from: '2026-10-01', to: '2026-10-31', today: '2026-10-21', showEarlier: true }).listed).toEqual(['2026-10-02', '2026-10-09', '2026-10-21', '2026-10-25']);
    expect(agendaDays(keys, { from: '2026-11-01', to: '2026-11-30', today: '2026-10-21', showEarlier: false })).toEqual({ earlier: [], listed: ['2026-11-03'] });
    expect(OVERDUE_PREVIEW).toBe(8);
  });
});

describe('a new task from the calendar', () => {
  it('can be added when a project is still open (not archived or completed)', () => {
    expect(canCreateIn(projects)).toBe(true);
    expect(canCreateIn([projects[1]!, projects[2]!])).toBe(false);
    expect(canCreateIn([])).toBe(false);
  });

  it('starts in the project the calendar is filtered to, when it is still open; otherwise you pick one', () => {
    expect(newTaskProject('p1', projects)).toBe('p1');
    expect(newTaskProject('p4', projects)).toBe('p4');
    expect(newTaskProject('p2', projects)).toBeNull();
    expect(newTaskProject('', projects)).toBeNull();
    expect(newTaskProject('gone', projects)).toBeNull();
  });
});

describe('what the screen says', () => {
  it('when nothing is due', () => {
    expect(nothingText('October 2026', false)).toBe('Nothing is due in October 2026.');
    expect(nothingText('18 – 24 Oct 2026', true)).toBe('No tasks match these filters in 18 – 24 Oct 2026.');
  });

  it('offline: what the phone has kept', () => {
    expect(offlineNote(null)).toBeNull();
    expect(offlineNote({ from: '2026-09-27', to: '2026-10-31', covers: true })).toBe('You’re offline — showing what this phone saved.');
    expect(offlineNote({ from: '2026-09-27', to: '2026-10-31', covers: false })).toBe('You’re offline — this phone has only 27 Sep – 31 Oct 2026 saved.');
    expect(offlineNote({ from: '2026-12-28', to: '2027-01-31', covers: false })).toBe('You’re offline — this phone has only 28 Dec 2026 – 31 Jan 2027 saved.');
  });

  it('which time zone the days are in (the website’s words)', () => {
    expect(timeZoneNote('Asia/Muscat', null)).toBe('Dates in Asia/Muscat (company time)');
    expect(timeZoneNote('Asia/Muscat', 'Europe/London')).toBe('Dates in Europe/London (your setting)');
  });
});

describe('the calendar remembers its view and filters while the app is open, per person', () => {
  it('gives the defaults first, then what was left, and the defaults again for someone else', () => {
    const memory = createPlaceMemory();
    expect(memory.get('u1')).toEqual({ view: 'month', date: null, filters: DEFAULT_FILTERS });
    memory.set('u1', { view: 'agenda', date: '2026-11-01', filters: { ...DEFAULT_FILTERS, mine: true } });
    expect(memory.get('u1')).toEqual({ view: 'agenda', date: '2026-11-01', filters: { ...DEFAULT_FILTERS, mine: true } });
    expect(memory.get('u2')).toEqual({ view: 'month', date: null, filters: DEFAULT_FILTERS });
    expect(memory.get(null)).toEqual({ view: 'month', date: null, filters: DEFAULT_FILTERS });
  });
});

describe('the New task form the calendar opens (screens/NewTaskScreen, 4a)', () => {
  const src = (p: string) => readFileSync(resolve(__dirname, p), 'utf8');
  it('is the full form, due on the calendar’s day, in the filtered project; a task made there refreshes the calendar (as a replayed one does)', () => {
    const calendar = src('../screens/CalendarScreen.tsx');
    expect(calendar).toMatch(/navigation\.navigate\('NewTask', \{ dueDate: day, \.\.\.\(filterProject \? \{ defaultProjectId: filterProject \} : \{\}\) \}\)/);
    // The website has no quick add any more: the old sheet is gone.
    expect(existsSync(resolve(__dirname, '../components/QuickAddTaskSheet.tsx'))).toBe(false);
    expect(src('../components/calendar/CalendarSheets.tsx')).not.toMatch(/QuickAddTaskSheet|NewTaskOnDay/);
    const form = src('../screens/NewTaskScreen.tsx');
    expect(form).toMatch(/dueDate: params\.dueDate/);
    expect(form).toMatch(/refresh\(qc, createdTaskRefreshes\(projectId\)\)/);
    expect(src('./task-cache.ts')).toMatch(/\{ queryKey: \['tasks', 'calendar'\] \}/);
    expect(src('./perform-mutation.ts')).toMatch(/return createdTaskRefreshes\(p\.projectId\)/);
  });
});

describe('the list under the calendar', () => {
  const ctx = { today: '2026-10-10', timeZone: 'Asia/Muscat', projectStatus: () => 'ACTIVE' };
  const t = (id: string, dueDate: string, over: Partial<CalendarTask> = {}): CalendarTask => ({
    id, key: id.toUpperCase(), title: id, description: null, projectId: 'p1', columnId: 'c1', columnCategory: 'TODO', position: 0, priority: 'NORMAL',
    startDate: null, dueDate, estimatedHours: null, progress: 0, completedAt: null, ...over,
  });
  const items = buildItems({ tasks: [t('a', '2026-10-10T00:00:00.000Z'), t('b', '2026-10-12T00:00:00.000Z'), t('c', '2026-10-02T00:00:00.000Z')], occurrences: [], series: [] }, ctx);
  const byDay = groupByDay(items);
  const meetingsByDay = new Map([['2026-10-12', [{ key: 'mtg:m1', id: 'm1' } as CalMeeting]]]);
  const overdue = buildItems({ tasks: Array.from({ length: 10 }, (_, i) => t(`o${i}`, '2026-10-01T00:00:00.000Z')), occurrences: [], series: [] }, ctx);
  const base = { from: '2026-10-01', to: '2026-10-31', today: '2026-10-10', chosen: '2026-10-12', weekStart: 0 as const, byDay, meetingsByDay, overdue: [], showEarlier: false, allOverdue: false, filtered: false };
  const shape = (s: ReturnType<typeof calendarSections>) => s.sections.map((x) => [x.key, x.title, x.today, x.data.map((r) => r.key)]);

  it('the month: the chosen day, meetings first', () => {
    expect(shape(calendarSections({ ...base, view: 'month' }))).toEqual([['day:2026-10-12', 'Monday 12 October', false, ['mtg:m1', 'b']]]);
    const empty = calendarSections({ ...base, view: 'month', chosen: '2026-10-11', filtered: true });
    expect(empty.sections[0]!.data).toEqual([{ key: 'empty:2026-10-11', type: 'empty', text: 'Nothing due with these filters.' }]);
  });

  it('the week: all seven days, each saying when nothing is due', () => {
    const week = calendarSections({ ...base, view: 'week', from: '2026-10-04', to: '2026-10-10' });
    expect(week.sections.map((s) => s.day)).toEqual(['2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10']);
    expect(week.sections[6]).toMatchObject({ title: 'Saturday 10 October', today: true });
    expect(week.sections[0]!.data[0]).toMatchObject({ type: 'empty', text: 'Nothing due.' });
  });

  it('the agenda: overdue first (eight, then “Show all”), then the days from today; earlier days behind a button', () => {
    const agenda = calendarSections({ ...base, view: 'agenda', overdue });
    expect(agenda.sections.map((s) => s.key)).toEqual(['overdue', 'day:2026-10-10', 'day:2026-10-12']);
    expect(agenda.sections[0]!.title).toBe('Overdue · 10');
    expect(agenda.sections[0]!.data.map((r) => r.type)).toEqual([...Array(8).fill('task'), 'more']);
    expect(agenda.sections[0]!.data.at(-1)).toMatchObject({ type: 'more', text: 'Show all 10 overdue tasks' });
    expect(agenda.earlier).toBe(1);
    expect(calendarSections({ ...base, view: 'agenda', overdue, allOverdue: true }).sections[0]!.data.at(-1)).toMatchObject({ type: 'more', text: 'Show fewer' });
    expect(calendarSections({ ...base, view: 'agenda', showEarlier: true }).sections.map((s) => s.day)).toEqual(['2026-10-02', '2026-10-10', '2026-10-12']);
    expect(calendarSections({ ...base, view: 'agenda', byDay: new Map(), meetingsByDay: new Map() }).sections).toEqual([]);
  });
});

describe('5a review fixes: the month grid and what the phone has saved', () => {
  it('a day of the next or last month in the grid opens that month with the day chosen', () => {
    expect(dayPicked('2026-10-15', '2026-11-02')).toEqual({ moveTo: '2026-11-02', selected: '2026-11-02' });
    expect(dayPicked('2026-10-15', '2026-09-28')).toEqual({ moveTo: '2026-09-28', selected: '2026-09-28' });
    // …and that month then shows that day as chosen.
    expect(chosenDay('2026-11-02', '2026-10-21', '2026-11-02')).toBe('2026-11-02');
    // A day of the month shown just chooses it.
    expect(dayPicked('2026-10-15', '2026-10-20')).toEqual({ moveTo: null, selected: '2026-10-20' });
  });

  const t = (id: string, dueDate: string): CalendarTask => ({
    id, key: id.toUpperCase(), title: id, description: null, projectId: 'p1', columnId: 'c1', columnCategory: 'TODO', position: 0, priority: 'NORMAL',
    startDate: null, dueDate, estimatedHours: null, progress: 0, completedAt: null,
  });
  const items = buildItems({ tasks: [t('a', '2026-10-30T00:00:00.000Z')], occurrences: [], series: [] }, { today: '2026-10-21', timeZone: 'Asia/Muscat', projectStatus: () => 'ACTIVE' });
  const week = {
    view: 'week' as const, from: '2026-10-25', to: '2026-10-31', today: '2026-10-21', chosen: '2026-10-25', weekStart: 0 as const,
    byDay: groupByDay(items), meetingsByDay: new Map(), overdue: [], showEarlier: false, allOverdue: false, filtered: false,
  };

  it('offline, a day outside what this phone saved says so, instead of “Nothing due.”', () => {
    const saved = { from: '2026-10-28', to: '2026-11-30', covers: false };
    const s = calendarSections({ ...week, saved });
    expect(s.sections[0]!.data).toEqual([{ key: 'empty:2026-10-25', type: 'empty', text: 'Not saved on this phone.' }]);
    expect(s.sections[3]!.data[0]).toMatchObject({ type: 'empty', text: 'Nothing due.' }); // 28 Oct is saved
    expect(s.sections[5]!.data[0]).toMatchObject({ type: 'task' }); // 30 Oct has its task
    expect(calendarSections({ ...week, saved: null }).sections[0]!.data[0]).toMatchObject({ text: 'Nothing due.' });
  });

  it('the “nothing in this period” line doesn’t claim nothing is due when only part of it is saved', () => {
    expect(nothingText('October 2026', false, true)).toBe('Nothing due in the days this phone saved.');
    expect(nothingText('October 2026', true, true)).toBe('No tasks match these filters in the days this phone saved.');
    expect(nothingText('October 2026', false, false)).toBe('Nothing is due in October 2026.');
  });

  it('meetings from this phone’s copy get a note: some may be missing', () => {
    expect(meetingsCopyNote(true)).toBe('You’re offline — only the meetings this phone saved are shown.');
    expect(meetingsCopyNote(false)).toBeNull();
  });
});
