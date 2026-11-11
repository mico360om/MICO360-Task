import { describe, expect, it } from 'vitest';
import { DEFAULT_POLICY, type NotificationPolicy } from './policy';
import { decideDelivery, isQuiet, quietEnd, quietSpecFor, type DeliveryContext, type PersonDeliveryPrefs } from './delivery';

const MUSCAT = 'Asia/Muscat';
// Sunday to Thursday, 08:00–17:00; Wednesday 18 Nov 2026 a holiday.
const ctx = (now: string, over: Partial<DeliveryContext> = {}): DeliveryContext => ({
  now: new Date(now),
  policy: DEFAULT_POLICY,
  calendar: { workingDays: [0, 1, 2, 3, 4], holidays: [{ day: '2026-11-18', name: 'National Day' }] },
  hours: { start: '08:00', end: '17:00' },
  companyZone: MUSCAT,
  personZone: MUSCAT,
  ...over,
});
const prefs = (p: Partial<PersonDeliveryPrefs> = {}): PersonDeliveryPrefs => ({ muted: [], ...p });
// Times in Muscat (UTC+4): Sunday 15 Nov 2026 09:00 = 05:00Z.
const SUN_0900 = '2026-11-15T05:00:00Z';
const SUN_2000 = '2026-11-15T16:00:00Z';
const THU_1800 = '2026-11-12T14:00:00Z';
const MON_0800 = '2026-11-16T04:00:00.000Z';
const SUN_0800 = '2026-11-15T04:00:00.000Z';

describe('quiet hours', () => {
  it('the company default is outside working hours, days off quiet all day; quiet ends at the next working morning', () => {
    const spec = quietSpecFor(prefs(), ctx(SUN_0900));
    expect(isQuiet(new Date(SUN_0900), spec)).toBe(false);
    expect(isQuiet(new Date(SUN_2000), spec)).toBe(true);
    expect(quietEnd(new Date(SUN_2000), spec)?.toISOString()).toBe(MON_0800);
    expect(quietEnd(new Date(THU_1800), spec)?.toISOString()).toBe(SUN_0800);
    // Tuesday evening: Wednesday is a holiday, so Thursday morning.
    expect(quietEnd(new Date('2026-11-17T15:00:00Z'), spec)?.toISOString()).toBe('2026-11-19T04:00:00.000Z');
    expect(quietEnd(new Date(SUN_0900), spec)).toBeNull();
  });

  it('a company can set nightly quiet hours instead (days off stay quiet)', () => {
    const policy: NotificationPolicy = { ...DEFAULT_POLICY, quietHours: { ...DEFAULT_POLICY.quietHours, mode: 'custom', start: '21:00', end: '07:00' } };
    const spec = quietSpecFor(prefs(), ctx(SUN_2000, { policy }));
    expect(isQuiet(new Date(SUN_2000), spec)).toBe(false); // 20:00
    expect(isQuiet(new Date('2026-11-15T18:00:00Z'), spec)).toBe(true); // 22:00
    expect(quietEnd(new Date('2026-11-15T18:00:00Z'), spec)?.toISOString()).toBe('2026-11-16T03:00:00.000Z'); // Mon 07:00
    expect(isQuiet(new Date('2026-11-13T08:00:00Z'), spec)).toBe(true); // Friday noon
  });

  it('a person’s own quiet hours are in their own time zone; they may keep days off loud', () => {
    const p = prefs({ quietHours: { mode: 'custom', start: '22:00', end: '06:30', daysOff: false } });
    const london = ctx('2026-11-15T23:00:00Z', { personZone: 'Europe/London' }); // 23:00 in London
    const spec = quietSpecFor(p, london);
    expect(isQuiet(london.now, spec)).toBe(true);
    expect(quietEnd(london.now, spec)?.toISOString()).toBe('2026-11-16T06:30:00.000Z');
    expect(isQuiet(new Date('2026-11-13T12:00:00Z'), spec)).toBe(false); // a Friday afternoon: not quiet for them
  });

  it('a person can turn quiet hours off', () => {
    const spec = quietSpecFor(prefs({ quietHours: { mode: 'off', start: '22:00', end: '07:00', daysOff: true } }), ctx(SUN_2000));
    expect(isQuiet(new Date(SUN_2000), spec)).toBe(false);
  });
});

