import { describe, it, expect } from 'vitest';
import { AVATAR_SIZES, PROJECT_AVATAR_SIZES, buttonLook, chipLook, clampPercent, priorityLook, toggleLook } from './ui-kit';
import { contrastRatio, darkColors, lightColors } from './theme';

it('avatar and project-avatar sizes are the website’s', () => {
  // xl: the website's Profile photo (h-28 w-28 = 112 px, initials text-3xl = 30 px).
  expect(AVATAR_SIZES).toEqual({ sm: { box: 24, text: 10 }, md: { box: 32, text: 12 }, lg: { box: 64, text: 18 }, xl: { box: 112, text: 30 } });
  expect(PROJECT_AVATAR_SIZES.md).toEqual({ box: 32, text: 12, icon: 18, radius: 8 });
  expect(PROJECT_AVATAR_SIZES['2xl']).toEqual({ box: 96, text: 30, icon: 46, radius: 24 });
  expect(PROJECT_AVATAR_SIZES).toEqual({
    xs: { box: 20, text: 9, icon: 12, radius: 6 },
    sm: { box: 24, text: 10, icon: 14, radius: 6 },
    md: { box: 32, text: 12, icon: 18, radius: 8 },
    lg: { box: 44, text: 15, icon: 22, radius: 14 },
    xl: { box: 64, text: 20, icon: 32, radius: 18 },
    '2xl': { box: 96, text: 30, icon: 46, radius: 24 },
  });
});

it('an avatar’s initials read on their wash in both themes', () => {
  for (const p of [lightColors, darkColors]) expect(contrastRatio(p.brandText, p.brandWash)).toBeGreaterThanOrEqual(4.5);
});

describe('the website’s building blocks, decided here', () => {
  it('buttons: gradient primary, neutral secondary, ghost, danger; 44 tall in every size', () => {
    expect(buttonLook(lightColors, 'primary', 'md')).toMatchObject({ fill: 'gradient', text: '#FFFFFF', minHeight: 44, paddingHorizontal: 16, fontSize: 14 });
    expect(buttonLook(lightColors, 'secondary', 'md')).toMatchObject({ fill: lightColors.surface, text: lightColors.ink, border: lightColors.line });
    expect(buttonLook(darkColors, 'danger', 'lg')).toMatchObject({ fill: darkColors.danger, paddingHorizontal: 20, fontSize: 16 });
    expect(buttonLook(lightColors, 'ghost', 'sm')).toMatchObject({ fill: null, text: lightColors.ink2, paddingHorizontal: 12 });
  });

  it('every variant and size, exactly', () => {
    expect(buttonLook(lightColors, 'primary', 'sm')).toEqual({ fill: 'gradient', text: lightColors.onBrand, border: null, minHeight: 44, paddingHorizontal: 12, fontSize: 14 });
    expect(buttonLook(darkColors, 'secondary', 'lg')).toEqual({ fill: darkColors.surface, text: darkColors.ink, border: darkColors.line, minHeight: 44, paddingHorizontal: 20, fontSize: 16 });
    expect(buttonLook(darkColors, 'ghost', 'md')).toEqual({ fill: null, text: darkColors.ink2, border: null, minHeight: 44, paddingHorizontal: 16, fontSize: 14 });
    expect(buttonLook(lightColors, 'danger', 'md')).toEqual({ fill: lightColors.danger, text: lightColors.onBrand, border: null, minHeight: 44, paddingHorizontal: 16, fontSize: 14 });
  });

  it('every button’s text is readable on its fill, in both themes', () => {
    for (const p of [lightColors, darkColors]) {
      expect(contrastRatio(buttonLook(p, 'secondary', 'md').text, p.surface)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(buttonLook(p, 'ghost', 'md').text, p.surface)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(buttonLook(p, 'danger', 'md').text, p.danger)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('priority Normal is neutral, High amber, Urgent red — readable in both themes', () => {
    expect(priorityLook(lightColors, 'NORMAL')).toEqual({ bg: lightColors.ground, fg: lightColors.ink, label: 'Normal' });
    expect(priorityLook(lightColors, 'LOW')).toEqual({ bg: lightColors.ground, fg: lightColors.ink2, label: 'Low' });
    expect(priorityLook(lightColors, 'HIGH')).toEqual({ bg: lightColors.warningSoft, fg: lightColors.warningText, label: 'High' });
    expect(priorityLook(darkColors, 'URGENT')).toEqual({ bg: darkColors.dangerSoft, fg: darkColors.dangerText, label: 'Urgent' });
    for (const p of [lightColors, darkColors]) {
      for (const pr of ['LOW', 'NORMAL', 'HIGH', 'URGENT'] as const) expect(contrastRatio(priorityLook(p, pr).fg, priorityLook(p, pr).bg), pr).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('a selected chip is brand-filled with white text, readable in both themes', () => {
    for (const p of [lightColors, darkColors]) {
      const l = chipLook(p, true);
      expect(l.bg).toBe(p.brand);
      expect(l.border).toBe(p.brand);
      expect(contrastRatio(l.fg, l.bg)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(chipLook(p, false).fg, chipLook(p, false).bg)).toBeGreaterThanOrEqual(4.5);
    }
    expect(chipLook(lightColors, false)).toEqual({ bg: lightColors.surface, fg: lightColors.ink2, border: lightColors.line });
  });

  it('a switch: brand track when on, line when off, white thumb', () => {
    expect(toggleLook(lightColors, true)).toEqual({ track: lightColors.brand, thumb: lightColors.onBrand });
    expect(toggleLook(darkColors, false)).toEqual({ track: darkColors.line, thumb: darkColors.onBrand });
  });
});

it('a progress value is a whole percent from 0 to 100 (nonsense counts as 0)', () => {
  expect([clampPercent(42.4), clampPercent(42.6), clampPercent(-5), clampPercent(130), clampPercent(Number.NaN)]).toEqual([42, 43, 0, 100, 0]);
});
