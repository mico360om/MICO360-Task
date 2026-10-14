import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { brotliDecompressSync, gunzipSync } from 'node:zlib';
import { precompressDir } from './precompress';

describe('precompressDir — compressed copies of the built web app', () => {
  let dir: string;
  const big = `export const text = ${JSON.stringify('lorem ipsum dolor sit amet '.repeat(400))};`;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'precompress-'));
    mkdirSync(join(dir, 'assets'));
    writeFileSync(join(dir, 'assets', 'app-abc.js'), big);
    writeFileSync(join(dir, 'assets', 'app-abc.css'), '.a{color:red}'.repeat(200));
    writeFileSync(join(dir, 'assets', 'tiny-abc.js'), 'export{}');
    writeFileSync(join(dir, 'assets', 'logo-abc.png'), Buffer.alloc(5000, 7));
    writeFileSync(join(dir, 'assets', 'font-abc.woff2'), Buffer.alloc(5000, 9));
    writeFileSync(join(dir, 'index.html'), `<!doctype html>${'<p>x</p>'.repeat(400)}`);
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('writes a .br and a .gz copy next to each large script and stylesheet', () => {
    precompressDir(dir);
    for (const name of ['app-abc.js', 'app-abc.css']) {
      const file = join(dir, 'assets', name);
      const raw = readFileSync(file);
      expect(brotliDecompressSync(readFileSync(`${file}.br`)).equals(raw), name).toBe(true);
      expect(gunzipSync(readFileSync(`${file}.gz`)).equals(raw), name).toBe(true);
      expect(readFileSync(`${file}.br`).length, name).toBeLessThan(raw.length / 2);
    }
  });

  it('leaves small files, images, fonts and the page itself alone', () => {
    precompressDir(dir);
    // Images and fonts are compressed formats already; index.html is sent by the server from memory.
    for (const name of ['assets/tiny-abc.js', 'assets/logo-abc.png', 'assets/font-abc.woff2', 'index.html']) {
      expect(existsSync(join(dir, `${name}.br`)), name).toBe(false);
      expect(existsSync(join(dir, `${name}.gz`)), name).toBe(false);
    }
  });

  it('can run again without compressing its own output', () => {
    precompressDir(dir);
    precompressDir(dir);
    expect(readdirSync(join(dir, 'assets')).filter((f) => /\.(br|gz)\.(br|gz)$/.test(f))).toEqual([]);
  });
});
