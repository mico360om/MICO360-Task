/**
 * Employee Appreciation (1.24.0): the website's copy of the server's names (appreciation-rules.ts — a drift test
 * holds them together), each theme's colours, the icons, the statuses' words and the placeholder preview.
 */
import type { CSSProperties } from 'react';

// 1.24.4 (owner, 19 Nov): eight more themes and fourteen more icons, after the first ones.
export const APPRECIATION_THEMES = ['ruby', 'ocean', 'emerald', 'amber', 'violet', 'slate', 'rose', 'coral', 'gold', 'lime', 'teal', 'sky', 'indigo', 'plum'] as const;
export type AppreciationThemeName = (typeof APPRECIATION_THEMES)[number];
/** A custom colour `#rrggbb` (1.24.4), kept in the same theme column as a theme's name. */
export type CustomColour = `#${string}`;
export type AppreciationTheme = AppreciationThemeName | CustomColour;
export const APPRECIATION_ICONS = ['star', 'team', 'trophy', 'bulb', 'heart', 'medal', 'shield', 'clock', 'rocket', 'target', 'thumbs-up', 'handshake', 'crown', 'flag', 'gift', 'sparkles', 'award', 'lightning', 'smile', 'sun'] as const;
export type AppreciationIcon = (typeof APPRECIATION_ICONS)[number];
export const APPRECIATION_ANIMATIONS = ['none', 'confetti', 'shimmer'] as const;
export type AppreciationAnimation = (typeof APPRECIATION_ANIMATIONS)[number];
export const APPRECIATION_STATUSES = ['SCHEDULED', 'ACTIVE', 'ACCEPTED', 'EXPIRED', 'CANCELLED'] as const;
export type AppreciationStatus = (typeof APPRECIATION_STATUSES)[number];

/**
 * Each theme: a gradient dark enough for white text (at least 4.5:1 on both ends, light and dark mode alike).
 * Brand-safe: the site's ruby first, then calm deep colours (Gold and Lime deep enough for white text). `dark`: its
 * own pair in the dark theme where the usual one would fade into the dark page (Slate).
 */
export const THEME_LOOK: Record<AppreciationThemeName, { label: string; from: string; to: string; dark?: { from: string; to: string } }> = {
  ruby: { label: 'Ruby', from: '#9F1239', to: '#B91C1C' },
  ocean: { label: 'Ocean', from: '#075985', to: '#0369A1' },
  emerald: { label: 'Emerald', from: '#065F46', to: '#047857' },
  amber: { label: 'Amber', from: '#92400E', to: '#A84D08' },
  violet: { label: 'Violet', from: '#5B21B6', to: '#6D28D9' },
  slate: { label: 'Slate', from: '#1E293B', to: '#334155', dark: { from: '#334155', to: '#475569' } },
  rose: { label: 'Rose', from: '#9D174D', to: '#BE185D' },
  coral: { label: 'Coral', from: '#9A3412', to: '#B23B0B' },
  gold: { label: 'Gold', from: '#715205', to: '#84620A' },
  lime: { label: 'Lime', from: '#365314', to: '#46720E' },
  teal: { label: 'Teal', from: '#115E59', to: '#0F766E' },
  sky: { label: 'Sky', from: '#0B5F9E', to: '#1170B8' },
  indigo: { label: 'Indigo', from: '#3730A3', to: '#4338CA' },
  plum: { label: 'Plum', from: '#701A75', to: '#86198F' },
};

