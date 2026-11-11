import { describe, expect, it } from 'vitest';
import { daysOffRuns } from './days-off';

const cal = { workingDays: [0, 1, 2, 3, 4], holidays: [{ day: '2026-11-18', name: 'National Day' }, { day: '2026-11-19', name: 'National Day' }] };

describe('days off on a chart', () => {
  it('merges each run of days off, named by its holidays (else the weekend)', () => {
    // Sun 15 – Sat 21 Nov 2026: Wed 18 + Thu 19 holidays, then the Fri–Sat weekend — one run of four days.
    expect(daysOffRuns('2026-11-15', '2026-11-21', cal)).toEqual([{ start: '2026-11-18', days: 4, label: 'National Day', holiday: true }]);
    expect(daysOffRuns('2026-11-08', '2026-11-14', { workingDays: [0, 1, 2, 3, 4], holidays: [] })).toEqual([{ start: '2026-11-13', days: 2, label: 'Weekend', holiday: false }]);
  });

  it('lists different holidays in one run once each, and nothing for a range with no day off', () => {
    const two = { workingDays: [0, 1, 2, 3, 4], holidays: [{ day: '2027-03-09', name: 'Eid al-Fitr' }, { day: '2027-03-10', name: 'Eid al-Fitr' }, { day: '2027-03-11', name: 'Founders' }] };
    expect(daysOffRuns('2027-03-07', '2027-03-11', two)).toEqual([{ start: '2027-03-09', days: 3, label: 'Eid al-Fitr, Founders', holiday: true }]);
    expect(daysOffRuns('2026-11-15', '2026-11-17', cal)).toEqual([]);
  });
});
