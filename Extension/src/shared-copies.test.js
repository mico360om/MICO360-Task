import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import * as extDue from './due-date.js';
import * as extRecurrence from './recurrence.js';

// The extension keeps plain-JavaScript copies of rules the web app and the server own: the due-day
// rules (Web Portal/frontend/src/lib/due-date.ts) and the repeat summary
// (Web Portal/backend/src/modules/tasks/recurrence-summary.ts, itself a copy of the web's). The
// copies can't be compared as text, so these run both over the same inputs and fail when the
// answers drift (skipped where the web app isn't checked out next to the extension).
const repo = resolve(__dirname, '../..');
const WEB_DUE = resolve(repo, 'Web Portal/frontend/src/lib/due-date.ts');
const SERVER_SUMMARY = resolve(repo, 'Web Portal/backend/src/modules/tasks/recurrence-summary.ts');
const load = (file) => (existsSync(file) ? import(pathToFileURL(file).href) : null);
const webDue = await load(WEB_DUE);
const serverSummary = await load(SERVER_SUMMARY);

/** Every [args…] combination of the given lists. */
const product = (...lists) => lists.reduce((acc, list) => acc.flatMap((a) => list.map((x) => [...a, x])), [[]]);

describe.skipIf(!webDue)('due dates: src/due-date.js matches the web app (lib/due-date.ts)', () => {
  // The functions both have, under the same names. A rename on the web fails here, not silently.
  const SHARED = ['zonedDayKey', 'todayKey', 'dueDayKey', 'shiftDayKey', 'daysUntilDue', 'isOverdue', 'isDueToday'];
  const ZONES = ['Asia/Muscat', 'UTC', 'Asia/Kolkata', 'Europe/London', 'America/Los_Angeles', 'Pacific/Kiritimati', 'Pacific/Pago_Pago'];
  const DUES = [
    null, undefined, '', 'not a date', '2026-09-30', '2026-02-29', '2028-02-29',
    '2026-09-30T00:00:00.000Z', '2026-09-30T00:00:00Z', '2026-09-29T20:00:00.000Z', '2026-09-30T23:59:59.999Z',
    '2026-03-29T01:30:00Z', '2026-11-01T09:30:00Z', '2026-12-31T21:00:00+03:00', '2027-01-01T00:00:00.001Z',
    new Date('2026-09-30T00:00:00Z'), new Date('2026-09-30T05:00:00Z'), Date.UTC(2026, 8, 30), Date.UTC(2026, 8, 30, 22),
  ];
  const NOWS = [
    '2026-09-29T19:59:59Z', '2026-09-29T20:00:00Z', '2026-09-30T05:00:00Z', '2026-09-30T23:30:00Z',
    '2026-10-01T09:00:00Z', '2026-12-31T22:00:00Z', '2026-03-29T00:59:00Z', '2026-11-01T08:59:00Z',
  ].map((s) => new Date(s));
  const KEYS = ['2026-01-31', '2026-02-28', '2028-02-28', '2026-03-28', '2026-10-31', '2026-12-31', '2026-09-30'];

  it('exports the same day rules', () => {
    for (const name of SHARED) {
      expect(typeof extDue[name], `extension ${name}`).toBe('function');
      expect(typeof webDue[name], `web ${name}`).toBe('function');
    }
  });

  it('gives the same calendar day for an instant, and the same "today", in every zone', () => {
    for (const [now, zone] of product(NOWS, ZONES)) {
      expect(extDue.zonedDayKey(now, zone), `${now.toISOString()} ${zone}`).toBe(webDue.zonedDayKey(now, zone));
      expect(extDue.todayKey(zone, now), `${now.toISOString()} ${zone}`).toBe(webDue.todayKey(zone, now));
    }
  });

  it('reads a stored due date as the same day', () => {
    for (const [due, zone] of product(DUES, ZONES)) {
      expect(extDue.dueDayKey(due, zone), `${String(due)} ${zone}`).toBe(webDue.dueDayKey(due, zone));
    }
  });

  it('moves a day key the same way across months, years and leap days', () => {
    for (const [key, days] of product(KEYS, [-400, -31, -1, 0, 1, 28, 29, 365, 366])) {
      expect(extDue.shiftDayKey(key, days), `${key} ${days}`).toBe(webDue.shiftDayKey(key, days));
    }
  });

  it('agrees on days until due, overdue and due today', () => {
    for (const [due, zone, now] of product(DUES, ZONES, NOWS)) {
      const at = `${String(due)} ${zone} ${now.toISOString()}`;
      expect(extDue.daysUntilDue(due, zone, now), at).toBe(webDue.daysUntilDue(due, zone, now));
      expect(extDue.isOverdue(due, zone, now), at).toBe(webDue.isOverdue(due, zone, now));
      expect(extDue.isDueToday(due, zone, now), at).toBe(webDue.isDueToday(due, zone, now));
    }
  });
});

describe.skipIf(!serverSummary)('repeat summaries: src/recurrence.js matches the server (recurrence-summary.ts)', () => {
  /** Rules covering every part of a summary: each frequency, interval, days, end, schedule mode and pause. */
  function rules() {
    const days = {
      DAILY: [{}],
      WEEKLY: [{}, { weekdays: [] }, { weekdays: [3] }, { weekdays: [6, 0, 3] }],
      MONTHLY: [{}, { dayOfMonth: 1 }, { dayOfMonth: 15 }, { dayOfMonth: 31 },
        ...[1, 2, 3, 4, -1].map((week) => ({ nthWeekday: { week, day: (week + 7) % 7 } })), { nthWeekday: { week: 2, day: 0 }, dayOfMonth: 9 }],
      YEARLY: [{}],
    };
    days.QUARTERLY = days.MONTHLY;
    const ends = [{}, { count: 1 }, { count: 12 }, { until: '2026-12-31' }, { until: '2027-03-31T00:00:00.000Z' }, { count: null, until: null }];
    const modes = [{}, { createNext: 'ON_COMPLETE' }, { createNext: 'ON_SCHEDULE' }];
    const paused = [{}, { paused: false }, { paused: true }];
    return Object.keys(days).flatMap((freq) => product([1, 2, 12], days[freq], ends, modes, paused)
      .map(([interval, ...parts]) => Object.assign({ freq, interval }, ...parts)));
  }

  it('words every rule the same way', () => {
    const all = rules();
    expect(all.length).toBeGreaterThan(1000);
    for (const rule of all) {
      expect(extRecurrence.recurrenceSummary(rule), JSON.stringify(rule)).toBe(serverSummary.recurrenceSummary(rule));
    }
  });

  it('names weekdays and weeks of the month the same way', () => {
    expect(extRecurrence.WEEKDAY_NAMES).toEqual(serverSummary.WEEKDAY_NAMES);
    expect(extRecurrence.WEEK_OF_MONTH).toEqual(serverSummary.WEEK_OF_MONTH);
  });
});
