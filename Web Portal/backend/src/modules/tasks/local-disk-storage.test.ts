import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLocalDiskStorage } from './local-disk-storage';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'mico-att-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('LocalDiskStorage', () => {
  it('writes the bytes to disk under a unique key and returns a public url', async () => {
    const storage = createLocalDiskStorage({ baseDir: dir, publicPrefix: '/uploads' });
    const { storageKey, url, sizeBytes } = await storage.save({
      filename: 'note.txt',
      mimeType: 'text/plain',
      content: Buffer.from('hello world'),
    });
    expect(sizeBytes).toBe(11);
    expect(url).toBe(`/uploads/${storageKey}`);
    const onDisk = await readFile(join(dir, storageKey));
    expect(onDisk.toString()).toBe('hello world');
    // key keeps the original extension so the browser serves the right type
    expect(storageKey.endsWith('.txt')).toBe(true);
  });

  it('gives each save a distinct key', async () => {
    const storage = createLocalDiskStorage({ baseDir: dir, publicPrefix: '/uploads' });
    const a = await storage.save({ filename: 'a.txt', mimeType: 'text/plain', content: Buffer.from('a') });
    const b = await storage.save({ filename: 'a.txt', mimeType: 'text/plain', content: Buffer.from('b') });
    expect(a.storageKey).not.toBe(b.storageKey);
  });

  it('removes a stored file', async () => {
    const storage = createLocalDiskStorage({ baseDir: dir, publicPrefix: '/uploads' });
    const { storageKey } = await storage.save({ filename: 'x.txt', mimeType: 'text/plain', content: Buffer.from('x') });
    await storage.remove(storageKey);
    await expect(stat(join(dir, storageKey))).rejects.toBeTruthy();
  });

  it('does not throw when removing a file that is already gone', async () => {
    const storage = createLocalDiskStorage({ baseDir: dir, publicPrefix: '/uploads' });
    await expect(storage.remove('missing.txt')).resolves.toBeUndefined();
  });
});
