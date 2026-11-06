import { describe, it, expect } from 'vitest';
import { browserText, detailText, isNewSince, lastTimeText, peopleText, personText, placeText, slowTimingText, timesText, topFrameText } from './error-log-words';

// 1.23.3 — where a slow request's time went: the server's own time, the database's part of it when the
// server's part matters (a second or more), and the network when the server's part is under half the whole.
describe('Error log words: where a slow request’s time went', () => {
  it('in the database', () => {
    expect(slowTimingText({ totalMs: 10_200, serverMs: 9900, dbMs: 9700 })).toBe('server 9.9 s · in the database 9.7 s');
    expect(slowTimingText({ totalMs: 10_200, serverMs: 9900, dbMs: 200 })).toBe('server 9.9 s · in the database 0.2 s'); // the server's own work
  });

  it('the network', () => {
    expect(slowTimingText({ totalMs: 12_000, serverMs: 100, dbMs: 40 })).toBe('server 0.1 s · the rest was the network');
    expect(slowTimingText({ totalMs: 12_000, serverMs: 30, dbMs: 10 })).toBe('server under 0.1 s · the rest was the network');
    expect(slowTimingText({ totalMs: 10_200, serverMs: 4000, dbMs: 3900 })).toBe('server 4.0 s · in the database 3.9 s · the rest was the network');
    expect(slowTimingText({ totalMs: 10_200, serverMs: 1500, dbMs: 20 })).toBe('server 1.5 s · in the database under 0.1 s · the rest was the network');
  });

  it('only what is known', () => {
    expect(slowTimingText({ totalMs: 10_200, serverMs: 9900, dbMs: null })).toBe('server 9.9 s');
    expect(slowTimingText({ totalMs: null, serverMs: 100, dbMs: 40 })).toBe('server 0.1 s');
    expect(slowTimingText(null)).toBe('');
    expect(slowTimingText(undefined)).toBe('');
  });

  it('a row says it of the last time, with that time’s whole wait', () => {
    expect(lastTimeText({ totalMs: 10_200, serverMs: 9900, dbMs: 9700 })).toBe('Last time 10.2 s: server 9.9 s · in the database 9.7 s');
    expect(lastTimeText({ totalMs: null, serverMs: 9900, dbMs: 9700 })).toBe('Last time: server 9.9 s · in the database 9.7 s');
    expect(lastTimeText(null)).toBe('');
  });
});

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
