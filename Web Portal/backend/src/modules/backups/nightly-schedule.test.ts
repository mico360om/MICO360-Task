import { describe, it, expect } from 'vitest';
import { nightlyDue, MAX_NIGHTLY_ATTEMPTS, NIGHTLY_HOUR, RETRY_AFTER_MS, type NightlyAttempt } from './nightly-schedule';

const TZ = 'Asia/Muscat';
const muscat = (day: string, hhmm: string) => new Date(`${day}T${hhmm}:00+04:00`);
const due = (now: Date, today: NightlyAttempt[] = [], running = false) => nightlyDue({ now, timeZone: TZ, today, running });
const failed = (hhmm: string, endHhmm = hhmm): NightlyAttempt => ({ status: 'FAILED', startedAt: muscat('2026-10-30', hhmm), finishedAt: muscat('2026-10-30', endHhmm) });

describe('when the nightly backup is due', () => {
  it('runs at 02:00 company time, not before', () => {
    expect(NIGHTLY_HOUR).toBe(2);
    expect(due(muscat('2026-10-30', '01:59'))).toBe(false);
    expect(due(muscat('2026-10-30', '02:00'))).toBe(true);
  });

  it('catches up later the same day when the server was off at 02:00', () => {
    expect(due(muscat('2026-10-30', '09:40'))).toBe(true);
  });

  it('once a day: not again after a good copy today', () => {
    expect(due(muscat('2026-10-30', '03:00'), [{ status: 'OK', startedAt: muscat('2026-10-30', '02:00'), finishedAt: muscat('2026-10-30', '02:01') }])).toBe(false);
  });

  it('not while a backup is being made', () => {
    expect(due(muscat('2026-10-30', '02:10'), [], true)).toBe(false);
    expect(due(muscat('2026-10-30', '02:10'), [{ status: 'RUNNING', startedAt: muscat('2026-10-30', '02:00'), finishedAt: null }])).toBe(false);
  });

  it('after a failure: tries again an hour later, three tries a day at most', () => {
    expect(RETRY_AFTER_MS).toBe(60 * 60 * 1000);
    expect(MAX_NIGHTLY_ATTEMPTS).toBe(3);
    expect(due(muscat('2026-10-30', '02:40'), [failed('02:00', '02:05')])).toBe(false);
    expect(due(muscat('2026-10-30', '03:05'), [failed('02:00', '02:05')])).toBe(true);
    expect(due(muscat('2026-10-30', '09:00'), [failed('02:00'), failed('03:10'), failed('04:20')])).toBe(false);
  });
});
