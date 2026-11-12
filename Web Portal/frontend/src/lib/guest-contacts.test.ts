import { describe, it, expect } from 'vitest';
import {
  checkGuest,
  guestCompanyOptions,
  guestFullness,
  guestLabel,
  guestLine,
  guestMatches,
  guestOptions,
  guestPhoneKey,
  guestsCardLine,
  guestTextKey,
  hasGuest,
  hasGuestCompany,
  isSameGuest,
  noteProblem,
  withGuestsText,
  GUEST_LIMITS,
} from './guest-contacts';

describe('checkGuest', () => {
  it('needs a name and cleans the rest (blank = none)', () => {
    expect(checkGuest({ name: '  ' })).toEqual({ ok: false, problems: { name: 'Enter the guest’s name.' } });
    expect(checkGuest({ name: ' Ahmed ', company: ' OXY ', email: '', phone: null })).toEqual({
      ok: true,
      guest: { name: 'Ahmed', company: 'OXY', designation: null, email: null, phone: null },
    });
  });
  it('refuses a bad email or phone and anything too long', () => {
    const r = checkGuest({ name: 'A', email: 'nope', phone: 'call me', company: 'x'.repeat(GUEST_LIMITS.company + 1) });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.problems).sort()).toEqual(['company', 'email', 'phone']);
  });
  it('a per-task note is at most 1000 characters', () => {
    expect(noteProblem('x'.repeat(1000))).toBeNull();
    expect(noteProblem('x'.repeat(1001))).toMatch(/1000/);
  });
});

describe('the duplicate rule', () => {
  it('compares names without case, spaces, accents or Arabic marks', () => {
    expect(guestTextKey('  Al  Harthy ')).toBe('alharthy');
    expect(guestTextKey('José')).toBe(guestTextKey('jose'));
    expect(guestTextKey('مُحَمَّد')).toBe(guestTextKey('محمد'));
    expect(guestPhoneKey('+968 9912-3456')).toBe('96899123456');
  });
  it('the same name and the same email, phone digits or company is the same person', () => {
    const a = { name: 'Ahmed Al Harthy', company: 'OXY', email: 'AHMED@oxy.com', phone: '+968 9912 3456' };
    expect(isSameGuest(a, { name: 'ahmed alharthy', email: 'ahmed@OXY.com ' })).toBe(true);
    expect(isSameGuest(a, { name: 'Ahmed Al Harthy', phone: '968-9912-3456' })).toBe(true);
    expect(isSameGuest(a, { name: 'AHMED AL HARTHY', company: ' oxy ' })).toBe(true);
  });
  it('never fuses two names sharing an inbox, a switchboard or a company', () => {
    const a = { name: 'Ahmed', company: 'OXY', email: 'site@oxy.com', phone: '24000000' };
    expect(isSameGuest(a, { name: 'Sara', company: 'OXY', email: 'site@oxy.com', phone: '24000000' })).toBe(false);
  });
  it('the same name with different details is a different person; with no details at all, the same', () => {
    expect(isSameGuest({ name: 'Ahmed', company: 'OXY' }, { name: 'Ahmed', company: 'PDO' })).toBe(false);
    expect(isSameGuest({ name: 'Ahmed', company: 'OXY' }, { name: 'Ahmed' })).toBe(false);
    expect(isSameGuest({ name: 'Ahmed' }, { name: ' ahmed ' })).toBe(true);
  });
  it('the New guest check splits the list into the same person and same-name others', () => {
    const list = [
      { id: 'g1', name: 'Ahmed Al Harthy', company: 'OXY' },
      { id: 'g2', name: 'Ahmed Al Harthy', company: 'PDO' },
      { id: 'g3', name: 'Sara', company: 'OXY' },
    ];
    const m = guestMatches({ name: 'ahmed al harthy', company: 'oxy' }, list);
    expect(m.same.map((g) => g.id)).toEqual(['g1']);
    expect(m.similar.map((g) => g.id)).toEqual(['g2']);
    expect(guestMatches({ name: '' }, list)).toEqual({ same: [], similar: [] });
  });
  it('fullness counts the details given', () => {
    expect(guestFullness({ name: 'A' })).toBe(0);
    expect(guestFullness({ name: 'A', company: 'OXY', email: 'a@b.co', phone: ' ' })).toBe(2);
  });
});

describe('names, lines and filters', () => {
  const ahmed = { id: 'g1', name: 'Ahmed', company: 'OXY' };
  const sara = { id: 'g2', name: 'Sara', company: null };
  it('labels and lines', () => {
    expect(guestLabel(ahmed)).toBe('Ahmed (OXY)');
    expect(guestLabel(sara)).toBe('Sara');
    expect(guestLine({ name: 'Ahmed', company: 'OXY', designation: 'Site lead' })).toBe('Ahmed · OXY · Site lead');
    expect(guestsCardLine([])).toBeNull();
    expect(guestsCardLine([ahmed])).toBe('Guest: Ahmed (OXY)');
    expect(guestsCardLine([ahmed, sara, sara])).toBe('Guest: Ahmed (OXY) and 2 more');
    expect(withGuestsText([])).toBe('');
    expect(withGuestsText([ahmed])).toBe('with guest Ahmed (OXY)');
    expect(withGuestsText([ahmed, sara, { name: 'Ali', company: 'BP' }])).toBe('with guests Ahmed (OXY), Sara and Ali (BP)');
  });
  it('filters by guest and by guest company', () => {
    expect(hasGuest([ahmed], 'g1')).toBe(true);
    expect(hasGuest(null, 'g1')).toBe(false);
    expect(hasGuestCompany([ahmed], ' oxy')).toBe(true);
    expect(hasGuestCompany([sara], '')).toBe(false);
    const tasks = [{ guests: [sara, ahmed] }, { guests: [ahmed, { id: 'g3', name: 'Ali', company: 'oxy' }] }, { guests: null }];
    expect(guestOptions(tasks).map((g) => g.id)).toEqual(['g1', 'g3', 'g2']);
    expect(guestCompanyOptions(tasks)).toEqual(['OXY']);
  });
});
