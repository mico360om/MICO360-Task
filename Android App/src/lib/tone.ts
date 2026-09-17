import type { Palette } from './theme';

/** Semantic tones for badges/pills/callouts — mirrors the web design system. */
export type Tone = 'neutral' | 'brand' | 'success' | 'warning' | 'info' | 'danger';

export const TONES: readonly Tone[] = ['neutral', 'brand', 'success', 'warning', 'info', 'danger'] as const;

export interface ToneStyle {
  /** Soft background fill. */
  bg: string;
  /** Foreground (text/icon) color. */
  fg: string;
  /** Border color (same hue as the foreground). */
  border: string;
}

/**
 * Resolve a tone to a {bg, fg, border} triple from the active palette. Each tone uses its soft
 * wash as the background and the solid hue for text + border, so badges read clearly in both
 * light and dark themes.
 */
export function toneStyle(p: Palette, tone: Tone): ToneStyle {
  switch (tone) {
    case 'brand':
      return { bg: p.brandWash, fg: p.brand, border: p.brand };
    case 'success':
      return { bg: p.successSoft, fg: p.success, border: p.success };
    case 'warning':
      return { bg: p.warningSoft, fg: p.warning, border: p.warning };
    case 'info':
      return { bg: p.infoSoft, fg: p.info, border: p.info };
    case 'danger':
      return { bg: p.dangerSoft, fg: p.danger, border: p.danger };
    case 'neutral':
    default:
      return { bg: p.ground, fg: p.ink2, border: p.line };
  }
}
