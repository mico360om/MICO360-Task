import { describe, it, expect } from 'vitest';
import { browserText, detailText, interactionWords, isNewSince, KIND_FILTERS, KIND_WORDS, lastTimeText, pageTimeNote, partsText, peopleText, personText, placeText, slowTimingText, timesText, topFrameText } from './error-log-words';

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

// 1.23.14 — where a slow request's time went, from the browser's own timing: the biggest part said in plain
// words (the owner's example: "waited 9.8 s before the server started answering; the server itself took …").
describe('Error log words: where the time went, from the browser (1.23.14)', () => {
  const t = (over: Record<string, number | null>) => ({ totalMs: 10_550, serverMs: 48, dbMs: 12, queueMs: 0, connectMs: 30, waitMs: 10_400, downloadMs: 120, ...over });

  it('waiting for the first byte while the server itself was quick: the hold-up was on the way', () => {
    expect(slowTimingText(t({}))).toBe('waited 10.4 s before the server started answering; the server itself took under 0.1 s — the hold-up was between the browser and the server (the hosting’s front door or the connection)');
    expect(slowTimingText(t({ serverMs: null, dbMs: null }))).toBe('waited 10.4 s before the server started answering (the server didn’t say its own time)');
  });

  it('the server itself, a slow download, a slow connection, or no free connection', () => {
    expect(slowTimingText(t({ serverMs: 10_300, dbMs: 9_800 }))).toBe('the server took 10.3 s · in the database 9.8 s');
    expect(slowTimingText(t({ waitMs: 400, downloadMs: 10_100 }))).toBe('downloading the answer took 10.1 s');
    expect(slowTimingText(t({ waitMs: 300, connectMs: 10_200 }))).toBe('connecting to the server took 10.2 s (a slow or changing connection)');
    expect(slowTimingText(t({ waitMs: 300, queueMs: 10_200 }))).toBe('the browser waited 10.2 s before sending it (no free connection)');
  });

  it('the row: the last time’s whole wait first; the occurrence: each part', () => {
    expect(lastTimeText(t({ waitMs: 400, downloadMs: 10_100 }))).toBe('Last time 10.6 s: downloading the answer took 10.1 s');
    expect(partsText(t({}))).toBe('Waiting for a connection under 0.1 s · connecting under 0.1 s · waiting for the first byte 10.4 s · downloading 0.1 s');
    expect(partsText({ totalMs: 10_200, serverMs: 9900, dbMs: 9700 })).toBe(''); // an older report: no parts
  });
});

describe('Error log words: update restarts and page times (1.23.14)', () => {
  it('an update restart is its own calm kind, with the Server chip', () => {
    expect(KIND_WORDS.UPDATE).toEqual({ label: 'Update restart', tone: 'neutral' });
    expect(KIND_FILTERS.find((f) => f.key === 'server')!.hint).toBe('Failed requests and background jobs on the server, and update restarts');
    expect(peopleText({ people: 0, kind: 'UPDATE' })).toBe('No one in particular');
    expect(personText({ person: null, kind: 'UPDATE', job: 'daily-task-emails' })).toBe('Background job');
    expect(detailText('slow')).toBe('Request held up while the server started');
  });

  it('page-show rows say their times count only while the page is on screen; no other row does', () => {
    expect(pageTimeNote({ kind: 'SLOW', title: 'Slow to show the page' })).toBe('Counted only while the page is on screen — older entries may include time it spent in the background.');
    expect(pageTimeNote({ kind: 'SLOW', title: 'Slow page load' })).not.toBe('');
    expect(pageTimeNote({ kind: 'SLOW', title: 'Slow request: GET /api/v1/tasks' })).toBe('');
    expect(pageTimeNote({ kind: 'ERROR', title: 'Slow to show the page' })).toBe('');
  });

  it('a slow click or key press says what it was on', () => {
    expect(interactionWords({ detail: 'inp', resource: 'a click on a button' })).toBe('On a click on a button');
    expect(interactionWords({ detail: 'inp', resource: null })).toBe('');
    expect(interactionWords({ detail: 'api', resource: 'GET /api/v1/tasks' })).toBe('');
  });
});

describe('Error log words: a request held up by an update restart (1.23.14 review)', () => {
  it('says the server was starting, not a hold-up on the way', () => {
    const t = { totalMs: 15_900, serverMs: 7, dbMs: 4, queueMs: 0, connectMs: 0, waitMs: 15_900, downloadMs: 0 };
    expect(slowTimingText(t, 'UPDATE')).toBe('waited 15.9 s while the server started; the server itself then took under 0.1 s');
    expect(lastTimeText(t, 'UPDATE')).toBe('Last time 15.9 s: waited 15.9 s while the server started; the server itself then took under 0.1 s');
    expect(detailText('stopping')).toBe('While the server stopped');
    expect(detailText('starting')).toBe('While the server started (an update or a restart)');
  });
});
