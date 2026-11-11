import { describe, expect, it } from 'vitest';
import { POLICY_KINDS } from '../api/notification-settings';
import { KIND_WORDS, momentText, pauseChoices, workingDaysText } from './notify-kinds';

describe('notice kinds in words', () => {
  it('names every kind', () => {
    for (const k of POLICY_KINDS) expect(KIND_WORDS[k].label, k).toBeTruthy();
    expect(KIND_WORDS.dueSoon.label).toBe('Approaching deadlines');
    expect(KIND_WORDS.escalation.label).toBe('Escalations (projects I run)');
  });

  it('writes working days as a run or a list', () => {
    expect(workingDaysText([0, 1, 2, 3, 4])).toBe('Sun–Thu');
    expect(workingDaysText([0, 2, 4])).toBe('Sun, Tue, Thu');
  });

  it('offers Pause for an hour, the rest of today and until the week starts, in the person’s own zone', () => {
    // Wednesday 11 Nov 2026, 15:00 in Muscat.
    const now = new Date('2026-11-11T11:00:00Z');
    expect(pauseChoices(now, 'Asia/Muscat', 0)).toEqual([
      { key: 'hour', label: '1 hour', until: '2026-11-11T12:00:00.000Z' },
      { key: 'today', label: 'Rest of today', until: '2026-11-11T20:00:00.000Z' },
      { key: 'week', label: 'Until Sunday', until: '2026-11-14T20:00:00.000Z' },
    ]);
    // On a Sunday, "until Sunday" is the next one.
    expect(pauseChoices(new Date('2026-11-15T05:00:00Z'), 'Asia/Muscat', 0)[2]!.until).toBe('2026-11-21T20:00:00.000Z');
  });

  it('writes an instant the site’s way', () => {
    expect(momentText('2026-11-15T04:00:00Z', 'Asia/Muscat')).toBe('Sun 15 Nov, 08:00');
  });
});
