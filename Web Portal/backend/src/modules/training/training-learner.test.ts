import { describe, expect, it } from 'vitest';
import { orderAssigned, progressBody, tourShows, watchFallbackSeconds } from './training-learner';

const launched = new Date('2026-11-15T00:00:00Z');
const later = new Date('2026-11-20T00:00:00Z');
const earlier = new Date('2026-11-01T00:00:00Z');

describe('R15 the first-time tour', () => {
  const staff = { client: false, createdAt: later, tourDoneAt: null, primaryCompanyId: 'A', companyIds: ['A', 'B'] };
  it('only for accounts made after the Training Center launched, until they finish or skip it', () => {
    expect(tourShows({ ...staff, launchedAt: launched, off: [] })).toBe(true);
    expect(tourShows({ ...staff, launchedAt: null, off: [] })).toBe(false);
    // R20: TRAINING_TOUR_AUTO=off (test servers): never on its own; the person can still replay it.
    expect(tourShows({ ...staff, launchedAt: launched, off: [], auto: false })).toBe(false);
    expect(tourShows({ ...staff, launchedAt: launched, off: [], auto: true })).toBe(true);
    expect(tourShows({ ...staff, createdAt: earlier, launchedAt: launched, off: [] })).toBe(false);
    expect(tourShows({ ...staff, tourDoneAt: later, launchedAt: launched, off: [] })).toBe(false);
  });
  it('staff: their primary company (else their first) switched it off', () => {
    expect(tourShows({ ...staff, launchedAt: launched, off: ['A'] })).toBe(false);
    expect(tourShows({ ...staff, launchedAt: launched, off: ['B'] })).toBe(true);
    expect(tourShows({ ...staff, primaryCompanyId: null, launchedAt: launched, off: ['A'] })).toBe(false);
  });
  it('clients: off only when every company of their projects switched it off', () => {
    const client = { ...staff, client: true, primaryCompanyId: null };
    expect(tourShows({ ...client, launchedAt: launched, off: ['A'] })).toBe(true);
    expect(tourShows({ ...client, launchedAt: launched, off: ['A', 'B'] })).toBe(false);
    expect(tourShows({ ...client, companyIds: [], launchedAt: launched, off: ['A'] })).toBe(true);
  });
});

describe('My training lists', () => {
  it('assigned: mandatory first, then the due day (none last), then the title', () => {
    const card = (title: string, mandatory: boolean, dueDay: string | null) => ({ title, mine: { mandatory, dueDay } });
    const out = orderAssigned([card('B', false, '2026-11-12'), card('C', true, null), card('A', true, '2026-11-20'), card('D', true, '2026-11-13'), card('A2', false, null)]);
    expect(out.map((c) => c.title)).toEqual(['D', 'A', 'C', 'B', 'A2']);
  });
});

describe('lesson details', () => {
  it('“Mark as watched” after half the lesson’s minutes, at least 30 s', () => {
    expect(watchFallbackSeconds(5)).toBe(150);
    expect(watchFallbackSeconds(0)).toBe(30);
    expect(watchFallbackSeconds(1)).toBe(30);
  });
  it('progress saves: whole numbers in range only', () => {
    expect(progressBody.parse({ videoSeconds: 12, videoDuration: 300, watchedPct: 4, stepIndex: 2 })).toEqual({ videoSeconds: 12, videoDuration: 300, watchedPct: 4, stepIndex: 2 });
    expect(progressBody.parse({})).toEqual({});
    for (const bad of [{ videoSeconds: -1 }, { watchedPct: 101 }, { videoSeconds: 1.5 }, { stepIndex: 'x' }, { videoDuration: 0 }, { videoSeconds: 86_401 }]) expect(() => progressBody.parse(bad)).toThrow();
  });
});
