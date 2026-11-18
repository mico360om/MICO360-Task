import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLocalDiskStorage } from './local-disk-storage';
import type { UploadPlace } from '../files/upload-paths';

const PLACE: UploadPlace = { companyId: 'ckco1', userId: 'ckuser1', type: 'task-files', at: new Date('2026-11-18T10:00:00Z') };

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
    }, PLACE);
    expect(sizeBytes).toBe(11);
    expect(url).toBe(`/uploads/${storageKey}`);
    // 1.23.39: <company>/<YYYY>/<MM>/<uploader>/<type>/<uuid>.<ext>
    expect(storageKey).toMatch(/^ckco1\/2026\/11\/ckuser1\/task-files\/[0-9a-f-]{36}\.txt$/);
    const onDisk = await readFile(join(dir, storageKey));
    expect(onDisk.toString()).toBe('hello world');
    // key keeps the original extension so the browser serves the right type
    expect(storageKey.endsWith('.txt')).toBe(true);
  });

  it('gives each save a distinct key', async () => {
    const storage = createLocalDiskStorage({ baseDir: dir, publicPrefix: '/uploads' });
    const a = await storage.save({ filename: 'a.txt', mimeType: 'text/plain', content: Buffer.from('a') }, PLACE);
    const b = await storage.save({ filename: 'a.txt', mimeType: 'text/plain', content: Buffer.from('b') }, PLACE);
    expect(a.storageKey).not.toBe(b.storageKey);
  });

  it('removes a stored file', async () => {
    const storage = createLocalDiskStorage({ baseDir: dir, publicPrefix: '/uploads' });
    const { storageKey } = await storage.save({ filename: 'x.txt', mimeType: 'text/plain', content: Buffer.from('x') }, PLACE);
    await storage.remove(storageKey);
    await expect(stat(join(dir, storageKey))).rejects.toBeTruthy();
  });

  it('does not throw when removing a file that is already gone', async () => {
    const storage = createLocalDiskStorage({ baseDir: dir, publicPrefix: '/uploads' });
    await expect(storage.remove('missing.txt')).resolves.toBeUndefined();
  });

  it('reads and removes nested keys and 1.23.31 plain names; refuses anything else', async () => {
    const storage = createLocalDiskStorage({ baseDir: dir, publicPrefix: '/uploads' });
    const { storageKey } = await storage.save({ filename: 'x.txt', mimeType: 'text/plain', content: Buffer.from('x') }, PLACE);
    expect((await storage.read!(storageKey)).toString()).toBe('x');
    const { writeFile } = await import('node:fs/promises');
    const plain = '1b4e28ba-2d11-4a2e-8c3b-0f5b2b6e9a10.txt';
    await writeFile(join(dir, plain), 'old');
    expect((await storage.read!(plain)).toString()).toBe('old');
    for (const bad of ['../secret.txt', 'a/../../b', 'x\\y', 'notakey.txt', `${storageKey}/..`]) {
      await expect(storage.read!(bad)).rejects.toThrow();
      await expect(storage.remove(bad)).resolves.toBeUndefined();
    }
    await storage.remove(plain);
    await expect(stat(join(dir, plain))).rejects.toBeTruthy();
  });
});
