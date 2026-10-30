/**
 * The website's type: IBM Plex Sans for body and UI text, Archivo for titles and big numbers, the
 * same files the website bundles (assets/fonts, made by tools/fonts/convert-fonts.py, loaded by
 * core/fonts.ts before the first screen). Pure TS (no RN imports) so the scale is unit-testable.
 *
 * Android picks a bundled face by its family name, one file per weight. A `fontWeight` on top of a
 * loaded face makes Android draw a fake bold, so styles never set `fontWeight`: they use `font()`
 * or `typeStyle()`, which name the face.
 */

export type FontWeight = '400' | '500' | '600' | '700' | '800' | '900';

export type FontFace =
  | 'IBMPlexSans-Regular'
  | 'IBMPlexSans-Medium'
  | 'IBMPlexSans-SemiBold'
  | 'IBMPlexSans-Bold'
  | 'Archivo-SemiBold'
  | 'Archivo-Bold'
  | 'Archivo-ExtraBold'
  | 'Archivo-Black';

type Family = 'body' | 'display';

/** Every bundled face, its family and weight. */
export const FONT_FACES: Record<FontFace, { family: Family; weight: FontWeight }> = {
  'IBMPlexSans-Regular': { family: 'body', weight: '400' },
  'IBMPlexSans-Medium': { family: 'body', weight: '500' },
  'IBMPlexSans-SemiBold': { family: 'body', weight: '600' },
  'IBMPlexSans-Bold': { family: 'body', weight: '700' },
  'Archivo-SemiBold': { family: 'display', weight: '600' },
  'Archivo-Bold': { family: 'display', weight: '700' },
  'Archivo-ExtraBold': { family: 'display', weight: '800' },
  'Archivo-Black': { family: 'display', weight: '900' },
};

const BODY: Record<FontWeight, FontFace> = {
  '400': 'IBMPlexSans-Regular',
  '500': 'IBMPlexSans-Medium',
  '600': 'IBMPlexSans-SemiBold',
  '700': 'IBMPlexSans-Bold',
  '800': 'IBMPlexSans-Bold',
  '900': 'IBMPlexSans-Bold',
};

const DISPLAY: Record<FontWeight, FontFace> = {
  '400': 'Archivo-SemiBold',
  '500': 'Archivo-SemiBold',
  '600': 'Archivo-SemiBold',
  '700': 'Archivo-Bold',
  '800': 'Archivo-ExtraBold',
  '900': 'Archivo-Black',
};

/** The bundled face nearest to `weight` in a family (body has no 800/900, display no 400/500). */
export function fontFamilyFor(family: Family, weight: FontWeight): FontFace {
  return (family === 'display' ? DISPLAY : BODY)[weight];
}

/** The style that sets a weight: the face's family name ('normal' = 400, 'bold' = 700). */
export function font(weight: FontWeight | 'normal' | 'bold', family: Family = 'body'): { fontFamily: FontFace } {
  const w: FontWeight = weight === 'normal' ? '400' : weight === 'bold' ? '700' : weight;
  return { fontFamily: fontFamilyFor(family, w) };
}

export type TypeRole =
  | 'display'
  | 'title'
  | 'heading'
  | 'subheading'
  | 'body'
  | 'bodyStrong'
  | 'label'
  | 'caption'
  | 'eyebrow'
  | 'badge'
  | 'button'
  | 'tab'
  | 'number';

export interface TypeStyle {
  fontFamily: FontFace;
  fontSize: number;
  lineHeight: number;
  letterSpacing?: number;
  textTransform?: 'uppercase';
  /** Figures that line up in columns. */
  fontVariant?: ['tabular-nums'];
}

const SCALE: Record<TypeRole, TypeStyle> = {
  display: { fontFamily: 'Archivo-ExtraBold', fontSize: 30, lineHeight: 36, letterSpacing: -0.3, fontVariant: ['tabular-nums'] },
  title: { fontFamily: 'Archivo-ExtraBold', fontSize: 22, lineHeight: 28, letterSpacing: -0.2 },
  heading: { fontFamily: 'Archivo-Bold', fontSize: 18, lineHeight: 24 },
  subheading: { fontFamily: 'IBMPlexSans-SemiBold', fontSize: 15, lineHeight: 20 },
  body: { fontFamily: 'IBMPlexSans-Regular', fontSize: 14, lineHeight: 20 },
  bodyStrong: { fontFamily: 'IBMPlexSans-SemiBold', fontSize: 14, lineHeight: 20 },
  label: { fontFamily: 'IBMPlexSans-Medium', fontSize: 14, lineHeight: 20 },
  caption: { fontFamily: 'IBMPlexSans-Regular', fontSize: 12, lineHeight: 16 },
  eyebrow: { fontFamily: 'IBMPlexSans-SemiBold', fontSize: 11, lineHeight: 14, textTransform: 'uppercase', letterSpacing: 0.55 },
  badge: { fontFamily: 'IBMPlexSans-SemiBold', fontSize: 11, lineHeight: 14, textTransform: 'uppercase', letterSpacing: 0.3 },
  button: { fontFamily: 'IBMPlexSans-SemiBold', fontSize: 14, lineHeight: 20 },
  tab: { fontFamily: 'IBMPlexSans-SemiBold', fontSize: 11, lineHeight: 14 },
  number: { fontFamily: 'IBMPlexSans-SemiBold', fontSize: 14, lineHeight: 20, fontVariant: ['tabular-nums'] },
};

/** A role's React-Native-ready text style (a fresh copy, safe to spread and extend). */
export function typeStyle(role: TypeRole): TypeStyle {
  const s = SCALE[role];
  return { ...s, ...(s.fontVariant ? { fontVariant: [...s.fontVariant] as ['tabular-nums'] } : {}) };
}
