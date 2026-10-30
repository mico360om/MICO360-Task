import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { Transform, type TransformCallback } from 'node:stream';

/**
 * Optional encryption of backup copies with BACKUP_ENCRYPTION_KEY: the file is cut into 1 MiB chunks,
 * each sealed with AES-256-GCM (its own nonce; the header, its number and whether it is the last one
 * are authenticated), so a changed byte, a reordered chunk or a file cut short is always refused. The
 * key comes from the passphrase by scrypt with a random salt. The header carries a key check, so a
 * wrong key is told apart from a damaged file.
 *
 * Header (56 bytes): magic "MBKENC1\n" · kdf 1=scrypt · log2 N · r · p · salt (16) · nonce prefix (8)
 * · chunk size (u32) · key check (16).
 */

export const BACKUP_KEY_MIN_LENGTH = 16;
export const CHUNK_SIZE = 1024 * 1024;
const MAGIC = Buffer.from('MBKENC1\n', 'ascii');
const TAG = 16;
export const HEADER_SIZE = 8 + 4 + 16 + 8 + 4 + 16;

export class BackupKeyError extends Error {}
export class BackupDamagedError extends Error {}

/** Does this file start like an encrypted backup? */
export function isEncryptedHeader(first: Buffer): boolean {
  return first.length >= MAGIC.length && first.subarray(0, MAGIC.length).equals(MAGIC);
}

function derive(passphrase: string, salt: Buffer, log2n: number, r: number, p: number): { key: Buffer; check: Buffer } {
  const N = 2 ** log2n;
  const out = scryptSync(passphrase, salt, 64, { N, r, p, maxmem: 256 * N * r + 32 * 1024 * 1024 });
  return { key: out.subarray(0, 32), check: createHash('sha256').update(out.subarray(32)).digest().subarray(0, 16) };
}

function chunkInfo(header: Buffer, prefix: Buffer, index: number, final: boolean): { iv: Buffer; aad: Buffer } {
  const n = Buffer.alloc(4);
  n.writeUInt32BE(index);
  return { iv: Buffer.concat([prefix, n]), aad: Buffer.concat([header, n, Buffer.from([final ? 1 : 0])]) };
}

function checkPassphrase(passphrase: string): void {
  if (typeof passphrase !== 'string' || passphrase.length < BACKUP_KEY_MIN_LENGTH) {
    throw new BackupKeyError(`The backup key (BACKUP_ENCRYPTION_KEY) is too short — it needs at least ${BACKUP_KEY_MIN_LENGTH} characters.`);
  }
}

/** Seals a backup stream with the passphrase. */
export function encryptStream(passphrase: string): Transform {
  checkPassphrase(passphrase);
  const salt = randomBytes(16);
  const prefix = randomBytes(8);
  const [log2n, r, p] = [15, 8, 1];
  const { key, check } = derive(passphrase, salt, log2n, r, p);
  const size = Buffer.alloc(4);
  size.writeUInt32BE(CHUNK_SIZE);
  const header = Buffer.concat([MAGIC, Buffer.from([1, log2n, r, p]), salt, prefix, size, check]);
  let pending: Buffer[] = [];
  let pendingLength = 0;
  let index = 0;
  let started = false;

  function seal(plain: Buffer, final: boolean): Buffer {
    const { iv, aad } = chunkInfo(header, prefix, index++, final);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(aad);
    return Buffer.concat([cipher.update(plain), cipher.final(), cipher.getAuthTag()]);
  }

  return new Transform({
    transform(chunk: Buffer, _enc, done: TransformCallback) {
      if (!started) {
        this.push(header);
        started = true;
      }
      pending.push(chunk);
      pendingLength += chunk.length;
      // A full chunk goes out only once more data follows it, so the last chunk is always marked last.
      if (pendingLength > CHUNK_SIZE) {
        let all = Buffer.concat(pending);
        while (all.length > CHUNK_SIZE) {
          this.push(seal(all.subarray(0, CHUNK_SIZE), false));
          all = all.subarray(CHUNK_SIZE);
        }
        pending = [all];
        pendingLength = all.length;
      }
      done();
    },
    flush(done: TransformCallback) {
      if (!started) this.push(header);
      this.push(seal(Buffer.concat(pending), true));
      done();
    },
  });
}

