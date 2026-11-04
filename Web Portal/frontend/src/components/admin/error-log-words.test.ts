import { describe, it, expect } from 'vitest';
import { browserText, detailText, isNewSince, peopleText, personText, placeText, timesText, topFrameText } from './error-log-words';

describe('Error log words', () => {
  it('counts and people', () => {
    expect(timesText(1)).toBe('1 time');
    expect(timesText(1234)).toBe('1,234 times');
    expect(peopleText({ people: 1, kind: 'ERROR' })).toBe('1 person');
    expect(peopleText({ people: 3, kind: 'ERROR' })).toBe('3 people');
    expect(peopleText({ people: 0, kind: 'ERROR' })).toBe('No one signed in');
    expect(peopleText({ people: 0, kind: 'SERVER' })).toBe('No one in particular');
    expect(peopleText({ people: 500, kind: 'SLOW' })).toBe('500+ people');
  });

  it('new since the last visit: first seen, or back after being fixed, after it; never on a first visit', () => {
    const prev = '2026-11-05T08:00:00.000Z';
    expect(isNewSince({ firstSeenAt: '2026-11-05T09:00:00.000Z', reopenedAt: null }, prev)).toBe(true);
    expect(isNewSince({ firstSeenAt: '2026-11-01T09:00:00.000Z', reopenedAt: '2026-11-05T09:00:00.000Z' }, prev)).toBe(true);
    expect(isNewSince({ firstSeenAt: '2026-11-01T09:00:00.000Z', reopenedAt: null }, prev)).toBe(false);
    expect(isNewSince({ firstSeenAt: '2026-11-05T09:00:00.000Z', reopenedAt: null }, null)).toBe(false);
  });

  it('who, where, the browser and the top frame', () => {
    expect(personText({ person: { id: 'u1', name: 'Sara Ali' }, kind: 'ERROR', job: null })).toBe('Sara Ali');
    expect(personText({ person: { id: 'u1', name: null }, kind: 'ERROR', job: null })).toBe('Someone no longer here');
    expect(personText({ person: null, kind: 'ERROR', job: null })).toBe('Not signed in');
    expect(personText({ person: null, kind: 'SERVER', job: 'nightly-backup' })).toBe('Background job');
    expect(placeText({ page: '/board', job: null })).toBe('/board');
    expect(placeText({ page: null, job: 'nightly-backup' })).toBe('nightly-backup');
    expect(browserText({ browser: 'Chrome 130', system: 'Windows' })).toBe('Chrome 130 on Windows');
    expect(browserText({ browser: null, system: null })).toBe('');
    expect(topFrameText({ topFile: 'src/pages/BoardPage.tsx', topLine: 42, topFunction: 'loadBoard' })).toBe('src/pages/BoardPage.tsx:42 (loadBoard)');
    expect(topFrameText({ topFile: 'BoardPage.js', topLine: null, topFunction: null })).toBe('BoardPage.js');
    expect(topFrameText({ topFile: null, topLine: null, topFunction: null })).toBe('');
    expect(detailText('chunk')).toMatch(/didn’t load/);
    expect(detailText(null)).toBe('');
  });
});
