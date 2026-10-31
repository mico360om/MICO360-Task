import { describe, it, expect } from 'vitest';
import { matchesNormalized, normalizeForSearch } from './text-normalize';

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
