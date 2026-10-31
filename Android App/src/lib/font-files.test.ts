import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { FONT_FACES } from './typography';
import { splashLogoSize } from './splash';
import { ARCHIVO_BOLD_ADVANCE, PLEX_SEMIBOLD_ADVANCE, textWidthEm } from './font-metrics';
import { appPath, appSource as src, hasWeb, sha256, webPath } from '../testing/web-source';

it('bundles every face as a TrueType file that the app loads by name', () => {
  expect(Object.keys(FONT_FACES)).toHaveLength(8);
  for (const face of Object.keys(FONT_FACES)) {
    const buf = readFileSync(appPath(`assets/fonts/${face}.ttf`));
    expect(buf.readUInt32BE(0), face).toBe(0x00010000);
    expect(buf.length, face).toBeGreaterThan(20_000);
    expect(src('core/fonts.ts')).toContain(`'${face}': require('../../assets/fonts/${face}.ttf')`);
  }
  for (const l of ['LICENSE-IBM-Plex-Sans.txt', 'LICENSE-Archivo.txt']) expect(existsSync(appPath(`assets/fonts/${l}`))).toBe(true);
});

describe.skipIf(!hasWeb('frontend/src/assets/fonts'))('made from the website’s own font files', () => {
  it('SOURCES.json matches the website’s woff2 files (re-run convert-fonts.py when they change)', () => {
    const sources = JSON.parse(readFileSync(appPath('assets/fonts/SOURCES.json'), 'utf8')) as Record<string, { sources: Record<string, string> }>;
    expect(Object.keys(sources).sort()).toEqual(Object.keys(FONT_FACES).sort());
    for (const { sources: files } of Object.values(sources)) {
      for (const [file, sum] of Object.entries(files)) expect(sha256(webPath(`frontend/src/assets/fonts/${file}`)), file).toBe(sum);
    }
  });
});

it('has Plex SemiBold widths for every printable ASCII letter', () => {
  expect(Object.keys(PLEX_SEMIBOLD_ADVANCE)).toHaveLength(95);
  const w = textWidthEm('Dashboard');
  expect(w).toBeGreaterThan(4);
  expect(w).toBeLessThan(6);
  expect(textWidthEm('é')).toBe(0.6); // outside ASCII: the fallback width
});

// Stage 2 fix pass B5: the project card's figures (Archivo Bold, the display face) are measured too.
it('has Archivo Bold widths for every printable ASCII letter, its digits all but equal', () => {
  expect(Object.keys(ARCHIVO_BOLD_ADVANCE)).toHaveLength(95);
  const digits = [...'0123456789'].map((d) => ARCHIVO_BOLD_ADVANCE[d]!);
  expect(Math.max(...digits) - Math.min(...digits)).toBeLessThan(0.005);
  expect(textWidthEm('Tomorrow', ARCHIVO_BOLD_ADVANCE)).toBeGreaterThan(textWidthEm('Today', ARCHIVO_BOLD_ADVANCE));
});

// Final review L4: while the fonts load the app shows the splash's own picture (rendering nothing showed
// a blank screen, not the native splash); then it picks the faces and only then loads the screens, so
// every style — those made when a file loads too — is made for the faces the phone really has.
it('App shows the splash while the fonts load, picks the faces, then loads the app', () => {
  const app = src('../App.tsx');
  expect(app).toMatch(/const fonts = useBrandFonts\(\);\s*if \(fonts === 'wait'\) return <FontSplash \/>;/);
  expect(app).toMatch(/setBrandFaces\(fonts === 'brand'\);/);
  expect(app).toMatch(/const AppRoot = lazy\(\(\) => import\('\.\/src\/AppRoot'\)\);/);
  expect(app).not.toMatch(/from '\.\/src\/(navigation|components\/ErrorBoundary|core\/providers|core\/theme)/); // loaded only after the faces are set
});

// Re-check J (31 Oct): the starting screen showed the icon square (logo.png, with a black triangle in
// its tick) far too big at the top left. It is the website's white MICO360 logo, centred and
// contained, about 60% of the screen wide (280 dp at most), on the maroon — app.json's splash too.
it('the splash is the app.json splash: the maroon, and the white MICO360 logo centred at a fixed width', () => {
  const manifest = JSON.parse(readFileSync(appPath('app.json'), 'utf8')) as { expo: { splash: { image: string; backgroundColor: string; resizeMode: string } } };
  const splash = src('components/FontSplash.tsx');
  expect(manifest.expo.splash).toMatchObject({ image: './assets/brand/logo-w.png', backgroundColor: '#8B1E1E', resizeMode: 'contain' });
  expect(splash).toContain("import SPLASH_LOGO from '../../assets/brand/logo-w.png';");
  expect(splash).not.toMatch(/assets\/logo\.png/);
  expect(splash).toMatch(/backgroundColor: lightColors\.brand/);
  expect(splash).toMatch(/fill: \{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: lightColors\.brand \}/);
  expect(splash).toMatch(/const size = splashLogoSize\(useWindowDimensions\(\)\.width\);/);
  expect(splash).toMatch(/<Image source=\{SPLASH_LOGO\} style=\{size\} resizeMode="contain"/);
  expect(splashLogoSize(360)).toEqual({ width: 216, height: Math.round((216 * 192) / 409) });
  expect(splashLogoSize(411)).toEqual({ width: 247, height: Math.round((247 * 192) / 409) });
  expect(splashLogoSize(800)).toEqual({ width: 280, height: Math.round((280 * 192) / 409) });
});

it('the fonts hook waits at most FONT_WAIT_MS, and keeps its first answer', () => {
  const s = src('core/fonts.ts');
  expect(s).toMatch(/const \[loaded, error\] = useFonts\(FONT_ASSETS\);/);
  expect(s).toMatch(/setTimeout\(\(\) => setTimedOut\(true\), FONT_WAIT_MS\)/);
  expect(s).toMatch(/fontGate\(decided\.current, \{ loaded, error: error != null, timedOut \}\)/);
});
