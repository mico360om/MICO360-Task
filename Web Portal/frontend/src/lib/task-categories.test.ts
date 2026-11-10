import { describe, it, expect } from 'vitest';
import {
  CATEGORY_COLOR_KEYS,
  CATEGORY_NAME_MAX,
  CATEGORY_TONES,
  categoryNameKey,
  categoryChips,
  categoryMovePlan,
  checkCategoryName,
  hasAnyCategory,
  isCategoryColor,
  needsCategory,
} from './task-categories';
import { STATUS_TONES, PRIORITY_TONES } from './colour-scheme';

// WCAG relative luminance and contrast, to hold the colours to the site's rules.
const lum = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
};
const contrast = (a: string, b: string) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
};
// index.css: --c-surface, --c-surface-2 and --c-ground in each theme.
const PAGE = { light: ['#FFFFFF', '#FBFAF9', '#F4F2F0'], dark: ['#241F1D', '#2C2624', '#181413'] };

describe('category names', () => {
  it('are trimmed, single-spaced, required and at most 40 characters', () => {
    expect(checkCategoryName('  Civil   works ')).toEqual({ ok: true, name: 'Civil works' });
    expect(checkCategoryName('  ')).toEqual({ ok: false, problem: 'Enter a name for the category.' });
    expect(checkCategoryName('x'.repeat(CATEGORY_NAME_MAX + 1))).toEqual({ ok: false, problem: `A category name can have at most ${CATEGORY_NAME_MAX} characters.` });
  });
  it('compare without case or spaces (one per project)', () => {
    expect(categoryNameKey(' Civil Works')).toBe(categoryNameKey('civilworks'));
    expect(categoryNameKey('Electrical')).not.toBe(categoryNameKey('Electric'));
  });
});

describe('category colours', () => {
  it('are a fixed set of 12, none of them a status or priority colour', () => {
    expect(CATEGORY_COLOR_KEYS).toHaveLength(12);
    expect(isCategoryColor('teal')).toBe(true);
    expect(isCategoryColor('#ff0000')).toBe(false);
    const reserved = new Set([...Object.values(STATUS_TONES), ...Object.values(PRIORITY_TONES)].flatMap((t) => [t.light.fill, t.dark.fill]));
    for (const key of CATEGORY_COLOR_KEYS) expect(reserved.has(CATEGORY_TONES[key].light.fill)).toBe(false);
  });
  it('keep the site’s contrast in light and dark (fill 3:1 on pages, text 4.5:1 on pages and its own tint)', () => {
    for (const key of CATEGORY_COLOR_KEYS) {
      for (const theme of ['light', 'dark'] as const) {
        const t = CATEGORY_TONES[key][theme];
        for (const page of PAGE[theme]) {
          expect(contrast(t.fill, page), `${key} ${theme} fill`).toBeGreaterThanOrEqual(3);
          expect(contrast(t.text, page), `${key} ${theme} text`).toBeGreaterThanOrEqual(4.5);
        }
        expect(contrast(t.text, t.soft), `${key} ${theme} text on tint`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});

describe('chips on cards and rows', () => {
  const cats = [
    { id: 'a', name: 'Civil', color: 'teal' },
    { id: 'b', name: 'Electrical', color: 'gold' },
    { id: 'c', name: 'HSE', color: 'pink' },
  ];
  it('Comfortable shows up to 2 and "+1"; Compact 1; Detailed all', () => {
    expect(categoryChips(cats, 'comfortable')).toEqual({ shown: cats.slice(0, 2), more: 1 });
    expect(categoryChips(cats, 'compact')).toEqual({ shown: cats.slice(0, 1), more: 2 });
    expect(categoryChips(cats, 'detailed')).toEqual({ shown: cats, more: 0 });
    expect(categoryChips(undefined, 'comfortable')).toEqual({ shown: [], more: 0 });
  });
  it('the Category filter matches any of the picked categories', () => {
    expect(hasAnyCategory(cats, ['x', 'c'])).toBe(true);
    expect(hasAnyCategory(cats, ['x'])).toBe(false);
    expect(hasAnyCategory(undefined, ['a'])).toBe(false);
    expect(hasAnyCategory(cats, [])).toBe(true);
  });
  it('"Needs a category" only where the project asks for one and the task has none', () => {
    expect(needsCategory({ categories: [] }, { requireCategory: true })).toBe(true);
    expect(needsCategory({ categories: cats }, { requireCategory: true })).toBe(false);
    expect(needsCategory({ categories: [] }, { requireCategory: false })).toBe(false);
    expect(needsCategory({}, null)).toBe(false);
  });
});

describe('moving a task to another project', () => {
  it('keeps the categories the new project has by name and drops the rest', () => {
    const plan = categoryMovePlan(
      [{ id: 'a', name: 'Civil' }, { id: 'b', name: 'Electrical' }],
      [{ id: 'x', name: ' civil' }, { id: 'y', name: 'HSE' }],
    );
    expect(plan).toEqual({ keep: [{ fromId: 'a', toId: 'x', name: 'Civil' }], drop: ['Electrical'] });
  });
});
