import { describe, expect, it } from 'vitest';
import { draftOf, readDays, readSchedule, scheduleText } from './schedule-words';

describe('reminder schedules in words', () => {
  it('says Standard and Critical the way the owner described them', () => {
    expect(scheduleText({ before: [2], onDue: true, after: [1], repeatEvery: 2 })).toBe(
      '2 working days before · on the due morning · 1 working day after · then every 2 working days while overdue',
    );
    expect(scheduleText({ before: [5, 2, 1], onDue: true, after: [], repeatEvery: 1 })).toBe('5, 2 and 1 working days before · on the due morning · then every working day while overdue');
    expect(scheduleText({ before: [], onDue: false, after: [], repeatEvery: null })).toBe('No reminders');
  });

  it('reads typed day lists', () => {
    expect(readDays('5, 2 1')).toEqual([5, 2, 1]);
    expect(readDays('')).toEqual([]);
    expect(readDays('0')).toBeNull();
    expect(readDays('two')).toBeNull();
    expect(readDays('31')).toBeNull();
  });

  it('reads the editor into steps, or says what is wrong', () => {
    expect(readSchedule({ before: '1, 5', onDue: true, after: '3, 1', repeat: '2' })).toEqual({ ok: true, steps: { before: [5, 1], onDue: true, after: [1, 3], repeatEvery: 2 } });
    expect(readSchedule({ before: '', onDue: false, after: '', repeat: '' })).toEqual({ ok: false, problem: 'Choose at least one reminder.' });
    expect(readSchedule({ before: 'x', onDue: true, after: '', repeat: '' }).ok).toBe(false);
    expect(readSchedule({ before: '', onDue: true, after: '', repeat: '11' }).ok).toBe(false);
    expect(draftOf({ before: [5, 2], onDue: true, after: [1], repeatEvery: null })).toEqual({ before: '5, 2', onDue: true, after: '1', repeat: '' });
  });
});
