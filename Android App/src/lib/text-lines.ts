/**
 * How many lines a text is cut after (device check C): `lines` at the phone's normal font size or
 * smaller, none when the font is enlarged. Android keeps room for the "…" at the text's unenlarged
 * size in its plain system font and draws it enlarged in the brand face, so at a larger font the
 * dots ran past the edge ("Al Khuwair Tower — Si."); shown in full there is no "…" to lose.
 */
export function lineCap(lines: number, fontScale: number): number | undefined {
  return fontScale > 1 ? undefined : lines;
}
