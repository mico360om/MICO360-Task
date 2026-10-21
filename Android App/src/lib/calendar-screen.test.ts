import { describe, it, expect } from 'vitest';
import {
  OVERDUE_PREVIEW,
  agendaDays,
  canCreateIn,
  chosenDay,
  createDay,
  createPlaceMemory,
  newTaskProject,
  nothingText,
  offlineNote,
  timeZoneNote,
} from './calendar-screen';
import { DEFAULT_FILTERS } from './calendar-model';

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
