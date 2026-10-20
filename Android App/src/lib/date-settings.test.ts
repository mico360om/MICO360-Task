import { describe, it, expect } from 'vitest';
import { resolveTimeZone } from './date-settings';

describe('resolveTimeZone — your own time zone, else the company’s, else Muscat', () => {
  it('your own zone beats the company’s', () => {
    expect(resolveTimeZone({ company: 'Asia/Dubai', own: 'Europe/London' })).toBe('Europe/London');
  });
  it('without your own (or with an invalid one) the company’s is used', () => {
    expect(resolveTimeZone({ company: 'Asia/Dubai', own: null })).toBe('Asia/Dubai');
    expect(resolveTimeZone({ company: 'Asia/Dubai', own: 'Mars/Olympus' })).toBe('Asia/Dubai');
  });
  it('both missing or invalid: Asia/Muscat', () => {
    expect(resolveTimeZone({})).toBe('Asia/Muscat');
    expect(resolveTimeZone({ company: 'nope', own: '' })).toBe('Asia/Muscat');
  });
});
