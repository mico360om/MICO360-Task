import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { FONT_FACES } from './typography';
import { PLEX_SEMIBOLD_ADVANCE, textWidthEm } from './font-metrics';
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

it('App renders nothing until the fonts are ready', () => expect(src('../App.tsx')).toMatch(/const fontsReady = useBrandFonts\(\);\s*if \(!fontsReady\) return null;/));

it('the fonts hook gives up waiting when loading fails, so the app still opens', () => {
  const s = src('core/fonts.ts');
  expect(s).toMatch(/const \[loaded, error\] = useFonts\(FONT_ASSETS\);/);
  expect(s).toMatch(/return loaded \|\| error != null;/);
});
