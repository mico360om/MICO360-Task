import { describe, it, expect } from 'vitest';
import { COMPANY_CODE, COMPANY_WORDS, checkProjectCompanyChange, dmReadOnlyMessage, isProjectArchived, normalizeCompanyCode, sharesCompany } from './company-rules';

describe('Company rules', () => {
  it('a project is archived when its own status is, or every one of its companies is', () => {
    expect(isProjectArchived({ status: 'ARCHIVED', companies: [{ status: 'ACTIVE' }] })).toBe(true);
    expect(isProjectArchived({ status: 'ACTIVE', companies: [{ status: 'ARCHIVED' }, { status: 'ARCHIVED' }] })).toBe(true);
    expect(isProjectArchived({ status: 'ACTIVE', companies: [{ status: 'ARCHIVED' }, { status: 'ACTIVE' }] })).toBe(false);
    expect(isProjectArchived({ status: 'ACTIVE', companies: [] })).toBe(false);
  });

  // The rule, checked in this order:
  //   after empty → NO_COMPANY;
  //   an added id not active → COMPANY_ARCHIVED (+companyId);
  //   for non-admins, an added or removed id not theirs, or a changed main not theirs → NOT_YOUR_COMPANY (+companyId);
  //   for non-admins, `after` holds none of their companies → WOULD_LOSE_ACCESS.
  // Admins pass the last two.
  it('who may change a project’s companies', () => {
    const base = { actorIsAdmin: false, actorCompanyIds: ['A'], activeCompanyIds: ['A', 'B', 'D'], before: { ids: ['A', 'B'], mainId: 'A' } };
    expect(checkProjectCompanyChange({ ...base, after: [] })).toEqual({ ok: false, code: 'NO_COMPANY', message: 'A project needs at least one company.' });
    expect(checkProjectCompanyChange({ ...base, after: ['A'] })).toEqual({ ok: false, code: 'NOT_YOUR_COMPANY', message: 'You can only add or remove your own companies.', companyId: 'B' }); // removes B
    expect(checkProjectCompanyChange({ ...base, after: ['B', 'A'] })).toMatchObject({ ok: false, code: 'NOT_YOUR_COMPANY', companyId: 'B' }); // main → B
    expect(checkProjectCompanyChange({ ...base, before: { ids: ['A'], mainId: 'A' }, after: ['A', 'B'] })).toMatchObject({ ok: false, code: 'NOT_YOUR_COMPANY', companyId: 'B' }); // adds B
    expect(checkProjectCompanyChange({ ...base, actorCompanyIds: ['A', 'B'], after: ['B', 'A'] })).toEqual({ ok: true });
    expect(checkProjectCompanyChange({ ...base, actorCompanyIds: ['A', 'B'], after: ['B'] })).toEqual({ ok: true });
    expect(checkProjectCompanyChange({ ...base, actorCompanyIds: ['A', 'D'], before: { ids: ['A'], mainId: 'A' }, after: ['D'] })).toEqual({ ok: true });
    expect(checkProjectCompanyChange({ ...base, before: { ids: ['A', 'B'], mainId: 'B' }, after: ['B'] })).toEqual({
      ok: false,
      code: 'WOULD_LOSE_ACCESS',
      message: 'You’d lose access to this project. Ask an administrator to make this change.',
    });
    expect(checkProjectCompanyChange({ ...base, actorIsAdmin: true, after: ['B'] })).toEqual({ ok: true });
    expect(checkProjectCompanyChange({ ...base, actorIsAdmin: true, before: { ids: ['A'], mainId: 'A' }, after: ['A', 'C'] })).toMatchObject({ ok: false, code: 'COMPANY_ARCHIVED', companyId: 'C' });
  });

  it('an archived company says so in the pure rule (the service names the company)', () => {
    expect(checkProjectCompanyChange({ actorIsAdmin: true, actorCompanyIds: [], activeCompanyIds: ['A'], before: { ids: ['A'], mainId: 'A' }, after: ['A', 'C'] })).toEqual({
      ok: false,
      code: 'COMPANY_ARCHIVED',
      message: 'That company is archived.',
      companyId: 'C',
    });
  });

  it('a company kept on the project may stay archived; only adding one is refused', () => {
    expect(checkProjectCompanyChange({ actorIsAdmin: true, actorCompanyIds: [], activeCompanyIds: ['A'], before: { ids: ['A', 'C'], mainId: 'A' }, after: ['A', 'C'] })).toEqual({ ok: true });
  });

  it('codes are 2–10 capital letters or digits, typed in any case', () => {
    expect(normalizeCompanyCode('  ppl ')).toBe('PPL');
    expect(COMPANY_CODE.test('PPL')).toBe(true);
    expect(COMPANY_CODE.test('P')).toBe(false);
    expect(COMPANY_CODE.test('PROLENS-01')).toBe(false);
    expect(COMPANY_CODE.test('ABCDEFGHIJK')).toBe(false);
  });

  it('two lists of companies share one when any id is in both', () => {
    expect(sharesCompany(['A', 'B'], ['C', 'B'])).toBe(true);
    expect(sharesCompany(['A'], ['B'])).toBe(false);
    expect(sharesCompany([], ['B'])).toBe(false);
  });

  it('words', () => {
    expect(dmReadOnlyMessage('Sara')).toBe('You no longer share a company with Sara.');
    expect(COMPANY_WORDS.notAvailable).toBe('You no longer have access to this company.');
    expect(COMPANY_WORDS.inviteeOnly).toBe('You can see this meeting because you were invited; its notes stay with the project’s team.');
  });
});
