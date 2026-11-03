import { describe, it, expect } from 'vitest';
import {
  ALL_COMPANIES_LABEL,
  ARCHIVED_NOTICE,
  COMPANY_GONE_CODE,
  COMPANY_HEADER,
  COMPANY_PICK_PREF,
  companyHeaders,
  effectiveCompanyId,
  isCompanyGone,
  pickGoneNotice,
  pickLabel,
  scopeKey,
  showCompanyPicker,
  validPick,
} from './companies';

const a = { id: 'A', name: 'Alpha Co' };
const b = { id: 'B', name: 'Beta Co' };

describe('companies (the rule shared with the app and the extension)', () => {
  it('shows the picker only for two or more companies', () => {
    expect(showCompanyPicker([])).toBe(false);
    expect(showCompanyPicker([a])).toBe(false);
    expect(showCompanyPicker([a, b])).toBe(true);
  });

  it('a pick that isn’t in my list is dropped', () => {
    expect(validPick('B', [a])).toBeNull();
    expect(validPick('A', [a, b])).toBe('A');
    expect(validPick(null, [a])).toBeNull();
  });

  it('the effective company: pick, primary, the only one', () => {
    expect(effectiveCompanyId(null, [a, b], 'B')).toBe('B');
    expect(effectiveCompanyId(null, [a], null)).toBe('A');
    expect(effectiveCompanyId(null, [a, b], null)).toBeNull();
    expect(effectiveCompanyId('A', [a, b], 'B')).toBe('A');
  });

  it('the effective company never names a company that isn’t in my list', () => {
    expect(effectiveCompanyId('C', [a, b], 'B')).toBe('B');
    expect(effectiveCompanyId(null, [a, b], 'C')).toBeNull();
    expect(effectiveCompanyId(null, [], 'A')).toBeNull();
  });

  it('words', () => {
    expect(pickLabel(null, [a])).toBe('All my companies');
    expect(pickLabel('B', [a, b])).toBe('Beta Co');
    expect(pickLabel('C', [a, b])).toBe(ALL_COMPANIES_LABEL);
    expect(pickGoneNotice('Beta Co')).toBe('You no longer have access to Beta Co. Showing all your companies.');
    expect(pickGoneNotice(null)).toBe('You no longer have access to that company. Showing all your companies.');
    expect(ARCHIVED_NOTICE).toBe('Your company is archived — ask an administrator.');
    expect(companyHeaders('A')).toEqual({ 'X-Company-Id': 'A' });
    expect(companyHeaders(null)).toEqual({});
  });

  it('the names the server and the device use', () => {
    expect(COMPANY_HEADER).toBe('X-Company-Id');
    expect(COMPANY_GONE_CODE).toBe('COMPANY_NOT_AVAILABLE');
    expect(COMPANY_PICK_PREF).toBe('company.pick');
  });

  it('a refused pick is a 403 with COMPANY_NOT_AVAILABLE, nothing else', () => {
    expect(isCompanyGone({ status: 403, code: 'COMPANY_NOT_AVAILABLE' })).toBe(true);
    expect(isCompanyGone({ status: 403, code: 'FORBIDDEN' })).toBe(false);
    expect(isCompanyGone({ status: 400, code: 'COMPANY_NOT_AVAILABLE' })).toBe(false);
    expect(isCompanyGone(null)).toBe(false);
    expect(isCompanyGone(undefined)).toBe(false);
  });

  it('a scope key per pick', () => {
    expect(scopeKey(null)).toBe('all');
    expect(scopeKey('B')).toBe('B');
  });

  it('imports nothing, so the app and the extension can copy it as it is', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const text = readFileSync(join(__dirname, 'companies.ts'), 'utf8');
    expect(text).not.toMatch(/^\s*import\s/m);
  });
});
