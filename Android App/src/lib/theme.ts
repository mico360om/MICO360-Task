/**
 * MICO360 design tokens — the website's own values (Web Portal/frontend/src/index.css `:root` and
 * `:root[data-theme='dark']`, tailwind.config.js), light and dark. `lib/theme-tokens.test.ts` fails
 * when the website changes them; `lib/contrast.test.ts` keeps every text pair at 4.5:1 or better.
 *
 * Fills, borders and icons on a fill use the colours (`brand`, `danger`, …); TEXT uses the text
 * tones (`brandText`, `dangerText`, `successText`, `warningText`, `infoText`), dark enough for 4.5:1
 * on the surface, the page ground and their own soft tint. `ink3` is never put on `brandWash`.
 */
export interface Palette {
  brand: string;
  /** The brand colour as text (lighter than the fill in dark mode). */
  brandText: string;
  brand2: string;
  brand3: string;
  brandInk: string;
  ink: string;
  ink2: string;
  ink3: string;
  line: string;
  line2: string;
  surface: string;
  surface2: string;
  ground: string;
  ground2: string;
  danger: string;
  dangerSoft: string;
  dangerText: string;
  success: string;
  successSoft: string;
  successText: string;
  warning: string;
  warningSoft: string;
  warningText: string;
  info: string;
  infoSoft: string;
  infoText: string;
  /** Meetings on the timeline. */
  meeting: string;
  /** Text and icons on the brand fill, the brand gradient and the danger fill. */
  onBrand: string;
  /** What a dialog or sheet lays over the page behind it — the same dark wash in both themes. */
  scrim: string;
  /** The brand at 10% on the surface: selected and highlighted rows. */
  brandWash: string;
  /** Kanban column category colours. */
  category: {
    BACKLOG: string;
    TODO: string;
    IN_PROGRESS: string;
    BLOCKED: string;
    REVIEW: string;
    DONE: string;
  };
}

const channels = (hex: string): [number, number, number] => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) throw new Error(`Invalid hex colour: ${hex}`);
  const int = parseInt(m[1]!, 16);
  return [(int >> 16) & 255, (int >> 8) & 255, int & 255];
};

/** `fg` laid at `alpha` over `bg`, as the opaque colour that results (upper-case #RRGGBB). */
export function mixHex(fg: string, bg: string, alpha: number): string {
  const f = channels(fg);
  const b = channels(bg);
  return `#${f.map((c, i) => Math.round(c * alpha + b[i]! * (1 - alpha)).toString(16).toUpperCase().padStart(2, '0')).join('')}`;
}

