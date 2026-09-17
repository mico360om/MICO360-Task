import { describe, it, expect } from 'vitest';
import { colors, lightColors, darkColors, resolveColors, hexToRgba, categoryColor } from './theme';

describe('theme', () => {
  it('uses the MICO360 brand red', () => {
    expect(colors.brand).toBe('#8B1E1E');
  });

  it('hexToRgba converts hex + alpha', () => {
    expect(hexToRgba('#8B1E1E', 0.1)).toBe('rgba(139, 30, 30, 0.1)');
    expect(hexToRgba('FFFFFF', 1)).toBe('rgba(255, 255, 255, 1)');
    expect(hexToRgba('#000000', 2)).toBe('rgba(0, 0, 0, 1)'); // clamps alpha
  });

  it('hexToRgba rejects an invalid colour', () => {
    expect(() => hexToRgba('nope', 0.5)).toThrow();
  });

  it('categoryColor maps known categories and falls back to brand', () => {
    expect(categoryColor('DONE')).toBe('#2E7D53');
    expect(categoryColor('IN_PROGRESS')).toBe('#B87611');
    expect(categoryColor('MYSTERY')).toBe(colors.brand);
  });

  it('resolveColors picks light or dark by OS scheme (default light)', () => {
    expect(resolveColors('light')).toBe(lightColors);
    expect(resolveColors('dark')).toBe(darkColors);
    expect(resolveColors(null)).toBe(lightColors);
    expect(resolveColors(undefined)).toBe(lightColors);
  });

  it('light and dark palettes expose the same keys (so components never hit an undefined token)', () => {
    expect(Object.keys(darkColors).sort()).toEqual(Object.keys(lightColors).sort());
    expect(Object.keys(darkColors.category).sort()).toEqual(Object.keys(lightColors.category).sort());
  });

  it('dark ground is darker than its ink (a real dark theme, not a copy of light)', () => {
    expect(darkColors.ground).not.toBe(lightColors.ground);
    expect(darkColors.ink).toBe('#F4F2F0');
  });
});
