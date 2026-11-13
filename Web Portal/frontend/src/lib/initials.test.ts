import { describe, it, expect } from 'vitest';
import { personInitials } from './initials';

describe('personInitials', () => {
  it('takes the first letter of the first two words', () => {
    expect(personInitials('Ada Lovelace')).toBe('AL');
    expect(personInitials(' omar  bin said ')).toBe('OB');
  });

  it('uses letters only: brackets and punctuation around a word are skipped', () => {
    // Guests as the owner's company names them: "M(" and "Y(" before.
    expect(personInitials('Mohammed (Acme)')).toBe('MA');
    expect(personInitials('Yaqoob (Acme IT)')).toBe('YA');
    expect(personInitials('"Sara" Ahmed')).toBe('SA');
  });

  it('skips a part with no letters (a dash, a number) and takes the next word', () => {
    expect(personInitials('Sara - Ahmed')).toBe('SA');
    expect(personInitials('Crew 3 North')).toBe('CN');
    expect(personInitials('(2) Bilal Khan')).toBe('BK');
  });

  it('keeps working for Arabic names', () => {
    expect(personInitials('محمد علي')).toBe('مع');
    expect(personInitials('فاطمة (Acme)')).toBe('فA');
  });

  it('one usable word gives its first letter; none gives "?"', () => {
    expect(personInitials('Layla')).toBe('L');
    expect(personInitials('(Acme)')).toBe('A');
    expect(personInitials('Omar 42')).toBe('O');
    expect(personInitials('')).toBe('?');
    expect(personInitials('   ')).toBe('?');
    expect(personInitials('123 - !')).toBe('?');
  });
});
