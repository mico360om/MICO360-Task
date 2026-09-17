/** MICO360 design tokens ported to the mobile app (A0.2). Single source of brand truth. */
export const lightColors = {
  brand: '#8B1E1E',
  brand2: '#A83326',
  ink: '#211B1A',
  ink2: '#6C625F',
  ink3: '#948985',
  line: '#E6DFDC',
  surface: '#FFFFFF',
  ground: '#F4F2F0',
  // Semantic tones (match the web app's danger/success/warning/info + soft washes).
  danger: '#CB4632',
  dangerSoft: '#FBEDEA',
  success: '#2E7D53',
  successSoft: '#E9F4EE',
  warning: '#B87611',
  warningSoft: '#FBF1E1',
  info: '#3A6EA5',
  infoSoft: '#E9F0F7',
  onBrand: '#FFFFFF',
  // translucent brand fill for selected / highlighted rows
  brandWash: '#FBEDEA',
  errorWash: '#FCEBE8',
  // Kanban column category colours (match the web app).
  category: {
    BACKLOG: '#948985',
    TODO: '#9A918D',
    IN_PROGRESS: '#B87611',
    BLOCKED: '#CB4632',
    REVIEW: '#3A6EA5',
    DONE: '#2E7D53',
  },
} as const;

/** Dark palette — same roles, dark grounds + lightened brand/category for contrast. */
export const darkColors: Palette = {
  brand: '#D2564A',
  brand2: '#E0665A',
  ink: '#F4F2F0',
  ink2: '#B8ADA9',
  ink3: '#8A7F7B',
  line: '#322C2A',
  surface: '#1E1A19',
  ground: '#141110',
  danger: '#E86A57',
  dangerSoft: '#3A2320',
  success: '#4AB07A',
  successSoft: '#1E2E26',
  warning: '#DC9E42',
  warningSoft: '#362A18',
  info: '#6CA0D6',
  infoSoft: '#1C2632',
  onBrand: '#FFFFFF',
  brandWash: '#3A211E',
  errorWash: '#3A211E',
  category: {
    BACKLOG: '#A79B97',
    TODO: '#ABA29E',
    IN_PROGRESS: '#D69A3C',
    BLOCKED: '#E56A58',
    REVIEW: '#6FA0D6',
    DONE: '#5BB588',
  },
};

export interface Palette {
  brand: string;
  brand2: string;
  ink: string;
  ink2: string;
  ink3: string;
  line: string;
  surface: string;
  ground: string;
  danger: string;
  dangerSoft: string;
  success: string;
  successSoft: string;
  warning: string;
  warningSoft: string;
  info: string;
  infoSoft: string;
  onBrand: string;
  brandWash: string;
  errorWash: string;
  category: {
    BACKLOG: string;
    TODO: string;
    IN_PROGRESS: string;
    BLOCKED: string;
    REVIEW: string;
    DONE: string;
  };
}

/** Resolve a palette from the OS colour scheme (null/undefined → light). */
export function resolveColors(scheme: 'light' | 'dark' | null | undefined): Palette {
  return scheme === 'dark' ? darkColors : lightColors;
}

/** Default (light) palette — kept for pure modules and the theme default. */
export const colors = lightColors;

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const radius = { sm: 6, md: 10, lg: 14, pill: 999 } as const;
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
