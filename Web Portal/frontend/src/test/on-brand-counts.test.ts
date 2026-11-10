import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

/**
 * 1.23.8 page walk: a count on a chosen (brand-filled) tab must keep white words at 4.5:1. A white wash
 * (`bg-white/25`) lightens the brand under it — 3.5:1 in dark mode on the Error log's tabs — so counts on the
 * brand use a dark wash (`bg-black/20`) instead.
 */
const SRC = resolve(__dirname, '..');
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return files(p);
    return /\.tsx$/.test(name) && !/\.test\.tsx$/.test(name) ? [p] : [];
  });
}

describe('counts on the brand fill keep their contrast', () => {
  it('no white wash under white words', () => {
    const found = files(SRC).flatMap((p) =>
      readFileSync(p, 'utf8')
        .split(/\r?\n/)
        .map((line, i) => [`${relative(SRC, p).split('\\').join('/')}:${i + 1}`, line] as const)
        .filter(([, line]) => /bg-white\/(1[5-9]|[2-9]\d) text-white\b/.test(line))
        .map(([where]) => where),
    );
    expect(found).toEqual([]);
  });
});
