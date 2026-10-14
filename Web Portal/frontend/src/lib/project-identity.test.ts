import { describe, it, expect } from 'vitest';
import { PROJECT_COLORS, PROJECT_ICON_KEYS, codeProblem, projectInitials, readableOn, suggestCode } from './project-icons';

describe('suggestCode — a code from the project’s name', () => {
  it('uses the initials, topped up from the last word to three letters', () => {
    expect(suggestCode('Rig Inspection Portal')).toBe('RIP');
    expect(suggestCode('Mobile App')).toBe('MAP');
    expect(suggestCode('Offshore Inspection Data Platform Modernisation')).toBe('OIDP');
    expect(suggestCode('Finance')).toBe('FINA');
    expect(suggestCode('Mobile App (Phase 2)')).toBe('MAP2');
    expect(suggestCode('  ')).toBe('');
  });
  it('falls back to PRJ when the name has no Latin letters', () => {
    expect(suggestCode('مشروع الإطلاق')).toBe('PRJ');
    expect(suggestCode('2026 roadmap')).toBe('ROA');
  });
});

describe('codeProblem — the rule for codes, said plainly', () => {
  it('accepts 2–10 letters or digits starting with a letter', () => {
    expect(codeProblem('MICO')).toBeNull();
    expect(codeProblem('HR2')).toBeNull();
    expect(codeProblem('')).toMatch(/needs a code/i);
    expect(codeProblem('A')).toMatch(/2–10/);
    expect(codeProblem('1AB')).toMatch(/start with a letter/);
    expect(codeProblem('AB-12')).toMatch(/letters and digits only/);
    expect(codeProblem('ABCDEFGHIJK')).toMatch(/2–10/);
  });
});

describe('initials and colours', () => {
  it('takes initials from the name in any script', () => {
    expect(projectInitials('Rig Inspection Portal')).toBe('RI');
    expect(projectInitials('finance')).toBe('FI');
    expect(projectInitials('مشروع الإطلاق')).toBe('ما');
    expect(projectInitials('')).toBe('?');
  });
  it('picks dark or light text so it reads on the colour', () => {
    expect(readableOn('#8B1E1E')).toBe('#ffffff');
    expect(readableOn('#F2C94C')).toBe('#1f1a17');
  });
  it('offers a set of icons and colours', () => {
    expect(PROJECT_ICON_KEYS.length).toBeGreaterThanOrEqual(20);
    expect(PROJECT_COLORS.every((c) => /^#[0-9A-F]{6}$/i.test(c))).toBe(true);
  });
});
