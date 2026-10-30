import { describe, it, expect } from 'vitest';
import { toneStyle, TONES, type Tone } from './tone';
import { lightColors, darkColors } from './theme';

describe('toneStyle', () => {
  it('maps each tone to a soft background, its TEXT tone as the foreground and its fill as the border', () => {
    expect(toneStyle(lightColors, 'success')).toEqual({ bg: lightColors.successSoft, fg: lightColors.successText, border: lightColors.success });
    expect(toneStyle(lightColors, 'warning')).toEqual({ bg: lightColors.warningSoft, fg: lightColors.warningText, border: lightColors.warning });
    expect(toneStyle(lightColors, 'info')).toEqual({ bg: lightColors.infoSoft, fg: lightColors.infoText, border: lightColors.info });
    expect(toneStyle(lightColors, 'danger')).toEqual({ bg: lightColors.dangerSoft, fg: lightColors.dangerText, border: lightColors.danger });
    expect(toneStyle(lightColors, 'brand')).toEqual({ bg: lightColors.brandWash, fg: lightColors.brandText, border: lightColors.brand });
    expect(toneStyle(lightColors, 'neutral')).toEqual({ bg: lightColors.ground, fg: lightColors.ink2, border: lightColors.line });
  });

  it('the warning text is the website’s readable amber, not the fill', () => {
    expect(toneStyle(lightColors, 'warning').fg).toBe('#9A630E');
    expect(toneStyle(lightColors, 'warning').border).toBe('#B87611');
    expect(toneStyle(darkColors, 'brand').fg).toBe('#E07A66');
  });

  it('resolves from the dark palette for dark mode', () => {
    const s = toneStyle(darkColors, 'success');
    expect(s.fg).toBe(darkColors.successText);
    expect(s.bg).toBe(darkColors.successSoft);
    // dark tones differ from light so a badge reads correctly on a dark ground
    expect(darkColors.success).not.toBe(lightColors.success);
  });

  it('exposes exactly the six tones and every one resolves', () => {
    expect([...TONES]).toEqual(['neutral', 'brand', 'success', 'warning', 'info', 'danger']);
    for (const t of TONES) {
      const s = toneStyle(lightColors, t as Tone);
      expect(s.bg).toMatch(/^#[0-9A-Fa-f]{6}$/);
      expect(s.fg).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  });
});
