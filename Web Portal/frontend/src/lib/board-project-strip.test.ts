import { describe, expect, it } from 'vitest';
import { projectDates, projectPlace, projectPeople } from './board-project-strip';

// The Kanban board's project strip (owner, 10 Nov): the words of its dates, its company or client and its managers.
const TZ = 'Asia/Muscat';
const p = (startDate: string | null, targetDate: string | null, status = 'ACTIVE') => ({ startDate, targetDate, status });

describe('projectDates', () => {
  it('start – end, the year only when it isn’t this year, and the days left', () => {
    expect(projectDates(p('2026-10-12T00:00:00.000Z', '2026-12-20T00:00:00.000Z'), '2026-11-10', TZ)).toEqual({ range: '12 Oct – 20 Dec', left: { text: '40 days left', late: false } });
    expect(projectDates(p('2026-10-12', '2027-01-15'), '2026-11-10', TZ).range).toBe('12 Oct – 15 Jan 2027');
  });

  it('late once the end day has passed; the last day, and one day, said plainly', () => {
    expect(projectDates(p(null, '2026-11-07'), '2026-11-10', TZ).left).toEqual({ text: '3 days late', late: true });
    expect(projectDates(p(null, '2026-11-09'), '2026-11-10', TZ).left).toEqual({ text: '1 day late', late: true });
    expect(projectDates(p(null, '2026-11-10'), '2026-11-10', TZ).left).toEqual({ text: 'Ends today', late: false });
    expect(projectDates(p(null, '2026-11-11'), '2026-11-10', TZ).left).toEqual({ text: '1 day left', late: false });
  });

  it('only one date, or none', () => {
    expect(projectDates(p('2026-10-12', null), '2026-11-10', TZ)).toEqual({ range: 'From 12 Oct', left: null });
    expect(projectDates(p(null, '2026-12-20'), '2026-11-10', TZ).range).toBe('Until 20 Dec');
    expect(projectDates(p(null, null), '2026-11-10', TZ)).toEqual({ range: null, left: null });
  });

  it('a finished project shows its dates, never days left or late', () => {
    expect(projectDates(p('2026-10-12', '2026-11-01', 'COMPLETED'), '2026-11-10', TZ)).toEqual({ range: '12 Oct – 1 Nov', left: null });
    expect(projectDates(p(null, '2026-11-01', 'ARCHIVED'), '2026-11-10', TZ).left).toBeNull();
  });
});

describe('projectPlace', () => {
  it('its client when it has one, else its main company', () => {
    const companies = [{ name: 'Prolens Projects LLC', isMain: true }, { name: 'Other Co', isMain: false }];
    expect(projectPlace({ clientName: 'Acme Oman', companies })).toEqual({ label: 'Client', name: 'Acme Oman' });
    expect(projectPlace({ clientName: null, companies })).toEqual({ label: 'Company', name: 'Prolens Projects LLC' });
    expect(projectPlace({ clientName: '  ', companies: [] })).toBeNull();
  });
});

describe('projectPeople', () => {
  it('its project managers, else its owner', () => {
    expect(projectPeople({ managers: [{ name: 'Bilal' }, { name: 'Sara' }], owner: { name: 'Olivia' } })).toEqual({ label: 'Project managers', names: 'Bilal, Sara' });
    expect(projectPeople({ managers: [{ name: 'Bilal' }], owner: null })).toEqual({ label: 'Project manager', names: 'Bilal' });
    expect(projectPeople({ managers: [], owner: { name: 'Olivia' } })).toEqual({ label: 'Owner', names: 'Olivia' });
    expect(projectPeople({ managers: [], owner: null })).toBeNull();
  });
});
