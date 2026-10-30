import { describe, it, expect } from 'vitest';
import { BRAND_GRADIENT, contrastRatio, darkColors, lightColors, mixHex, type Palette } from './theme';
import { TONES, toneStyle } from './tone';

type Token = Exclude<keyof Palette, 'category'>;

/** Every text tone and the backgrounds it is put on (WCAG AA for normal text: 4.5:1). */
const TEXT_ON: Partial<Record<Token, readonly Token[]>> = {
  ink: ['surface', 'surface2', 'ground', 'ground2', 'brandWash'],
  ink2: ['surface', 'surface2', 'ground', 'ground2', 'brandWash'],
  ink3: ['surface', 'surface2', 'ground', 'ground2'],
  brandText: ['surface', 'surface2', 'ground', 'brandWash'],
  dangerText: ['surface', 'ground', 'dangerSoft'],
  successText: ['surface', 'ground', 'successSoft'],
  warningText: ['surface', 'ground', 'warningSoft'],
  infoText: ['surface', 'ground', 'infoSoft'],
};

for (const [name, p] of [['light', lightColors], ['dark', darkColors]] as const) {
  describe(name, () => {
    it('every text tone reaches 4.5:1 on every background it is used on', () => {
      for (const [fg, bgs] of Object.entries(TEXT_ON) as Array<[Token, readonly Token[]]>) {
        for (const bg of bgs) expect(contrastRatio(p[fg], p[bg]), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
      }
    });
    it('white on the gradient stops, the brand fill and the danger fill', () => {
      for (const fill of [BRAND_GRADIENT.colors[0], BRAND_GRADIENT.colors[1], p.brand, p.danger]) {
        expect(contrastRatio(p.onBrand, fill), fill).toBeGreaterThanOrEqual(4.5);
      }
    });
    it('every badge tone (toneStyle fg on bg)', () => {
      for (const t of TONES) expect(contrastRatio(toneStyle(p, t).fg, toneStyle(p, t).bg), t).toBeGreaterThanOrEqual(4.5);
    });
  });
}

it('contrastRatio and mixHex', () => {
  expect(contrastRatio('#FFFFFF', '#000000')).toBeCloseTo(21, 5);
  expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 5);
  expect(contrastRatio('#8B1E1E', '#8B1E1E')).toBe(1);
  expect(mixHex('#8B1E1E', '#FFFFFF', 0.1)).toBe('#F3E9E9');
  expect(mixHex('#bc3e2c', '#241f1d', 0.1)).toBe('#33221F');
  expect(mixHex('#000000', '#FFFFFF', 0)).toBe('#FFFFFF');
  expect(mixHex('#000000', '#FFFFFF', 1)).toBe('#000000');
});

it('the old failures are gone: ink-3 and warning text read on white and on the page ground', () => {
  for (const bg of [lightColors.surface, lightColors.ground]) {
    expect(contrastRatio(lightColors.ink3, bg)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(lightColors.warningText, bg)).toBeGreaterThanOrEqual(4.5);
  }
  expect(contrastRatio('#948985', '#FFFFFF')).toBeLessThan(4.5); // the app's old ink-3
});

// Final review S3: the read ticks and their count on my brand bubble. Light 6.87:1. Dark 4.10:1 —
// UNDER 4.5 (the website pairs sky-200 with its dark brand the same way); it does clear 3:1, the
// floor for icons (WCAG 1.4.11). Reported to the lead; not fudged here.
it('read receipts on the brand bubble: light ≥ 4.5:1; dark 4.10:1 (≥ 3:1 for icons, under 4.5)', () => {
  expect(contrastRatio(lightColors.readOnBrand, lightColors.brand)).toBeGreaterThanOrEqual(4.5);
  const dark = contrastRatio(darkColors.readOnBrand, darkColors.brand);
  expect(dark).toBeGreaterThanOrEqual(3);
  expect(dark).toBeLessThan(4.5);
});
