import { describe, it, expect } from 'vitest';
import { matchesNormalized, normalizeForSearch, prefilterTerms } from './text-normalize';

describe('normalizeForSearch', () => {
  it('folds Arabic alef forms, ta marbuta, alef maksura and hamza carriers', () => {
    expect(normalizeForSearch('إدارة')).toBe('اداره');
    expect(normalizeForSearch('أحمد آمال ٱلعربية')).toBe('احمد امال العربيه');
    expect(normalizeForSearch('مستشفى')).toBe('مستشفي');
    expect(normalizeForSearch('مسؤول قائمة')).toBe('مسوول قايمه');
  });

  it('drops diacritics and tatweel', () => {
    expect(normalizeForSearch('مُرَاجَعَة')).toBe('مراجعه');
    expect(normalizeForSearch('مـــشروع')).toBe('مشروع');
  });

  it('case-folds Latin text and collapses whitespace', () => {
    expect(normalizeForSearch('  Prepare   REPORT ')).toBe('prepare report');
    expect(normalizeForSearch(null)).toBe('');
  });
});

describe('matchesNormalized', () => {
  it('finds a query across spelling variants on either side', () => {
    const q = normalizeForSearch('ادارة');
    expect(matchesNormalized(q, 'إدارة المشروع')).toBe(true);
    expect(matchesNormalized(normalizeForSearch('إدارة'), 'ادارة المشروع')).toBe(true);
    expect(matchesNormalized(q, 'other', null, 'إدارة')).toBe(true);
    expect(matchesNormalized(q, 'other')).toBe(false);
  });
});

describe('prefilterTerms', () => {
  it('keeps Latin words whole', () => {
    expect(prefilterTerms('Fix  Bug')).toEqual(['fix', 'bug']);
  });

  it('keeps only variant-free Arabic letters (a guaranteed superset for a LIKE pre-filter)', () => {
    // ا/ه/ي/و/ك can come from several spellings, so they are not used.
    expect(prefilterTerms('إدارة المشروع')).toEqual(['د', 'ر', 'ل', 'م', 'ش', 'ع']);
  });

  it('returns nothing to filter on when every letter has variants', () => {
    expect(prefilterTerms('آية')).toEqual([]);
  });

  it('every raw spelling of a match contains every term', () => {
    const raw = 'مُراجَعة عقد الإدارة';
    const terms = prefilterTerms('مراجعه الاداره');
    expect(terms.every((t) => raw.includes(t))).toBe(true);
  });
});
