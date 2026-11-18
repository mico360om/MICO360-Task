import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

/**
 * The app ships its own fonts. Loading them from another site (Google Fonts) stalled every page
 * when that site was slow or unreachable — an office install without internet never got them —
 * and told a third party about each visit.
 */
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const html = readFileSync(resolve(root, 'index.html'), 'utf8');
const css = readFileSync(resolve(root, 'src/index.css'), 'utf8');
const faces = css.match(/@font-face\s*\{[^}]*\}/g) ?? [];

describe('fonts are bundled with the app', () => {
  it('the page asks no other site for fonts or styles', () => {
    expect(html).not.toMatch(/fonts\.googleapis\.com|fonts\.gstatic\.com/);
    expect(html).not.toMatch(/<link[^>]+rel="stylesheet"[^>]+href="https?:/);
    expect(css).not.toMatch(/@import\s+url\(["']?https?:/);
  });

  it('declares every weight the design uses', () => {
    const plex = faces.filter((f) => /font-family:\s*'IBM Plex Sans'/.test(f));
    for (const weight of [400, 500, 600, 700]) {
      expect(plex.some((f) => f.replace(/\s+/g, ' ').includes(`font-weight: ${weight};`)), `IBM Plex Sans ${weight}`).toBe(true);
    }
    // Archivo (headings) has one plain file per weight. A single variable-weight file is smaller, but
    // not every engine applies its weight axis — headings then came out thin.
    const archivo = faces.filter((f) => /font-family:\s*'Archivo'/.test(f));
    for (const weight of [600, 700, 800, 900]) {
      expect(archivo.some((f) => f.replace(/\s+/g, ' ').includes(`font-weight: ${weight};`)), `Archivo ${weight}`).toBe(true);
    }
    expect(archivo.some((f) => /font-weight:\s*100 900/.test(f)), 'no variable-weight face').toBe(false);
  });

  it('shows text at once in a fallback font and points at files that exist', () => {
    expect(faces.length).toBeGreaterThan(0);
    for (const face of faces) {
      expect(face).toMatch(/font-display:\s*swap/);
      // 1.23.35: a face may also be a font file from an installed @expo-google-fonts package (the certificate's Great
      // Vibes, the same file the server's PDF uses); Vite bundles it like the others.
      const local = /url\(['"]?(\.\/assets\/fonts\/[^'")]+\.woff2)['"]?\)/.exec(face)?.[1];
      const pkg = /url\(['"]?(@expo-google-fonts\/[a-z0-9-]+\/[^'")]+\.ttf)['"]?\)/.exec(face)?.[1];
      expect(local ?? pkg, face.slice(0, 80)).toBeTruthy();
      if (local) expect(existsSync(resolve(root, 'src', local)), local).toBe(true);
      else expect(existsSync(createRequire(import.meta.url).resolve(pkg!)), pkg).toBe(true);
    }
  });

  it('the certificate’s script face comes from its package, with its licence beside the others', () => {
    const vibes = faces.find((f) => /font-family:\s*'Great Vibes'/.test(f));
    expect(vibes).toMatch(/url\('@expo-google-fonts\/great-vibes\/400Regular\/GreatVibes_400Regular\.ttf'\)/);
    expect(existsSync(resolve(root, 'src/assets/fonts/LICENSE-Great-Vibes.txt'))).toBe(true);
  });
});
