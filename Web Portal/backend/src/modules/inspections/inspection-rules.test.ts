import { describe, it, expect } from 'vitest';
import {
  effectiveResult,
  formatNumber,
  limitsText,
  parseReading,
  readingText,
  requiredSignatures,
  allowedSignatures,
  resultLabel,
  summarize,
  withinLimits,
  type FormStructure,
  type ReadingItem,
} from './inspection-rules';

const pressure: ReadingItem = { id: 'p', kind: 'READING', label: 'Pressure', help: null, unit: 'psi', min: 0, max: 150 };

describe('parseReading: a typed number, kept as typed', () => {
  it('takes plain, negative and decimal numbers', () => {
    expect(parseReading('12')).toBe('12');
    expect(parseReading(' -3.25 ')).toBe('-3.25');
    expect(parseReading('150.00')).toBe('150.00');
    expect(parseReading('+7')).toBe('7');
    expect(parseReading('.5')).toBe('0.5');
  });
  it('reads a comma decimal and Arabic-Indic digits', () => {
    expect(parseReading('12,5')).toBe('12.5');
    expect(parseReading('١٢٫٥')).toBe('12.5');
    expect(parseReading('۱۵۰')).toBe('150');
  });
  it('refuses anything that is not one number', () => {
    for (const bad of ['', ' ', 'abc', '1.2.3', '12 psi', '1e5', 'NaN', 'Infinity', '--1', '1,000.5', '٫']) expect(parseReading(bad), bad).toBeNull();
    expect(parseReading('1'.repeat(40))).toBeNull();
  });
});

describe('limits: inclusive, decimals and one-sided', () => {
  it('passes inside and on the limits, fails outside', () => {
    expect(withinLimits(pressure, 0)).toBe(true);
    expect(withinLimits(pressure, 150)).toBe(true);
    expect(withinLimits(pressure, 150.0001)).toBe(false);
    expect(withinLimits(pressure, -0.1)).toBe(false);
  });
  it('handles one limit or none', () => {
    expect(withinLimits({ ...pressure, min: null }, -1000)).toBe(true);
    expect(withinLimits({ ...pressure, max: null }, 1e9)).toBe(true);
    expect(withinLimits({ ...pressure, max: null }, -1)).toBe(false);
    expect(withinLimits({ ...pressure, min: null, max: null }, 5)).toBe(true);
  });
  it('says the limits in words', () => {
    expect(limitsText(pressure)).toBe('0–150 psi');
    expect(limitsText({ ...pressure, min: 0.5, max: 2.75, unit: 'bar' })).toBe('0.5–2.75 bar');
    expect(limitsText({ ...pressure, min: null })).toBe('at most 150 psi');
    expect(limitsText({ ...pressure, max: null })).toBe('at least 0 psi');
    expect(limitsText({ ...pressure, min: null, max: null })).toBe('');
    expect(limitsText({ ...pressure, unit: null })).toBe('0–150');
    expect(formatNumber(-2.5)).toBe('-2.5');
    expect(limitsText({ ...pressure, min: -10, max: 5, unit: '°C' })).toBe('-10 to 5 °C');
    expect(formatNumber(1200000)).toBe('1200000');
  });
  it('shows a reading with its unit', () => {
    expect(readingText(pressure, '162.5')).toBe('162.5 psi');
    expect(readingText({ ...pressure, unit: null }, '12')).toBe('12');
    expect(readingText(pressure, null)).toBe('');
  });
});

describe('effectiveResult: a reading decides its own result', () => {
  it('fails a reading outside its limits whatever result was sent', () => {
    expect(effectiveResult(pressure, { result: 'PASS', reading: '162' })).toBe('FAIL');
    expect(effectiveResult(pressure, { result: null, reading: '162' })).toBe('FAIL');
    expect(effectiveResult(pressure, { result: 'NA', reading: '-1' })).toBe('FAIL');
  });
  it('passes a reading inside its limits, even if FAIL was sent', () => {
    expect(effectiveResult(pressure, { result: 'FAIL', reading: '100' })).toBe('PASS');
    expect(effectiveResult({ ...pressure, min: null, max: null }, { result: null, reading: '3' })).toBe('PASS');
  });
  it('lets a reading without a value be N/A or failed, never passed', () => {
    expect(effectiveResult(pressure, { result: 'NA', reading: null })).toBe('NA');
    expect(effectiveResult(pressure, { result: 'FAIL', reading: null })).toBe('FAIL');
    expect(effectiveResult(pressure, { result: 'PASS', reading: null })).toBeNull();
    expect(effectiveResult(pressure, undefined)).toBeNull();
  });
  it('takes a check item’s result as given', () => {
    const check = { id: 'c', kind: 'CHECK' as const, label: 'Guard rails fitted', help: null };
    expect(effectiveResult(check, { result: 'PASS', reading: null })).toBe('PASS');
    expect(effectiveResult(check, { result: 'FAIL', reading: '12' })).toBe('FAIL');
    expect(effectiveResult(check, { result: null, reading: null })).toBeNull();
  });
});

const structure: FormStructure = {
  sections: [
    { id: 's1', title: 'Well head', items: [pressure, { id: 'c1', kind: 'CHECK', label: 'Valves closed', help: null }] },
    { id: 's2', title: 'Deck', items: [{ id: 'c2', kind: 'CHECK', label: 'Rails', help: null }, { id: 'c3', kind: 'CHECK', label: 'Lights', help: null }] },
  ],
  clientSignature: 'OPTIONAL',
  supervisorSignature: 'NONE',
};

describe('summarize: the counts a list, the report and finishing use', () => {
  it('counts each result and lists what is left', () => {
    const s = summarize(structure, [
      { itemId: 'p', result: 'PASS', reading: '170' },
      { itemId: 'c1', result: 'PASS', reading: null },
      { itemId: 'c2', result: 'NA', reading: null },
      { itemId: 'gone', result: 'FAIL', reading: null },
    ]);
    expect(s).toEqual({ total: 4, answered: 3, passed: 1, failed: 1, na: 1, unanswered: ['c3'], failedItems: ['p'] });
  });
  it('words the result', () => {
    expect(resultLabel({ failed: 0, passed: 3, na: 1, total: 4 })).toBe('Passed');
    expect(resultLabel({ failed: 1, passed: 3, na: 0, total: 4 })).toBe('1 failed');
    expect(resultLabel({ failed: 3, passed: 0, na: 0, total: 3 })).toBe('3 failed');
    expect(resultLabel({ failed: 0, passed: 0, na: 2, total: 2 })).toBe('All N/A');
  });
});

describe('signatures', () => {
  it('always asks the inspector; the others as the form says', () => {
    expect(allowedSignatures(structure)).toEqual(['INSPECTOR', 'CLIENT']);
    expect(requiredSignatures(structure)).toEqual(['INSPECTOR']);
    expect(requiredSignatures({ ...structure, clientSignature: 'REQUIRED', supervisorSignature: 'REQUIRED' })).toEqual(['INSPECTOR', 'CLIENT', 'SUPERVISOR']);
  });
});
