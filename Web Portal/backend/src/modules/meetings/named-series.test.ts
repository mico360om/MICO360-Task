import { describe, it, expect } from 'vitest';
import { familyRootOf, latestOf, placeOf, prefillLink, samePlace, seriesNav, type SeriesMeetingRow } from './named-series';

const row = (id: string, day: number, status: SeriesMeetingRow['status'] = 'SCHEDULED'): SeriesMeetingRow => ({
  id, title: `Meeting ${id}`, status, startAt: new Date(Date.UTC(2026, 10, day, 6)), endAt: null, timeZone: null, projectId: 'p1', companyId: null,
  organizerId: 'u1', createdById: 'u1', attendeeUserIds: [], familyRootId: null, seriesId: 's1', minutesFinal: false,
});

describe('seriesNav: "3 of 5", Previous and Next', () => {
  const shown = [row('e', 20), row('a', 1), row('c', 10), row('b', 5), row('d', 15)];

  it('places the meeting among the meetings shown, in date order', () => {
    expect(seriesNav(shown, 'c')).toMatchObject({ position: 3, total: 5, previous: { id: 'b' }, next: { id: 'd' } });
    expect(seriesNav(shown, 'a')).toMatchObject({ position: 1, previous: null, next: { id: 'b' } });
    expect(seriesNav(shown, 'e')).toMatchObject({ position: 5, previous: { id: 'd' }, next: null });
  });

  it('skips cancelled meetings in the count and the neighbours', () => {
    const list = [row('a', 1), row('b', 5, 'CANCELLED'), row('c', 10), row('d', 15, 'CANCELLED'), row('e', 20)];
    expect(seriesNav(list, 'c')).toMatchObject({ position: 2, total: 3, previous: { id: 'a' }, next: { id: 'e' } });
    // A cancelled meeting itself has no place, but still its neighbours.
    expect(seriesNav(list, 'b')).toMatchObject({ position: null, total: 3, previous: { id: 'a' }, next: { id: 'c' } });
  });

  it('counts nothing when only this meeting is shown (just the series name)', () => {
    expect(seriesNav([row('a', 1)], 'a')).toEqual({ position: null, total: 1, previous: null, next: null });
  });

  it('keeps meetings at the same time in a stable order', () => {
    const same = [row('y', 3), row('x', 3)];
    expect(seriesNav(same, 'x')).toMatchObject({ position: 1, next: { id: 'y' } });
  });
});

describe('the place rule', () => {
  it('is the project, else the company', () => {
    expect(placeOf({ projectId: 'p1', companyId: 'c1' })).toEqual({ projectId: 'p1', companyId: null });
    expect(placeOf({ projectId: null, companyId: 'c1' })).toEqual({ projectId: null, companyId: 'c1' });
    expect(samePlace({ projectId: 'p1' }, { projectId: 'p1', companyId: 'c9' })).toBe(true);
    expect(samePlace({ projectId: 'p1' }, { projectId: 'p2' })).toBe(false);
    expect(samePlace({ projectId: null, companyId: 'c1' }, { projectId: null, companyId: 'c1' })).toBe(true);
    expect(samePlace({ projectId: null, companyId: 'c1' }, { projectId: null, companyId: 'c2' })).toBe(false);
    expect(samePlace({ projectId: null, companyId: 'c1' }, { projectId: 'p1' })).toBe(false);
  });
});

describe('repeat families', () => {
  it('names the first meeting of a family', () => {
    expect(familyRootOf({ id: 'm1', recurrenceParentId: null, recurrenceRule: { freq: 'WEEKLY' } })).toBe('m1');
    expect(familyRootOf({ id: 'm2', recurrenceParentId: 'm1', recurrenceRule: null })).toBe('m1');
    expect(familyRootOf({ id: 'm3', recurrenceParentId: null, recurrenceRule: null })).toBeNull();
  });
});

describe('New meeting in this series', () => {
  it('copies from the latest meeting going ahead, else the latest', () => {
    expect(latestOf([row('a', 1), row('b', 9), row('c', 5)])?.id).toBe('b');
    expect(latestOf([row('a', 1), row('b', 9, 'CANCELLED')])?.id).toBe('a');
    expect(latestOf([row('b', 9, 'CANCELLED')])?.id).toBe('b');
    expect(latestOf([])).toBeNull();
  });

  it('starts with the latest meeting’s online link', () => {
    expect(prefillLink({ onlineLink: 'https://meet.example.com/x' })).toEqual({ onlineLink: 'https://meet.example.com/x' });
    expect(prefillLink({ onlineLink: null })).toEqual({ onlineLink: null });
  });
});
