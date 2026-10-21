import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { inflateRawSync } from 'node:zlib';

// The package the release folder and the website's download both get (tools/release/extension-package.mjs).
const repo = resolve(__dirname, '../..');
const script = join(repo, 'tools/release/extension-package.mjs');

/** The names and contents of a plain deflate zip's entries (from its central directory). */
function readZip(file) {
  const buf = readFileSync(file);
  const end = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  let p = buf.readUInt32LE(end + 16);
  const entries = new Map();
  for (let i = 0; i < buf.readUInt16LE(end + 10); i += 1) {
    const method = buf.readUInt16LE(p + 10);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extra = buf.readUInt16LE(p + 30);
    const comment = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString('utf8');
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const body = buf.subarray(start, start + size);
    entries.set(name, method === 8 ? inflateRawSync(body) : body);
    p += 46 + nameLen + extra + comment;
  }
  return entries;
}

describe.skipIf(!existsSync(script))('the release package of the extension', () => {
  it('holds the manifest and every packaged folder, not the tests, and unzips to the same files', async () => {
    const { packageExtension, EXTENSION_DIRS } = await import(script);
    const out = mkdtempSync(join(tmpdir(), 'ext-pkg-'));
    try {
      const zip = join(out, 'ext.zip');
      const { version, scripts } = packageExtension(resolve(__dirname, '..'), join(out, 'stage'), zip);
      const manifest = JSON.parse(readFileSync(resolve(__dirname, '../manifest.json'), 'utf8'));
      expect(version).toBe(manifest.version);
      const entries = readZip(zip);
      const names = [...entries.keys()];
      expect(JSON.parse(entries.get('manifest.json').toString('utf8')).version).toBe(manifest.version);
      expect(names).toContain(manifest.background.service_worker);
      for (const dir of EXTENSION_DIRS) expect(names.some((n) => n.startsWith(`${dir}/`)), dir).toBe(true);
      expect(names.filter((n) => /\.test\.js$|test-helpers\.js$/.test(n))).toEqual([]);
      expect(names.every((n) => !n.includes('\\'))).toBe(true); // forward slashes, as Chrome and unzip need
      expect(scripts).toBe(names.filter((n) => n.endsWith('.js')).length);
      expect(entries.get('app/app.js').toString('utf8')).toBe(readFileSync(resolve(__dirname, '../app/app.js'), 'utf8'));
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });
});