describe('what happens to one notice', () => {
  it('in working time: bell, push now; email only where on', () => {
    expect(decideDelivery('TASK_OVERDUE', prefs(), ctx(SUN_0900))).toEqual({ kind: 'overdue', bell: true, push: 'now', email: 'off', releaseAt: null });
    expect(decideDelivery('TASK_ESCALATION_ADMIN', prefs(), ctx(SUN_0900))).toMatchObject({ push: 'now', email: 'now' });
  });

  it('in quiet hours the bell still fills and the push and email wait for the morning', () => {
    expect(decideDelivery('TASK_ESCALATION_ADMIN', prefs(), ctx(SUN_2000))).toEqual({ kind: 'escalationAdmin', bell: true, push: 'hold', email: 'hold', releaseAt: new Date(MON_0800) });
  });

  it('meeting reminders and @mentions come through quiet hours unless the person turned that off', () => {
    expect(decideDelivery('MEETING_REMINDER', prefs(), ctx(SUN_2000)).push).toBe('now');
    expect(decideDelivery('MENTION', prefs(), ctx(SUN_2000))).toMatchObject({ push: 'now', email: 'now' });
    expect(decideDelivery('CHAT_MESSAGE', prefs(), ctx(SUN_2000)).push).toBe('now');
    expect(decideDelivery('MENTION', prefs({ breakThrough: { mentions: false } }), ctx(SUN_2000)).push).toBe('hold');
    expect(decideDelivery('MEETING_REMINDER', prefs({ breakThrough: { meetings: false } }), ctx(SUN_2000)).push).toBe('hold');
  });

  it('a held meeting reminder that would come after the meeting starts is dropped', () => {
    const d = decideDelivery('MEETING_REMINDER', prefs({ breakThrough: { meetings: false } }), ctx(SUN_2000), { expiresAt: new Date('2026-11-15T18:00:00Z') });
    expect(d).toMatchObject({ bell: true, push: 'off' });
  });

  it('a muted type gets nothing; a required kind keeps its bell and push even when muted', () => {
    expect(decideDelivery('TASK_COMMENT', prefs({ muted: ['TASK_COMMENT'] }), ctx(SUN_0900))).toMatchObject({ bell: false, push: 'off', email: 'off' });
    expect(decideDelivery('TASK_ESCALATION', prefs({ muted: ['TASK_ESCALATION'] }), ctx(SUN_0900))).toMatchObject({ bell: true, push: 'now' });
  });

  it('Pause: everything not required loses push and email (the bell fills); required pushes wait for the pause to end', () => {
    const p = prefs({ pauseUntil: '2026-11-15T07:00:00.000Z' }); // until 11:00 Sunday
    expect(decideDelivery('TASK_OVERDUE', p, ctx(SUN_0900))).toMatchObject({ bell: true, push: 'off', email: 'off' });
    expect(decideDelivery('MENTION', p, ctx(SUN_0900))).toMatchObject({ bell: true, push: 'off', email: 'off' });
    expect(decideDelivery('TASK_ESCALATION', p, ctx(SUN_0900))).toEqual({ kind: 'escalation', bell: true, push: 'hold', email: 'off', releaseAt: new Date('2026-11-15T07:00:00.000Z') });
    // A pause that ends in quiet hours: held until the quiet hours end too.
    const late = prefs({ pauseUntil: SUN_2000 });
    expect(decideDelivery('TASK_ESCALATION', late, ctx(SUN_0900)).releaseAt?.toISOString()).toBe(MON_0800);
    // An expired pause is no pause.
    expect(decideDelivery('TASK_OVERDUE', prefs({ pauseUntil: '2026-11-15T04:00:00.000Z' }), ctx(SUN_0900)).push).toBe('now');
  });

  it('answers to the person’s own requests (MICO AI) are never held by quiet hours', () => {
    expect(decideDelivery('MICO_AI_ANSWER', prefs(), ctx(SUN_2000))).toEqual({ kind: null, bell: true, push: 'now', email: 'off', releaseAt: null });
    expect(decideDelivery('TASK_DIGEST', prefs(), ctx(SUN_2000))).toMatchObject({ kind: null, push: 'hold' });
  });

  it('a calendar with no working morning never holds (nothing would ever go)', () => {
    expect(decideDelivery('TASK_OVERDUE', prefs(), ctx(SUN_2000, { calendar: { workingDays: [], holidays: [] } })).push).toBe('now');
  });
});
