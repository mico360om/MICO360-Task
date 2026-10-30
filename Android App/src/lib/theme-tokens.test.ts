import { describe, it, expect } from 'vitest';
import { BRAND_GRADIENT, darkColors, lightColors, radius, shadow, type Palette } from './theme';
import { hasWeb, readWeb } from '../testing/web-source';

const CATEGORY: Record<string, string> = {
  'cat-backlog': 'category.BACKLOG',
  'cat-todo': 'category.TODO',
  'cat-progress': 'category.IN_PROGRESS',
  'cat-blocked': 'category.BLOCKED',
  'cat-review': 'category.REVIEW',
  'cat-done': 'category.DONE',
};

const hex = (n: string) => Number(n).toString(16).toUpperCase().padStart(2, '0');

/**
 * The `--c-*: r g b;` lines of one block of the website's index.css as { appKey: '#RRGGBB' }:
 * 'brand-text' → brandText, 'ink-2' → ink2, 'danger-soft' → dangerSoft, 'cat-progress' → category.IN_PROGRESS.
 */
function paletteFromCss(selector: string): Record<string, string> {
  const css = readWeb('frontend/src/index.css');
  const start = css.indexOf(selector);
  expect(start, selector).toBeGreaterThanOrEqual(0);
  const block = css.slice(start, css.indexOf('}', start));
  const out: Record<string, string> = {};
  for (const [, name, r, g, b] of block.matchAll(/--c-([a-z0-9-]+):\s*(\d+)\s+(\d+)\s+(\d+)\s*;/g)) {
    const key = CATEGORY[name!] ?? name!.replace(/-(\w)/g, (_, ch: string) => ch.toUpperCase());
    out[key] = `#${hex(r!)}${hex(g!)}${hex(b!)}`;
  }
  return out;
}

/** The same keys as `ref`, read from the app's palette (a dotted key reads into `category`). */
function pick(p: Palette, ref: Record<string, string>): Record<string, unknown> {
  const flat = p as unknown as Record<string, unknown>;
  return Object.fromEntries(
    Object.keys(ref).map((k) => [k, k.startsWith('category.') ? (p.category as Record<string, string>)[k.slice(9)] : flat[k]]),
  );
}

describe.skipIf(!hasWeb('frontend/src/index.css', 'frontend/tailwind.config.js'))('the website’s tokens', () => {
  it('the light palette is index.css :root', () => {
    const css = paletteFromCss(':root {');
    expect(Object.keys(css).length).toBeGreaterThan(30);
    expect(pick(lightColors, css)).toEqual(css);
  });
  it('the dark palette is index.css :root[data-theme=dark]', () => {
    const css = paletteFromCss(":root[data-theme='dark'] {");
    expect(Object.keys(css).length).toBeGreaterThan(30);
    expect(pick(darkColors, css)).toEqual(css);
  });
  it('radii, scrim and the brand gradient are tailwind.config.js', () => {
    const tw = readWeb('frontend/tailwind.config.js');
    expect(tw).toContain(`borderRadius: { xl: '0.875rem', '2xl': '1.125rem', '3xl': '1.5rem' }`);
    expect([radius.button, radius.card, radius.sheet]).toEqual([14, 18, 24]);
    expect(tw).toContain(`scrim: 'rgb(0 0 0 / 0.5)'`);
    const [a, b, c] = BRAND_GRADIENT.colors;
    expect(tw).toContain(`'brand-gradient': 'linear-gradient(135deg, ${a} 0%, ${b} 55%, ${c} 100%)'`);
  });
});

it('has the website’s values even without the website next to it', () => {
  expect([lightColors.ink3, lightColors.warningText, lightColors.meeting]).toEqual(['#736965', '#9A630E', '#7A5AA8']);
  expect([darkColors.brand, darkColors.brandText, darkColors.surface, darkColors.ground, darkColors.ink, darkColors.meeting]).toEqual(['#BC3E2C', '#E07A66', '#241F1D', '#181413', '#F4F0EE', '#B296DE']);
  expect([lightColors.brandWash, darkColors.brandWash]).toEqual(['#F3E9E9', '#33221F']);
  expect(lightColors.scrim).toBe('rgba(0, 0, 0, 0.5)');
  expect(darkColors.scrim).toBe(lightColors.scrim);
  expect([lightColors.onBrand, darkColors.onBrand]).toEqual(['#FFFFFF', '#FFFFFF']);
});

it('the radii: badge 6, input 8, button 14, card 18, sheet 24, pill; sm/md/lg kept as aliases for now', () => {
  expect(radius).toEqual({ badge: 6, input: 8, button: 14, card: 18, sheet: 24, pill: 999, sm: 6, md: 10, lg: 14 });
});

it('the website’s soft/card/lift/brand shadows as phone elevations', () => {
  const ink = '#211B1A';
  expect(shadow).toEqual({
    soft: { elevation: 1, shadowColor: ink, shadowOpacity: 0.06, shadowRadius: 3, shadowOffset: { width: 0, height: 1 } },
    card: { elevation: 2, shadowColor: ink, shadowOpacity: 0.1, shadowRadius: 12, shadowOffset: { width: 0, height: 4 } },
    lift: { elevation: 6, shadowColor: ink, shadowOpacity: 0.2, shadowRadius: 20, shadowOffset: { width: 0, height: 10 } },
    brand: { elevation: 4, shadowColor: '#8B1E1E', shadowOpacity: 0.35, shadowRadius: 10, shadowOffset: { width: 0, height: 6 } },
  });
});

it('the brand gradient runs corner to corner, the same in dark mode', () => {
  expect(BRAND_GRADIENT).toEqual({ colors: ['#A83326', '#8B1E1E', '#5E1414'], locations: [0, 0.55, 1], start: { x: 0, y: 0 }, end: { x: 1, y: 1 } });
});
