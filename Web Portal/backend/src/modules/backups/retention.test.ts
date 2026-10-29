import { describe, it, expect } from 'vitest';
import { planRetention, type RetentionCopy } from './retention';

const TZ = 'Asia/Muscat';
/** A copy made at hh:mm company time (Muscat is UTC+4) on a company date. */
const at = (day: string, hhmm = '02:00'): Date => new Date(`${day}T${hhmm}:00+04:00`);
const copy = (day: string, hhmm = '02:00'): RetentionCopy => ({ id: `${day}@${hhmm}`, createdAt: at(day, hhmm) });

function days(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = new Date(`${from}T12:00:00Z`); d <= new Date(`${to}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) out.push(d.toISOString().slice(0, 10));
  return out;
}

const kept = (plan: ReturnType<typeof planRetention>, kind: 'nightly' | 'weekly') =>
  [...plan.keep.entries()].filter(([, k]) => k === kind).map(([id]) => id.slice(0, 10)).sort().reverse();

describe('retention: 7 nightly + 4 weekly copies (company calendar)', () => {
  // Every night from 1 September to Friday 30 October 2026, at 02:00 Muscat time (22:00 UTC the day before).
  const sixtyNights = days('2026-09-01', '2026-10-30').map((d) => copy(d));

  it('keeps the newest 7 nights and the last copy of each of the 4 weeks before them (weeks start on Sunday)', () => {
    const plan = planRetention(sixtyNights, { timeZone: TZ, weekStart: 0 });
    expect(kept(plan, 'nightly')).toEqual(['2026-10-30', '2026-10-29', '2026-10-28', '2026-10-27', '2026-10-26', '2026-10-25', '2026-10-24']);
    // The week of 18–24 October still holds a nightly copy (the 24th), so the 4 weeks are the ones before it.
    expect(kept(plan, 'weekly')).toEqual(['2026-10-17', '2026-10-10', '2026-10-03', '2026-09-26']);
    expect(plan.keep.size).toBe(11);
    expect(plan.remove).toHaveLength(60 - 11);
    expect(new Set([...plan.remove, ...plan.keep.keys()]).size).toBe(60);
  });

  it('follows the company week start: Monday and Saturday', () => {
    expect(kept(planRetention(sixtyNights, { timeZone: TZ, weekStart: 1 }), 'weekly')).toEqual(['2026-10-18', '2026-10-11', '2026-10-04', '2026-09-27']);
    expect(kept(planRetention(sixtyNights, { timeZone: TZ, weekStart: 6 }), 'weekly')).toEqual(['2026-10-23', '2026-10-16', '2026-10-09', '2026-10-02']);
  });

  it('uses the company date, not the UTC date (02:00 Muscat is still the day before in UTC)', () => {
    const plan = planRetention([copy('2026-10-30', '02:00'), copy('2026-10-29', '23:30')], { timeZone: TZ, weekStart: 0 });
    expect([...plan.keep.keys()].sort()).toEqual(['2026-10-29@23:30', '2026-10-30@02:00']);
  });

  it('two copies on one day ("Back up now" and the nightly one): the newer is kept', () => {
    const plan = planRetention([copy('2026-10-30', '02:00'), copy('2026-10-30', '14:10'), copy('2026-10-29')], { timeZone: TZ, weekStart: 0 });
    expect([...plan.keep.keys()].sort()).toEqual(['2026-10-29@02:00', '2026-10-30@14:10']);
    expect(plan.remove).toEqual(['2026-10-30@02:00']);
  });

  it('fewer than 7 copies: all of them are kept as nightly copies', () => {
    const plan = planRetention(days('2026-10-27', '2026-10-30').map((d) => copy(d)), { timeZone: TZ, weekStart: 0 });
    expect(plan.keep.size).toBe(4);
    expect([...plan.keep.values()].every((k) => k === 'nightly')).toBe(true);
    expect(plan.remove).toEqual([]);
    expect(planRetention([], { timeZone: TZ, weekStart: 0 })).toEqual({ keep: new Map(), remove: [] });
  });

  it('gaps (the server was off for weeks): the newest 7 copies, then one from each older week that has copies', () => {
    const list = [...days('2026-10-20', '2026-10-30'), '2026-09-02', '2026-08-15', '2026-08-14', '2026-07-01', '2026-06-01'].map((d) => copy(d));
    const plan = planRetention(list, { timeZone: TZ, weekStart: 0 });
    expect(kept(plan, 'nightly')).toEqual(days('2026-10-24', '2026-10-30').reverse());
    // 20–23 October are in the week of 18–24, which holds the nightly 24th; then the 4 newest older weeks.
    expect(kept(plan, 'weekly')).toEqual(['2026-09-02', '2026-08-15', '2026-07-01', '2026-06-01']);
  });

  it('applied every night for 60 nights (the fake clock): never more than 11 copies, at most 2 deleted a night, the same 11 at the end', () => {
    let store: RetentionCopy[] = [];
    for (const d of days('2026-09-01', '2026-10-30')) {
      store.push(copy(d));
      const plan = planRetention(store, { timeZone: TZ, weekStart: 0 });
      expect(plan.remove.length).toBeLessThanOrEqual(2);
      store = store.filter((c) => plan.keep.has(c.id));
      expect(store.length).toBeLessThanOrEqual(11);
    }
    expect(store.map((c) => c.id.slice(0, 10)).sort()).toEqual(
      ['2026-09-26', '2026-10-03', '2026-10-10', '2026-10-17', ...days('2026-10-24', '2026-10-30')].sort(),
    );
    // The next night: the 24th becomes its week's copy, the oldest (26 September) goes.
    store.push(copy('2026-10-31'));
    const next = planRetention(store, { timeZone: TZ, weekStart: 0 });
    expect(next.remove.map((id) => id.slice(0, 10))).toEqual(['2026-09-26']);
    expect(kept(next, 'weekly')).toEqual(['2026-10-24', '2026-10-17', '2026-10-10', '2026-10-03']);
  });
});
