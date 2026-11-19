import { describe, expect, it } from 'vitest';
import { APPRECIATION_ICONS, APPRECIATION_THEMES, ICON_LABEL, THEME_LOOK, contrastRatio, isCustomColour, normaliseColourInput, themeLook, themeStyle } from './appreciation';

// 1.24.4 (owner, 19 Nov): eight more themes, fourteen more icons and a Custom colour.
const WHITE = '#ffffff';
const PAGE = { light: ['#ffffff', '#f4f2f0'], dark: ['#241f1d', '#181413'] };
/** The ink as drawn at 90% over the band (the small words use text-white/90). */
const blend = (ink: string, bg: string, a: number) => {
  const p = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [x, y] = [p(ink), p(bg)];
  return `#${x.map((c, i) => Math.round(c * a + y[i]! * (1 - a)).toString(16).padStart(2, '0')).join('')}`;
};
const readable = (band: { from: string; to: string; ink: string }) =>
  Math.min(...[band.from, band.to].flatMap((bg) => [contrastRatio(band.ink, bg), contrastRatio(blend(band.ink, bg, 0.9), bg)]));

describe('the named themes', () => {
  it('fourteen, with labels; white text at least 4.5:1 on both ends of every gradient (Gold and Lime darkened enough)', () => {
    expect(APPRECIATION_THEMES).toEqual(['ruby', 'ocean', 'emerald', 'amber', 'violet', 'slate', 'rose', 'coral', 'gold', 'lime', 'teal', 'sky', 'indigo', 'plum']);
    for (const t of APPRECIATION_THEMES) {
      const look = THEME_LOOK[t];
      expect(look.label).toBe(t[0]!.toUpperCase() + t.slice(1));
      for (const c of [look.from, look.to]) expect(contrastRatio(WHITE, c), `${t} ${c}`).toBeGreaterThanOrEqual(4.5);
      expect(readable({ ...look, ink: WHITE }), t).toBeGreaterThanOrEqual(4.5);
    }
    // All different.
    expect(new Set(APPRECIATION_THEMES.map((t) => THEME_LOOK[t].from)).size).toBe(14);
  });

  it('a theme name gives the same band in light and dark, with white text', () => {
    const l = themeLook('teal');
    expect(l.light).toEqual({ from: THEME_LOOK.teal.from, to: THEME_LOOK.teal.to, ink: WHITE });
    expect(l.dark).toEqual(l.light);
  });

  it('an unknown name or a broken colour falls back to ruby (never a crash)', () => {
    for (const bad of ['neon', '', '#12', '#zzzzzz', undefined, null, 5]) expect(themeLook(bad as never)).toEqual(themeLook('ruby'));
  });
});

describe('a custom colour', () => {
  it('is #rrggbb (any case); typed codes are tidied: a missing #, spaces, upper case', () => {
    expect(isCustomColour('#1e6091')).toBe(true);
    expect(isCustomColour('#1E6091')).toBe(true);
    expect(isCustomColour('ocean')).toBe(false);
    expect(isCustomColour('#fff')).toBe(false);
    expect(normaliseColourInput(' #1E6091 ')).toBe('#1e6091');
    expect(normaliseColourInput('1e6091')).toBe('#1e6091');
    for (const bad of ['#12345', '#12345g', 'blue', '', '#1e60911']) expect(normaliseColourInput(bad)).toBeNull();
  });

  it('a gradient from the colour to a darker shade, text at least 4.5:1 (white or dark) in light and dark mode', () => {
    const samples = ['#1e6091', '#f5f5a0', '#ffffff', '#000000', '#808080', '#ffcc00', '#00ff00', '#ff0000', '#0000ff', '#7fffd4', '#c0c0c0', '#101010', '#8b1e1e', '#e0e0ff', '#777777', '#5a5a5a'];
    for (const hex of samples) {
      const look = themeLook(hex);
      for (const mode of ['light', 'dark'] as const) {
        const band = look[mode];
        expect([WHITE, '#1f1a19'], `${hex} ${mode}`).toContain(band.ink);
        expect(readable(band), `${hex} ${mode} ${JSON.stringify(band)}`).toBeGreaterThanOrEqual(4.5);
        // The end is a darker shade of the start.
        expect(contrastRatio(band.to, '#000000'), `${hex} ${mode} darker`).toBeLessThanOrEqual(contrastRatio(band.from, '#000000'));
        // It never washes out against the page around it.
        for (const page of PAGE[mode]) expect(contrastRatio(band.from, page), `${hex} ${mode} on ${page}`).toBeGreaterThanOrEqual(1.3);
      }
    }
  });

  it('a mid colour keeps itself as the start; white text on the owner’s example #1E6091', () => {
    const l = themeLook('#1E6091').light;
    expect(l.from).toBe('#1e6091');
    expect(l.ink).toBe(WHITE);
  });

  it('a very light colour (#f5f5a0) is darkened for the band and gets dark text', () => {
    const l = themeLook('#f5f5a0').light;
    expect(l.from).not.toBe('#f5f5a0');
    expect(l.ink).toBe('#1f1a19');
  });

  it('the style carries the colours as CSS variables for the .ap-band class (light and dark)', () => {
    const s = themeStyle('#f5f5a0') as Record<string, string>;
    const look = themeLook('#f5f5a0');
    expect(s['--ap-l1']).toBe(look.light.from);
    expect(s['--ap-l2']).toBe(look.light.to);
    expect(s['--ap-li']).toBe('31 26 25');
    expect(s['--ap-d1']).toBe(look.dark.from);
    expect((themeStyle('ruby') as Record<string, string>)['--ap-li']).toBe('255 255 255');
  });
});

describe('the icons', () => {
  it('twenty, each with an accessible name', () => {
    expect(APPRECIATION_ICONS).toEqual(['star', 'team', 'trophy', 'bulb', 'heart', 'medal', 'shield', 'clock', 'rocket', 'target', 'thumbs-up', 'handshake', 'crown', 'flag', 'gift', 'sparkles', 'award', 'lightning', 'smile', 'sun']);
    for (const i of APPRECIATION_ICONS) expect(ICON_LABEL[i]).toMatch(/^[A-Z][a-z -]+$/);
    expect(new Set(Object.values(ICON_LABEL)).size).toBe(20);
  });
});
