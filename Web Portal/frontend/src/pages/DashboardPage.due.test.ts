import { describe, expect, it } from 'vitest';
import { dueMeta } from './DashboardPage';

// Notification & Scheduling centre: the Dashboard's "overdue" badge counts working days (as Management
// and the daily email do) once the company's calendar is known; calendar days before it loads.
describe('the Dashboard’s due badge', () => {
  const now = new Date('2026-11-15T08:00:00Z'); // Sunday 15 Nov 2026, noon in Muscat
  const cal = { workingDays: [0, 1, 2, 3, 4], holidays: [] };

  it('a task due Thursday is 1 working day overdue on Sunday', () => {
    expect(dueMeta('2026-11-12T00:00:00.000Z', 'Asia/Muscat', cal, now)).toEqual({ label: '1 working day overdue', overdue: true });
    expect(dueMeta('2026-11-12T00:00:00.000Z', 'Asia/Muscat', null, now)).toEqual({ label: '3d overdue', overdue: true });
  });

  it('late only by days off: "Overdue"', () => {
    expect(dueMeta('2026-11-13T00:00:00.000Z', 'Asia/Muscat', { workingDays: [1, 2, 3, 4], holidays: [] }, now)).toEqual({ label: 'Overdue', overdue: true });
  });

  it('not yet due: as before', () => {
    expect(dueMeta('2026-11-15T00:00:00.000Z', 'Asia/Muscat', cal, now)).toEqual({ label: 'Due today', overdue: false });
    expect(dueMeta('2026-11-16T00:00:00.000Z', 'Asia/Muscat', cal, now)).toEqual({ label: 'Due tomorrow', overdue: false });
  });
});
