/**
 * Typography tokens ported from the web design system. The web pairs a display face (Archivo)
 * with a body face (IBM Plex Sans); the mobile app carries the same type scale and role names.
 * Weights carry the hierarchy on the system font out of the box; when the brand faces are loaded
 * (expo-font — see App.tsx), pass `brandFonts: true` to apply them. Pure TS (no RN imports) so
 * the scale is unit-testable.
 */

export type FontWeight = 'normal' | 'bold' | '400' | '500' | '600' | '700' | '800';

/** Brand faces, applied only once loaded; falls back to the platform system font otherwise. */
export const fontFamilies = {
  display: 'Archivo', // titles / headings
  body: 'IBMPlexSans', // body / UI text
} as const;
export type FontFamilyRole = keyof typeof fontFamilies;

export type TypeRole =
  | 'display'
  | 'title'
  | 'heading'
  | 'subheading'
  | 'body'
  | 'bodyStrong'
  | 'label'
  | 'caption';

export interface TypeStyle {
  fontSize: number;
  fontWeight: FontWeight;
  lineHeight: number;
  letterSpacing?: number;
  /** Which brand face this role uses when brand fonts are loaded. */
  family: FontFamilyRole;
}

/** The type scale — one entry per role. Sizes align with `fontSize` in theme.ts. */
export const typeScale: Record<TypeRole, TypeStyle> = {
  display: { fontSize: 28, fontWeight: '700', lineHeight: 34, letterSpacing: -0.5, family: 'display' },
  title: { fontSize: 22, fontWeight: '700', lineHeight: 28, letterSpacing: -0.3, family: 'display' },
  heading: { fontSize: 18, fontWeight: '700', lineHeight: 24, family: 'display' },
  subheading: { fontSize: 15, fontWeight: '600', lineHeight: 20, family: 'body' },
  body: { fontSize: 15, fontWeight: '400', lineHeight: 22, family: 'body' },
  bodyStrong: { fontSize: 15, fontWeight: '600', lineHeight: 22, family: 'body' },
  label: { fontSize: 13, fontWeight: '600', lineHeight: 16, letterSpacing: 0.3, family: 'body' },
  caption: { fontSize: 11, fontWeight: '500', lineHeight: 14, letterSpacing: 0.2, family: 'body' },
};

export interface ResolvedType {
  fontSize: number;
  fontWeight: FontWeight;
  lineHeight: number;
  letterSpacing?: number;
  fontFamily?: string;
}

/**
 * Resolve a role to a React-Native-ready style object. Applies the brand `fontFamily` only when
 * `brandFonts` is true (i.e. the fonts have actually been loaded), so text renders correctly on
 * the system font until then.
 */
export function typeStyle(role: TypeRole, opts: { brandFonts?: boolean } = {}): ResolvedType {
  const t = typeScale[role];
  const out: ResolvedType = { fontSize: t.fontSize, fontWeight: t.fontWeight, lineHeight: t.lineHeight };
  if (t.letterSpacing !== undefined) out.letterSpacing = t.letterSpacing;
  if (opts.brandFonts) out.fontFamily = fontFamilies[t.family];
  return out;
}
