import { describe, it, expect } from 'vitest';
import { buttonLook, chipLook, priorityLook, toggleLook } from './ui-kit';
import { contrastRatio, darkColors, lightColors } from './theme';

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