const HEX = /^#[0-9a-f]{6}$/i;
/** Is the stored theme a custom colour #rrggbb? */
export const isCustomColour = (t: unknown): t is CustomColour => typeof t === 'string' && HEX.test(t);
/** What someone typed in the colour code box, tidied ("1E6091", " #1e6091 " → "#1e6091"); null when it isn't a colour. */
export function normaliseColourInput(v: string): CustomColour | null {
  const t = v.trim().replace(/^#?/, '#').toLowerCase();
  return HEX.test(t) ? (t as CustomColour) : null;
}

type Rgb = [number, number, number];
const rgbOf = (hex: string): Rgb => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as Rgb;
const hexOf = (c: Rgb): string => `#${c.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('')}`;
const luminance = (hex: string): number => {
  const [r, g, b] = rgbOf(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as Rgb;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
/** WCAG contrast ratio of two #rrggbb colours. */
export function contrastRatio(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
/** Mix towards another colour (0 = as it is, 1 = all the other colour). */
const mix = (hex: string, toward: Rgb, amount: number): string => {
  const c = rgbOf(hex);
  return hexOf(c.map((v, i) => v + (toward[i]! - v) * amount) as Rgb);
};
const BLACK: Rgb = [0, 0, 0];
const WHITE_RGB: Rgb = [255, 255, 255];
const WHITE = '#ffffff';
/** The site's near-black ink (the banner's buttons use it too). */
const DARK_INK = '#1f1a19';
/** The ink drawn at 90% over the band, as the small words are. */
const at90 = (ink: string, bg: string) => {
  const [i, g] = [rgbOf(ink), rgbOf(bg)];
  return hexOf(i.map((v, k) => v * 0.9 + g[k]! * 0.1) as Rgb);
};
const readableOn = (ink: string, from: string, to: string) => Math.min(...[from, to].flatMap((bg) => [contrastRatio(ink, bg), contrastRatio(at90(ink, bg), bg)]));

export interface Band {
  from: string;
  to: string;
  /** The words: white or the site's near-black. */
  ink: string;
  /**
   * What chips and the ghost buttons lay over the band: the opposite of the ink (black under white words, white
   * under dark ones), so a chip only ever adds contrast.
   */
  veil: string;
}
const BLACK_HEX = '#000000';
const veilFor = (ink: string) => (ink === WHITE ? BLACK_HEX : WHITE);
/** The pages around a band: the card and the page ground, light and dark (index.css --c-surface / --c-ground). */
const PAGES = { light: ['#ffffff', '#f4f2f0'], dark: ['#241f1d', '#181413'] } as const;
/** Far enough from the page that the band never washes out. */
const STANDS_OUT = 1.35;

/** The darker end: the colour 18% of the way to black. */
const darkerEnd = (from: string) => mix(from, BLACK, 0.18);

/**
 * 1.24.4: a custom colour's band in one mode — the colour first (a very light one darkened, or a very dark one
 * lightened in dark mode, until both ends stand out from the page), to a darker shade of it; then white or dark text,
 * whichever reads at least 4.5:1 on both ends. If neither does (a middle grey), the band darkens a little at a time.
 */
function customBand(hex: string, mode: 'light' | 'dark'): Band {
  let from = hex.toLowerCase();
  const apart = (c: string) => Math.min(...PAGES[mode].map((p) => contrastRatio(c, p)));
  const standsOut = (f: string) => apart(f) >= STANDS_OUT && apart(darkerEnd(f)) >= STANDS_OUT;
  for (let i = 0; i < 80 && !standsOut(from); i++) {
    from = mode === 'light' || luminance(from) > 0.2 ? mix(from, BLACK, 0.04) : mix(from, WHITE_RGB, 0.04);
  }
  let to = darkerEnd(from);
  for (let i = 0; i < 80; i++) {
    const [w, d] = [readableOn(WHITE, from, to), readableOn(DARK_INK, from, to)];
    if (Math.max(w, d) >= 4.5) {
      const ink = w >= d ? WHITE : DARK_INK;
      return { from, to, ink, veil: veilFor(ink) };
    }
    from = mix(from, BLACK, 0.06);
    to = mix(to, BLACK, 0.06);
  }
  return { from, to, ink: WHITE, veil: BLACK_HEX };
}

/** Bands already worked out (a list draws many tiles in the same few colours). */
const CUSTOM_LOOKS = new Map<string, { light: Band; dark: Band }>();

/**
 * The band for a stored theme in light and dark mode: a theme's name, a custom colour, or Ruby for anything else
 * (a name from a newer version, a broken value) — never a crash.
 */
export function themeLook(theme: unknown): { light: Band; dark: Band } {
  if (isCustomColour(theme)) {
    const key = theme.toLowerCase();
    let look = CUSTOM_LOOKS.get(key);
    if (!look) {
      look = { light: customBand(key, 'light'), dark: customBand(key, 'dark') };
      if (CUSTOM_LOOKS.size > 500) CUSTOM_LOOKS.clear();
      CUSTOM_LOOKS.set(key, look);
    }
    return look;
  }
  const look = typeof theme === 'string' && Object.prototype.hasOwnProperty.call(THEME_LOOK, theme) ? THEME_LOOK[theme as AppreciationThemeName] : THEME_LOOK.ruby;
  const band = { from: look.from, to: look.to, ink: WHITE, veil: BLACK_HEX };
  return { light: band, dark: look.dark ? { ...look.dark, ink: WHITE, veil: BLACK_HEX } : band };
}

const channels = (hex: string) => rgbOf(hex).join(' ');
/**
 * The inline style for an element with the `ap-band` class (index.css): the colours as CSS variables, so the dark
 * theme takes its own and the words inside follow the band's ink (`ap-ink-90`), chips and ghost buttons its veil.
 */
export function themeStyle(theme: unknown): CSSProperties {
  const { light, dark } = themeLook(theme);
  return {
    '--ap-l1': light.from,
    '--ap-l2': light.to,
    '--ap-li': channels(light.ink),
    '--ap-lv': channels(light.veil),
    '--ap-d1': dark.from,
    '--ap-d2': dark.to,
    '--ap-di': channels(dark.ink),
    '--ap-dv': channels(dark.veil),
  } as CSSProperties;
}
/** The light-mode gradient (a small swatch). */
export const themeGradient = (t: unknown): string => {
  const { light } = themeLook(t);
  return `linear-gradient(135deg, ${light.from}, ${light.to})`;
};

export const ICON_LABEL: Record<AppreciationIcon, string> = {
  star: 'Star',
  team: 'Team',
  trophy: 'Trophy',
  bulb: 'Light bulb',
  heart: 'Heart',
  medal: 'Medal',
  shield: 'Shield',
  clock: 'Clock',
  rocket: 'Rocket',
  target: 'Target',
  'thumbs-up': 'Thumbs up',
  handshake: 'Handshake',
  crown: 'Crown',
  flag: 'Flag',
  gift: 'Gift',
  sparkles: 'Sparkles',
  award: 'Award ribbon',
  lightning: 'Lightning',
  smile: 'Smile',
  sun: 'Sun',
};
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

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
/**
 * 1.24.2: '2026-11-20' → 'Thu 20 Nov' (the Send page's day and action bar). The key is already a day in the company's
 * calendar, so its weekday is the same in every time zone.
 */
export function dayShort(day: string): string {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  return `${WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()] ?? ''} ${d} ${MONTHS[m - 1] ?? ''}`;
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