const luminance = (hex: string): number => {
  const [r, g, b] = channels(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

/** WCAG 2.1 contrast ratio of two #RRGGBB colours (1–21). */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

const SCRIM = 'rgba(0, 0, 0, 0.5)';

const LIGHT = {
  brand: '#8B1E1E',
  brandText: '#8B1E1E',
  brand2: '#A83326',
  brand3: '#C7513F',
  brandInk: '#5E1414',
  ink: '#211B1A',
  ink2: '#6C625F',
  ink3: '#736965',
  line: '#E6DFDC',
  line2: '#EFEAE7',
  surface: '#FFFFFF',
  surface2: '#FBFAF9',
  ground: '#F4F2F0',
  ground2: '#EFECE9',
  danger: '#CB4632',
  dangerSoft: '#FBEDEA',
  dangerText: '#C0422F',
  success: '#2E7D53',
  successSoft: '#E9F4EE',
  successText: '#2C7850',
  warning: '#B87611',
  warningSoft: '#FBF1E1',
  warningText: '#9A630E',
  info: '#3A6EA5',
  infoSoft: '#E9F0F7',
  infoText: '#3A6EA5',
  meeting: '#7A5AA8',
  onBrand: '#FFFFFF',
  scrim: SCRIM,
  category: {
    BACKLOG: '#948985',
    TODO: '#9A918D',
    IN_PROGRESS: '#B87611',
    BLOCKED: '#CB4632',
    REVIEW: '#3A6EA5',
    DONE: '#2E7D53',
  },
};

const DARK = {
  brand: '#BC3E2C',
  brandText: '#E07A66',
  brand2: '#C7513F',
  brand3: '#D86C5A',
  brandInk: '#781E1E',
  ink: '#F4F0EE',
  ink2: '#B2A8A3',
  ink3: '#968C87',
  line: '#3A322F',
  line2: '#302927',
  surface: '#241F1D',
  surface2: '#2C2624',
  ground: '#181413',
  ground2: '#201B19',
  danger: '#C84836',
  dangerSoft: '#3A2320',
  dangerText: '#E86A57',
  success: '#4AB07A',
  successSoft: '#1E2E26',
  successText: '#4AB07A',
  warning: '#DC9E42',
  warningSoft: '#362A18',
  warningText: '#DC9E42',
  info: '#6CA0D6',
  infoSoft: '#1C2632',
  infoText: '#6CA0D6',
  meeting: '#B296DE',
  onBrand: '#FFFFFF',
  scrim: SCRIM,
  category: {
    BACKLOG: '#A89D98',
    TODO: '#ACA39E',
    IN_PROGRESS: '#D6983C',
    BLOCKED: '#E26452',
    REVIEW: '#689CD2',
    DONE: '#46AC76',
  },
};

/** The website's light palette (`:root`). */
export const lightColors: Palette = { ...LIGHT, brandWash: mixHex(LIGHT.brand, LIGHT.surface, 0.1) };

/** The website's dark palette (`:root[data-theme='dark']`). */
export const darkColors: Palette = { ...DARK, brandWash: mixHex(DARK.brand, DARK.surface, 0.1) };

/** The brand gradient of primary buttons and the active menu row (135°), the same in dark mode. */
export const BRAND_GRADIENT = {
  colors: ['#A83326', '#8B1E1E', '#5E1414'],
  locations: [0, 0.55, 1],
  start: { x: 0, y: 0 },
  end: { x: 1, y: 1 },
} as const;

export type ShadowStyle = {
  elevation: number;
  shadowColor: string;
  shadowOpacity: number;
  shadowRadius: number;
  shadowOffset: { width: number; height: number };
};

/** The website's shadow-soft / -card / -lift / -brand as an Android elevation (+ the iOS-style props). */
export const shadow: Record<'soft' | 'card' | 'lift' | 'brand', ShadowStyle> = {
  soft: { elevation: 1, shadowColor: '#211B1A', shadowOpacity: 0.06, shadowRadius: 3, shadowOffset: { width: 0, height: 1 } },
  card: { elevation: 2, shadowColor: '#211B1A', shadowOpacity: 0.1, shadowRadius: 12, shadowOffset: { width: 0, height: 4 } },
  lift: { elevation: 6, shadowColor: '#211B1A', shadowOpacity: 0.2, shadowRadius: 20, shadowOffset: { width: 0, height: 10 } },
  brand: { elevation: 4, shadowColor: '#8B1E1E', shadowOpacity: 0.35, shadowRadius: 10, shadowOffset: { width: 0, height: 6 } },
};

/** Resolve a palette from the OS colour scheme (null/undefined → light). */
export function resolveColors(scheme: 'light' | 'dark' | null | undefined): Palette {
  return scheme === 'dark' ? darkColors : lightColors;
}

/** Default (light) palette — kept for pure modules and the theme default. */
export const colors = lightColors;

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
/** The website's radii (rounded-md 6 badges, rounded-lg 8 fields, rounded-xl 14 buttons, rounded-2xl 18 cards, rounded-3xl 24 sheets). `sm`/`md`/`lg` are the old names, kept until every screen uses the new ones. */
export const radius = { badge: 6, input: 8, button: 14, card: 18, sheet: 24, pill: 999, sm: 6, md: 10, lg: 14 } as const;
export const fontSize = { xs: 11, sm: 13, md: 15, lg: 18, xl: 22, xxl: 28 } as const;

/** Convert a #rrggbb hex to an rgba() string (for translucent brand fills). */
export function hexToRgba(hex: string, alpha: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) throw new Error(`Invalid hex colour: ${hex}`);
  const int = parseInt(m[1]!, 16);
  const r = (int >> 16) & 255;
  const g = (int >> 8) & 255;
  const b = int & 255;
  const a = Math.min(1, Math.max(0, alpha));
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

/** Colour for a Kanban column category, falling back to the brand colour. */
export function categoryColor(category: string): string {
  return (colors.category as Record<string, string>)[category] ?? colors.brand;
}

/** Category colour from a specific palette (theme-aware). */
export function categoryColorOf(palette: Palette, category: string): string {
  return (palette.category as Record<string, string>)[category] ?? palette.brand;
}

export const theme = { colors, spacing, radius, fontSize } as const;
export type Theme = typeof theme;