/** Opens a sealed backup stream; a wrong key is a BackupKeyError, a changed or cut file a BackupDamagedError. */
export function decryptStream(passphrase: string): Transform {
  checkPassphrase(passphrase);
  let buffered: Buffer = Buffer.alloc(0);
  let parts: Buffer[] = [];
  let partsLength = 0;
  let header: Buffer | null = null;
  let prefix: Buffer = Buffer.alloc(0);
  let key: Buffer = Buffer.alloc(0);
  let chunkSize = CHUNK_SIZE;
  let index = 0;

  function open(sealed: Buffer, final: boolean): Buffer {
    if (sealed.length < TAG) throw new BackupDamagedError('The backup file is incomplete (it stops part-way through).');
    const { iv, aad } = chunkInfo(header!, prefix, index++, final);
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAAD(aad);
    decipher.setAuthTag(sealed.subarray(sealed.length - TAG));
    try {
      return Buffer.concat([decipher.update(sealed.subarray(0, sealed.length - TAG)), decipher.final()]);
    } catch {
      throw new BackupDamagedError('The backup file is damaged or incomplete (a part of it does not match).');
    }
  }

  function readHeader(): void {
    const h = buffered.subarray(0, HEADER_SIZE);
    if (!isEncryptedHeader(h) || h[8] !== 1) throw new BackupDamagedError('This is not an encrypted MICO360 Tasks backup, or it is damaged.');
    const [log2n, r, p] = [h[9]!, h[10]!, h[11]!];
    if (log2n < 10 || log2n > 20 || r < 1 || r > 16 || p < 1 || p > 4) throw new BackupDamagedError('The backup file is damaged (its header is not valid).');
    const salt = h.subarray(12, 28);
    prefix = Buffer.from(h.subarray(28, 36));
    chunkSize = h.readUInt32BE(36);
    if (chunkSize < 1024 || chunkSize > 64 * 1024 * 1024) throw new BackupDamagedError('The backup file is damaged (its header is not valid).');
    const derived = derive(passphrase, salt, log2n, r, p);
    if (!timingSafeEqual(derived.check, h.subarray(40, 56))) throw new BackupKeyError('That backup key does not open this copy. Use the key that was set when the copy was made.');
    key = derived.key;
    header = Buffer.from(h);
    buffered = buffered.subarray(HEADER_SIZE);
  }

  return new Transform({
    transform(chunk: Buffer, _enc, done: TransformCallback) {
      try {
        parts.push(chunk);
        partsLength += chunk.length;
        // Join the pieces only once a whole chunk (and a byte past it) is here.
        if (!header ? partsLength < HEADER_SIZE : partsLength <= chunkSize + TAG) return done();
        buffered = Buffer.concat(buffered.length ? [buffered, ...parts] : parts);
        parts = [];
        partsLength = 0;
        if (!header) readHeader();
        while (buffered.length > chunkSize + TAG) {
          this.push(open(buffered.subarray(0, chunkSize + TAG), false));
          buffered = buffered.subarray(chunkSize + TAG);
        }
        // What is left waits with the pieces still to come.
        if (buffered.length) {
          parts = [buffered];
          partsLength = buffered.length;
          buffered = Buffer.alloc(0);
        }
        done();
      } catch (err) {
        done(err as Error);
      }
    },
    flush(done: TransformCallback) {
      try {
        buffered = Buffer.concat([buffered, ...parts]);
        parts = [];
        if (!header) {
          if (buffered.length < HEADER_SIZE) throw new BackupDamagedError('The backup file is incomplete (it stops part-way through).');
          readHeader();
        }
        this.push(open(buffered, true));
        done();
      } catch (err) {
        done(err as Error);
      }
    },
  });
}
