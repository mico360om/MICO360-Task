import { describe, it, expect } from 'vitest';
import { boardDateKey, boardDateFromKey, planCarryForward, type CarryTask } from './board-date';

describe('boardDateKey / boardDateFromKey', () => {
  it('formats an instant as a YYYY-MM-DD key in the given time zone', () => {
    // 2026-09-09 22:00 UTC is already 2026-09-10 02:00 in Muscat (+4).
    const d = new Date('2026-09-09T22:00:00.000Z');
    expect(boardDateKey(d, 'Asia/Muscat')).toBe('2026-09-10');
    expect(boardDateKey(d, 'UTC')).toBe('2026-09-09');
  });

  it('round-trips a key through a noon-UTC anchor so the calendar day is stable across realistic zones', () => {
    const anchor = boardDateFromKey('2026-09-09');
    expect(boardDateKey(anchor, 'Asia/Muscat')).toBe('2026-09-09'); // +4
    expect(boardDateKey(anchor, 'Pacific/Honolulu')).toBe('2026-09-09'); // -10
    expect(boardDateKey(anchor, 'America/New_York')).toBe('2026-09-09'); // -4
  });
});

describe('planCarryForward', () => {
  const tz = 'UTC';
  const now = new Date('2026-09-09T09:00:00.000Z');
  const today = '2026-09-09';
  const config = { enabled: true, statuses: ['BACKLOG', 'TODO', 'IN_PROGRESS', 'BLOCKED', 'REVIEW'] };

  const task = (over: Partial<CarryTask>): CarryTask => ({
    id: 't', columnCategory: 'TODO', completedAt: null, boardDate: boardDateFromKey('2026-09-08'), ...over,
  });

  it('carries an open task whose board date is before today', () => {
    const plans = planCarryForward([task({ id: 'a' })], today, config, tz, now);
    expect(plans).toHaveLength(1);
    expect(plans[0]).toMatchObject({ id: 'a', toKey: today });
    expect(plans[0]!.logEntry).toEqual({ from: '2026-09-08', to: '2026-09-09', at: now.toISOString() });
  });

  it('does not carry a task already on today', () => {
    expect(planCarryForward([task({ boardDate: boardDateFromKey(today) })], today, config, tz, now)).toEqual([]);
  });

  it('does not carry a completed task (DONE column or completedAt set), keeping it on its day', () => {
    expect(planCarryForward([task({ columnCategory: 'DONE' })], today, config, tz, now)).toEqual([]);
    expect(planCarryForward([task({ completedAt: new Date('2026-09-08T10:00:00Z') })], today, config, tz, now)).toEqual([]);
  });

  it('does not carry a status excluded by config', () => {
    const cfg = { enabled: true, statuses: ['TODO'] };
    expect(planCarryForward([task({ columnCategory: 'BACKLOG' })], today, cfg, tz, now)).toEqual([]);
  });

  it('carries nothing when disabled', () => {
    expect(planCarryForward([task({})], today, { enabled: false, statuses: config.statuses }, tz, now)).toEqual([]);
  });
});
