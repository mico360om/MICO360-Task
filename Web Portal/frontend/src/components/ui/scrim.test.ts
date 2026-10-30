import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import config from '../../../tailwind.config.js';

// Every dialog, sheet and panel dims the page behind it with the one shared scrim (bg-scrim): a
// tint of the ink colour turns into a light-grey wash in dark mode, where ink is near-white.
const src = resolve(__dirname, '../..');
const files = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? files(join(dir, e.name)) : /\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [join(dir, e.name)] : [],
  );

describe('dialog backdrops', () => {
  it('the scrim is one dark colour, the same in light and dark mode', () => {
    expect((config.theme.extend.colors as Record<string, unknown>).scrim).toBe('rgb(0 0 0 / 0.5)');
  });

  it('no full-screen layer tints the page with ink (or another per-file colour) instead of the shared scrim', () => {
    const offenders = files(src).flatMap((f) =>
      readFileSync(f, 'utf8')
        .split('\n')
        .map((line, i) => ({ line, at: `${relative(src, f)}:${i + 1}` }))
        .filter(({ line }) => /\binset-0\b/.test(line) && /\bbg-(ink|black|ground|surface)\/\d+/.test(line) && !/\bbg-black\/85\b/.test(line)),
    );
    expect(offenders.map((o) => o.at)).toEqual([]);
  });

  it('dialogs use it', () => {
    const uses = files(src).filter((f) => /\binset-0\b[^"]*\bbg-scrim\b|\bbg-scrim\b[^"]*\binset-0\b/.test(readFileSync(f, 'utf8')));
    expect(uses.length).toBeGreaterThanOrEqual(25);
  });
});
