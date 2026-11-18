/**
 * Employee Appreciation (1.24.0): the website's copy of the server's names (appreciation-rules.ts — a drift test
 * holds them together), each theme's colours, the icons, the statuses' words and the placeholder preview.
 */
export const APPRECIATION_THEMES = ['ruby', 'ocean', 'emerald', 'amber', 'violet', 'slate'] as const;
export type AppreciationTheme = (typeof APPRECIATION_THEMES)[number];
export const APPRECIATION_ICONS = ['star', 'team', 'trophy', 'bulb', 'heart', 'medal'] as const;
export type AppreciationIcon = (typeof APPRECIATION_ICONS)[number];
export const APPRECIATION_ANIMATIONS = ['none', 'confetti', 'shimmer'] as const;
export type AppreciationAnimation = (typeof APPRECIATION_ANIMATIONS)[number];
export const APPRECIATION_STATUSES = ['SCHEDULED', 'ACTIVE', 'ACCEPTED', 'EXPIRED', 'CANCELLED'] as const;
export type AppreciationStatus = (typeof APPRECIATION_STATUSES)[number];

/**
 * Each theme: a gradient dark enough for white text (at least 4.5:1 on both ends, light and dark mode alike).
 * Brand-safe: the site's ruby first, then calm deep colours.
 */
export const THEME_LOOK: Record<AppreciationTheme, { label: string; from: string; to: string }> = {
  ruby: { label: 'Ruby', from: '#9F1239', to: '#B91C1C' },
  ocean: { label: 'Ocean', from: '#075985', to: '#0369A1' },
  emerald: { label: 'Emerald', from: '#065F46', to: '#047857' },
  amber: { label: 'Amber', from: '#92400E', to: '#B45309' },
  violet: { label: 'Violet', from: '#5B21B6', to: '#6D28D9' },
  slate: { label: 'Slate', from: '#1E293B', to: '#334155' },
};
export const themeGradient = (t: AppreciationTheme): string => {
  const look = THEME_LOOK[t] ?? THEME_LOOK.ruby;
  return `linear-gradient(135deg, ${look.from}, ${look.to})`;
};

export const ICON_LABEL: Record<AppreciationIcon, string> = { star: 'Star', team: 'Team', trophy: 'Trophy', bulb: 'Light bulb', heart: 'Heart', medal: 'Medal' };
export const ANIMATION_LABEL: Record<AppreciationAnimation, string> = { none: 'None', confetti: 'Confetti burst', shimmer: 'Gentle shimmer' };

export const STATUS_WORDS: Record<AppreciationStatus, string> = { SCHEDULED: 'Scheduled', ACTIVE: 'Active', ACCEPTED: 'Accepted', EXPIRED: 'Expired', CANCELLED: 'Cancelled' };
export const STATUS_TONE: Record<AppreciationStatus, string> = {
  SCHEDULED: 'bg-info-soft text-info',
  ACTIVE: 'bg-warning-soft text-warning',
  ACCEPTED: 'bg-success-soft text-success',
  EXPIRED: 'bg-ground text-ink-2',
  CANCELLED: 'bg-danger-soft text-danger',
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** '2026-11-18' → '18 Nov 2026'. */
export function dayWords(day: string): string {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  return `${d} ${MONTHS[m - 1] ?? ''} ${y}`;
}

/** The same filling the server does — for the Send tab's preview. */
export function fillPlaceholders(text: string, v: { name: string; company: string; day: string }): string {
  return text.replace(/\{(name|company|date)\}/g, (_m, k: string) => (k === 'name' ? v.name : k === 'company' ? v.company : dayWords(v.day)));
}

/** Has this device already played this appreciation's animation (once per device per appreciation)? */
const PLAYED_KEY = (id: string) => `mico360.appreciation.played.${id}`;
export function playedHere(id: string): boolean {
  try {
    return localStorage.getItem(PLAYED_KEY(id)) === '1';
  } catch {
    return false;
  }
}
export function markPlayed(id: string): void {
  try {
    localStorage.setItem(PLAYED_KEY(id), '1');
  } catch {
    /* a private window: it may play again, which is harmless */
  }
}

/** Does the person ask for less motion? */
export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
