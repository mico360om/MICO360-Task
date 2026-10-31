import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { FONT_FACES } from './typography';
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

it('the splash is the app.json splash: its background and its picture, contained', () => {
  const manifest = JSON.parse(readFileSync(appPath('app.json'), 'utf8')) as { expo: { splash: { image: string; backgroundColor: string; resizeMode: string } } };
  const splash = src('components/FontSplash.tsx');
  expect(manifest.expo.splash).toMatchObject({ image: './assets/logo.png', backgroundColor: '#8B1E1E', resizeMode: 'contain' });
  expect(splash).toContain("import SPLASH_IMAGE from '../../assets/logo.png';");
  expect(splash).toMatch(/backgroundColor: lightColors\.brand/);
  expect(splash).toMatch(/resizeMode="contain"/);
});

it('the fonts hook waits at most FONT_WAIT_MS, and keeps its first answer', () => {
  const s = src('core/fonts.ts');
  expect(s).toMatch(/const \[loaded, error\] = useFonts\(FONT_ASSETS\);/);
  expect(s).toMatch(/setTimeout\(\(\) => setTimedOut\(true\), FONT_WAIT_MS\)/);
  expect(s).toMatch(/fontGate\(decided\.current, \{ loaded, error: error != null, timedOut \}\)/);
});
