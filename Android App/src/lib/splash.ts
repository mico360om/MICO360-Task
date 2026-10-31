/**
 * The starting screen's logo (components/FontSplash, re-check J): the website's white MICO360 logo
 * (assets/brand/logo-w.png, 409 × 192), centred on the maroon, 60% of the screen's width — 280 dp at
 * most — at its own proportions.
 */
export const SPLASH_LOGO = { share: 0.6, maxWidth: 280, ratio: 192 / 409 } as const;

export function splashLogoSize(screenWidth: number): { width: number; height: number } {
  const width = Math.min(Math.round(screenWidth * SPLASH_LOGO.share), SPLASH_LOGO.maxWidth);
  return { width, height: Math.round(width * SPLASH_LOGO.ratio) };
}
