import { describe, it, expect } from 'vitest';
import { createReopenNote, zoneChangeQuestion, zonesDiffer } from './reopen-note';

describe('before a new time zone is saved (6a review)', () => {
  it('says the app reloads its screens and anything unsaved is lost', () => {
    expect(zoneChangeQuestion('Europe/London')).toEqual({
      title: 'Use Europe/London for the calendar?',
      message: 'The app reloads its screens to show every date in the new time zone. Anything you haven’t saved on other screens is lost.',
      confirm: 'Change time zone',
    });
    expect(zoneChangeQuestion(null).title).toBe('Use the company time zone for the calendar?');
  });

  it('knows when a save changes the zones the screens use', () => {
    expect(zonesDiffer({ company: 'Asia/Muscat', own: null }, { company: 'Asia/Muscat', own: 'Europe/London' })).toBe(true);
    expect(zonesDiffer({ company: 'Asia/Muscat', own: 'Europe/London' }, { company: 'Asia/Muscat', own: 'Europe/London' })).toBe(false);
  });
});

describe('what Settings does once the screens have reopened (6a review)', () => {
  it('keeps one note for the reopened Settings: where to return to and what to say, taken once', () => {
    const note = createReopenNote();
    expect(note.take()).toBeNull();
    note.leave({ section: 'dates', announce: 'Saved. The calendar uses Europe/London.' });
    expect(note.take()).toEqual({ section: 'dates', announce: 'Saved. The calendar uses Europe/London.' });
    expect(note.take()).toBeNull();
  });

  it('a note nobody took soon is forgotten (it belongs to that save only)', () => {
    let now = 1_000;
    const note = createReopenNote({ now: () => now, keepMs: 10_000 });
    note.leave({ section: 'dates', announce: 'Saved.' });
    now += 10_001;
    expect(note.take()).toBeNull();
  });
});
