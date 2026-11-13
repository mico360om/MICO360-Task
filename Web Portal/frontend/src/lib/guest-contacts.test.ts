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
    expect(checkGuest({ name: ' Ahmed ', company: ' Acme ', email: '', phone: null })).toEqual({
      ok: true,
      guest: { name: 'Ahmed', company: 'Acme', designation: null, email: null, phone: null },
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
    const a = { name: 'Ahmed Al Harthy', company: 'Acme', email: 'AHMED@acme.com', phone: '+968 9912 3456' };
    expect(isSameGuest(a, { name: 'ahmed alharthy', email: 'ahmed@Acme.com ' })).toBe(true);
    expect(isSameGuest(a, { name: 'Ahmed Al Harthy', phone: '968-9912-3456' })).toBe(true);
    expect(isSameGuest(a, { name: 'AHMED AL HARTHY', company: ' acme ' })).toBe(true);
  });
  it('never fuses two names sharing an inbox, a switchboard or a company', () => {
    const a = { name: 'Ahmed', company: 'Acme', email: 'site@acme.com', phone: '24000000' };
    expect(isSameGuest(a, { name: 'Sara', company: 'Acme', email: 'site@acme.com', phone: '24000000' })).toBe(false);
  });
  it('the same name with different details is a different person; with no details at all, the same', () => {
    expect(isSameGuest({ name: 'Ahmed', company: 'Acme' }, { name: 'Ahmed', company: 'PDO' })).toBe(false);
    expect(isSameGuest({ name: 'Ahmed', company: 'Acme' }, { name: 'Ahmed' })).toBe(false);
    expect(isSameGuest({ name: 'Ahmed' }, { name: ' ahmed ' })).toBe(true);
  });
  it('the New guest check splits the list into the same person and same-name others', () => {
    const list = [
      { id: 'g1', name: 'Ahmed Al Harthy', company: 'Acme' },
      { id: 'g2', name: 'Ahmed Al Harthy', company: 'PDO' },
      { id: 'g3', name: 'Sara', company: 'Acme' },
    ];
    const m = guestMatches({ name: 'ahmed al harthy', company: 'acme' }, list);
    expect(m.same.map((g) => g.id)).toEqual(['g1']);
    expect(m.similar.map((g) => g.id)).toEqual(['g2']);
    expect(guestMatches({ name: '' }, list)).toEqual({ same: [], similar: [] });
  });
  it('fullness counts the details given', () => {
    expect(guestFullness({ name: 'A' })).toBe(0);
    expect(guestFullness({ name: 'A', company: 'Acme', email: 'a@b.co', phone: ' ' })).toBe(2);
  });
});

describe('names, lines and filters', () => {
  const ahmed = { id: 'g1', name: 'Ahmed', company: 'Acme' };
  const sara = { id: 'g2', name: 'Sara', company: null };
  it('labels and lines', () => {
    expect(guestLabel(ahmed)).toBe('Ahmed (Acme)');
    expect(guestLabel(sara)).toBe('Sara');
    expect(guestLine({ name: 'Ahmed', company: 'Acme', designation: 'Site lead' })).toBe('Ahmed · Acme · Site lead');
    expect(guestsCardLine([])).toBeNull();
    expect(guestsCardLine([ahmed])).toBe('Guest: Ahmed (Acme)');
    expect(guestsCardLine([ahmed, sara, sara])).toBe('Guest: Ahmed (Acme) and 2 more');
    expect(withGuestsText([])).toBe('');
    expect(withGuestsText([ahmed])).toBe('with guest Ahmed (Acme)');
    expect(withGuestsText([ahmed, sara, { name: 'Ali', company: 'BP' }])).toBe('with guests Ahmed (Acme), Sara and Ali (BP)');
  });
  it('filters by guest and by guest company', () => {
    expect(hasGuest([ahmed], 'g1')).toBe(true);
    expect(hasGuest(null, 'g1')).toBe(false);
    expect(hasGuestCompany([ahmed], ' acme')).toBe(true);
    expect(hasGuestCompany([sara], '')).toBe(false);
    const tasks = [{ guests: [sara, ahmed] }, { guests: [ahmed, { id: 'g3', name: 'Ali', company: 'acme' }] }, { guests: null }];
    expect(guestOptions(tasks).map((g) => g.id)).toEqual(['g1', 'g3', 'g2']);
    expect(guestCompanyOptions(tasks)).toEqual(['Acme']);
  });
});
