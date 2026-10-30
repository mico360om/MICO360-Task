import type { Palette } from './theme';

/** Semantic tones for badges/pills/callouts — mirrors the web design system. */
export type Tone = 'neutral' | 'brand' | 'success' | 'warning' | 'info' | 'danger';

export const TONES: readonly Tone[] = ['neutral', 'brand', 'success', 'warning', 'info', 'danger'] as const;

export interface ToneStyle {
  /** Soft background fill. */
  bg: string;
  /** Foreground (text/icon) color — the tone's text colour. */
  fg: string;
  /** Border color — the tone's fill colour. */
  border: string;
}

/**
 * Resolve a tone to a {bg, fg, border} triple from the active palette, as the website's badges:
 * the soft wash as the background, the TEXT tone for the label (4.5:1 on its wash) and the fill
 * colour for the border, in both light and dark themes.
 */
export function toneStyle(p: Palette, tone: Tone): ToneStyle {
  switch (tone) {
    case 'brand':
      return { bg: p.brandWash, fg: p.brandText, border: p.brand };
    case 'success':
      return { bg: p.successSoft, fg: p.successText, border: p.success };
    case 'warning':
      return { bg: p.warningSoft, fg: p.warningText, border: p.warning };
    case 'info':
      return { bg: p.infoSoft, fg: p.infoText, border: p.info };
    case 'danger':
      return { bg: p.dangerSoft, fg: p.dangerText, border: p.danger };
    case 'neutral':
    default:
      return { bg: p.ground, fg: p.ink2, border: p.line };
  }
}
