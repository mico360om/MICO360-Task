import { describe, it, expect } from 'vitest';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { randomBytes } from 'node:crypto';
import { encryptStream, decryptStream, isEncryptedHeader, BackupKeyError, BACKUP_KEY_MIN_LENGTH, CHUNK_SIZE, HEADER_SIZE } from './backup-crypto';

const KEY = 'correct horse battery staple 2026';

async function run(input: Buffer, transform: NodeJS.ReadWriteStream): Promise<Buffer> {
  const parts: Buffer[] = [];
  await pipeline(Readable.from([input]), transform, async (src: AsyncIterable<string | Buffer>) => {
    for await (const c of src) parts.push(c as Buffer);
  });
  return Buffer.concat(parts);
}

/** Feed the input in uneven pieces, like a real file stream. */
async function runPieces(input: Buffer, transform: NodeJS.ReadWriteStream, piece = 7777): Promise<Buffer> {
  const pieces: Buffer[] = [];
  for (let i = 0; i < input.length; i += piece) pieces.push(input.subarray(i, i + piece));
  const parts: Buffer[] = [];
  await pipeline(Readable.from(pieces), transform, async (src: AsyncIterable<string | Buffer>) => {
    for await (const c of src) parts.push(c as Buffer);
  });
  return Buffer.concat(parts);
}

describe('backup encryption (chunked AES-256-GCM)', () => {
  it('needs a key of at least 16 characters', () => {
    expect(BACKUP_KEY_MIN_LENGTH).toBe(16);
    expect(() => encryptStream('short')).toThrow(BackupKeyError);
  });

  for (const [label, size] of [
    ['an empty file', 0],
    ['exactly one chunk', CHUNK_SIZE],
    ['two and a half chunks', Math.floor(CHUNK_SIZE * 2.5)],
  ] as const) {
    it(`round-trips ${label}`, async () => {
      const plain = randomBytes(size);
      const sealed = await runPieces(plain, encryptStream(KEY));
      expect(isEncryptedHeader(sealed)).toBe(true);
      if (size > 64) expect(sealed.includes(plain.subarray(0, 64))).toBe(false);
      expect((await runPieces(sealed, decryptStream(KEY), 4093)).equals(plain)).toBe(true);
    });
  }

  it('a plain gzip file is not taken for an encrypted one', () => {
    expect(isEncryptedHeader(Buffer.from([0x1f, 0x8b, 8, 0]))).toBe(false);
  });

  it('the wrong key is a BackupKeyError that says so plainly', async () => {
    const sealed = await run(Buffer.from('company data'), encryptStream(KEY));
    await expect(run(sealed, decryptStream('another key that is long enough'))).rejects.toThrow(BackupKeyError);
    await expect(run(sealed, decryptStream('another key that is long enough'))).rejects.toThrow(/backup key/i);
  });

  it('a changed byte is refused', async () => {
    const sealed = await run(randomBytes(CHUNK_SIZE + 100), encryptStream(KEY));
    sealed[sealed.length - 30] = sealed[sealed.length - 30]! ^ 1;
    await expect(run(sealed, decryptStream(KEY))).rejects.toThrow(/damaged/i);
  });

  it('a copy cut off at a chunk boundary is refused (the last chunk is marked)', async () => {
    const sealed = await run(randomBytes(CHUNK_SIZE * 2), encryptStream(KEY));
    // The header + one whole chunk (data + 16-byte tag): the cut is exactly between chunks.
    const cut = sealed.subarray(0, HEADER_SIZE + CHUNK_SIZE + 16);
    await expect(run(cut, decryptStream(KEY))).rejects.toThrow(/damaged|incomplete/i);
  });
});
