import { describe, it, expect } from 'vitest';
import { normalizeDigits, parseHoursInput, parseDueDateInput } from './form-input';

describe('normalizeDigits (ARB-04)', () => {
  it('converts Arabic-Indic and Eastern Arabic-Indic digits to ASCII', () => {
    expect(normalizeDigits('٠١٢٣٤٥٦٧٨٩')).toBe('0123456789');
    expect(normalizeDigits('۰۱۲۳۴۵۶۷۸۹')).toBe('0123456789');
    expect(normalizeDigits('abc 12')).toBe('abc 12');
  });
});

describe('parseHoursInput (ARB-04)', () => {
  it('parses ASCII, comma and Arabic decimal forms', () => {
    expect(parseHoursInput('2.5')).toEqual({ ok: true, value: 2.5 });
    expect(parseHoursInput('2,5')).toEqual({ ok: true, value: 2.5 });
    expect(parseHoursInput('٢٫٥')).toEqual({ ok: true, value: 2.5 });
    expect(parseHoursInput('۲٫۵')).toEqual({ ok: true, value: 2.5 });
    expect(parseHoursInput('٢،٥')).toEqual({ ok: true, value: 2.5 });
    expect(parseHoursInput(' 3 ')).toEqual({ ok: true, value: 3 });
    expect(parseHoursInput('.5')).toEqual({ ok: true, value: 0.5 });
    expect(parseHoursInput('0')).toEqual({ ok: true, value: 0 });
  });

  it('treats blank as "no estimate"', () => {
    expect(parseHoursInput('')).toEqual({ ok: true, value: null });
    expect(parseHoursInput('   ')).toEqual({ ok: true, value: null });
  });

  it('rejects negatives and non-numbers with an inline message (never silently null)', () => {
    expect(parseHoursInput('-2')).toEqual({ ok: false, error: expect.stringMatching(/negative/) });
    expect(parseHoursInput('−1')).toEqual({ ok: false, error: expect.stringMatching(/negative/) });
    for (const bad of ['abc', '2.5.1', '1,5,3', 'NaN', 'Infinity', '2h']) {
      const r = parseHoursInput(bad);
      expect(r.ok, bad).toBe(false);
    }
  });
});

describe('parseDueDateInput (MOB-06)', () => {
  it('accepts a real YYYY-MM-DD date (Arabic digits too)', () => {
    expect(parseDueDateInput('2026-09-30')).toEqual({ ok: true, value: '2026-09-30' });
    expect(parseDueDateInput('٢٠٢٦-٠٩-٣٠')).toEqual({ ok: true, value: '2026-09-30' });
    expect(parseDueDateInput('2028-02-29')).toEqual({ ok: true, value: '2028-02-29' }); // leap day
  });

  it('treats blank as "no due date"', () => {
    expect(parseDueDateInput('')).toEqual({ ok: true, value: null });
  });

  it('rejects impossible dates instead of rolling them forward', () => {
    expect(parseDueDateInput('2026-02-31')).toEqual({ ok: false, error: '2026-02-31 is not a real date.' });
    expect(parseDueDateInput('2026-02-29').ok).toBe(false); // not a leap year
    expect(parseDueDateInput('2026-13-01').ok).toBe(false);
    expect(parseDueDateInput('2026-00-10').ok).toBe(false);
  });

  it('rejects anything that is not YYYY-MM-DD', () => {
    for (const bad of ['tomorrow', '30/09/2026', '2026-9-30', '2026-09-30T00:00', '0001-01-01']) {
      expect(parseDueDateInput(bad).ok, bad).toBe(false);
    }
  });
});
