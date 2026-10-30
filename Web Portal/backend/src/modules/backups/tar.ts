import { createHash } from 'node:crypto';
import { Readable, type Writable } from 'node:stream';

/**
 * A small tar (ustar + PAX) writer and reader for backup archives — no dependency, streaming, and
 * readable by the standard tools (GNU tar, Windows tar, 7-Zip). Names that are not plain ASCII or are
 * longer than 100 bytes, and sizes of 8 GiB or more, go in a PAX extended header.
 */

const BLOCK = 512;
const ZERO = Buffer.alloc(BLOCK);
const MAX_OCTAL_SIZE = 8 ** 11 - 1;

/** A relative path with forward slashes that can't leave the folder it is restored into. */
export function isSafeEntryName(name: string): boolean {
  if (!name || name.length > 4096 || name.includes('\0') || name.includes('\\')) return false;
  if (name.startsWith('/') || /^[A-Za-z]:/.test(name)) return false;
  return name.split('/').every((seg) => seg !== '' && seg !== '.' && seg !== '..');
}

function octal(value: number, width: number): string {
  return value.toString(8).padStart(width - 1, '0') + '\0';
}

function paxRecord(key: string, value: string): Buffer {
  const body = ` ${key}=${value}\n`;
  // The length prefix counts itself, so grow it until it fits.
  let len = Buffer.byteLength(body) + 1;
  while (String(len).length + Buffer.byteLength(body) !== len) len = String(len).length + Buffer.byteLength(body);
  return Buffer.from(`${len}${body}`, 'utf8');
}

function header(name: string, size: number, type: string, mtime: Date): Buffer {
  const h = Buffer.alloc(BLOCK);
  h.write(name, 0, 100, 'utf8');
  h.write(octal(0o644, 8), 100, 8, 'ascii');
  h.write(octal(0, 8), 108, 8, 'ascii');
  h.write(octal(0, 8), 116, 8, 'ascii');
  h.write(octal(Math.min(size, MAX_OCTAL_SIZE), 12), 124, 12, 'ascii');
  h.write(octal(Math.floor(mtime.getTime() / 1000), 12), 136, 12, 'ascii');
  h.write('        ', 148, 8, 'ascii');
  h.write(type, 156, 1, 'ascii');
  h.write('ustar\0', 257, 6, 'ascii');
  h.write('00', 263, 2, 'ascii');
  let sum = 0;
  for (const b of h) sum += b;
  h.write(octal(sum, 7) + ' ', 148, 8, 'ascii');
  return h;
}

function padding(size: number): number {
  return (BLOCK - (size % BLOCK)) % BLOCK;
}

/** Why `out` can't take more (it failed, was destroyed or closed, or was ended), or null. */
function unwritable(out: Writable): Error | null {
  if (out.errored) return out.errored;
  if (out.destroyed || out.closed || out.writableEnded) return new Error('The backup output closed before the copy was finished.');
  return null;
}

/**
 * Resolves when a full output can take more; rejects if it fails or closes — at once when that has
 * already happened (its 'error' and 'close' events are gone by then). Leaves no listeners behind.
 */
export function waitForDrain(out: Writable): Promise<void> {
  const dead = unwritable(out);
  if (dead) return Promise.reject(dead);
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      out.off('drain', onDrain);
      out.off('error', onError);
      out.off('close', onClose);
    };
    const onDrain = () => {
      cleanup();
      resolve();
    };
    const onError = (err: Error) => {
      cleanup();
      reject(err);
    };
    const onClose = () => {
      cleanup();
      reject(new Error('The backup output closed before the copy was finished.'));
    };
    out.once('drain', onDrain);
    out.once('error', onError);
    out.once('close', onClose);
  });
}

export interface TarWriter {
  addBuffer(name: string, data: Buffer, mtime?: Date): Promise<void>;
  /**
   * Stream `size` bytes from `src` into one entry. A source that ends early is filled with zeros
   * (`written` says how much it gave); one that is longer is cut at `size`. `sha256` is of the bytes
   * the entry holds.
   */
  addStream(name: string, size: number, src: Readable, mtime?: Date): Promise<{ sha256: string; written: number }>;
  /** The two zero blocks that end an archive. */
  finish(): Promise<void>;
}

/** The header block(s) of one entry: a PAX record first when the name or size needs one. */
function entryHeader(name: string, size: number, mtime: Date): Buffer {
  if (!isSafeEntryName(name)) throw new Error(`Unsafe name in the backup: ${name}`);
  const ascii = /^[\x20-\x7e]*$/.test(name);
  const pax: Buffer[] = [];
  if (!ascii || Buffer.byteLength(name) > 100) pax.push(paxRecord('path', name));
  if (size > MAX_OCTAL_SIZE) pax.push(paxRecord('size', String(size)));
  const blocks: Buffer[] = [];
  if (pax.length) {
    const body = Buffer.concat(pax);
    blocks.push(header('PaxHeader', body.length, 'x', mtime), body, Buffer.alloc(padding(body.length)));
  }
  // The plain name field gets an ASCII stand-in when the real name is in the PAX record.
  const fallback = ascii ? name.slice(0, 100) : name.replace(/[^\x20-\x7e]/g, '_').slice(0, 100);
  blocks.push(header(fallback, size, '0', mtime));
  return Buffer.concat(blocks);
}

/** The two zero blocks that end an archive. */
export const TAR_END = Buffer.concat([ZERO, ZERO]);

/** One whole entry (header, data, padding) from a buffer. */
export function tarBufferEntry(name: string, data: Buffer, mtime: Date = new Date()): Buffer {
  return Buffer.concat([entryHeader(name, data.length, mtime), data, Buffer.alloc(padding(data.length))]);
}

/**
 * One entry streamed from `src`, as the pieces to write: `size` bytes, a source that ends early is
 * filled with zeros (`written` says how much it gave) and one that is longer is cut at `size`.
 * Returns the sha256 of the bytes the entry holds. `src` is closed however it ends — also when the
 * archive is stopped part-way (the output failed), which ends this generator at the piece it is on.
 */
export async function* tarStreamEntry(name: string, size: number, src: Readable, mtime: Date = new Date()): AsyncGenerator<Buffer, { sha256: string; written: number }> {
  const hash = createHash('sha256');
  let written = 0;
  try {
    yield entryHeader(name, size, mtime);
    for await (const chunk of src) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
      const take = buf.subarray(0, Math.min(buf.length, size - written));
      if (take.length) {
        hash.update(take);
        written += take.length;
        yield take;
      }
      if (written >= size) break;
    }
  } finally {
    src.destroy();
  }
  let missing = size - written;
  while (missing > 0) {
    const fill = Buffer.alloc(Math.min(missing, 64 * 1024));
    hash.update(fill);
    missing -= fill.length;
    yield fill;
  }
  if (padding(size)) yield Buffer.alloc(padding(size));
  return { sha256: hash.digest('hex'), written };
}

/** A tar writer onto a stream; every write fails at once when the stream already failed or closed. */
export function createTarWriter(out: Writable): TarWriter {
  async function write(buf: Buffer): Promise<void> {
    const dead = unwritable(out);
    if (dead) throw dead;
    if (!out.write(buf)) await waitForDrain(out);
  }

  return {
    async addBuffer(name, data, mtime = new Date()) {
      await write(tarBufferEntry(name, data, mtime));
    },

    async addStream(name, size, src, mtime = new Date()) {
      const pieces = tarStreamEntry(name, size, src, mtime);
      try {
        for (;;) {
          const next = await pieces.next();
          if (next.done) return next.value;
          await write(next.value);
        }
      } catch (err) {
        src.destroy();
        throw err;
      }
    },

    async finish() {
      await write(TAR_END);
    },
  };
}

// ─────────────────────────────── reading ───────────────────────────────

export class TarError extends Error {}
const damaged = () => new TarError('The backup file is damaged (a part of it could not be read).');
const incomplete = () => new TarError('The backup file is incomplete (it stops part-way through).');

/** Reads exact byte counts from a stream, one operation at a time. */
class ByteReader {
  private chunks: Buffer[] = [];
  private length = 0;
  private ended = false;
  private chain: Promise<unknown> = Promise.resolve();
  private readonly it: AsyncIterator<unknown>;

  constructor(src: Readable) {
    this.it = src[Symbol.asyncIterator]();
  }

  private async fill(n: number): Promise<void> {
    while (this.length < n && !this.ended) {
      const r = await this.it.next();
      if (r.done) this.ended = true;
      else {
        const b = Buffer.isBuffer(r.value) ? r.value : Buffer.from(r.value as Uint8Array);
        this.chunks.push(b);
        this.length += b.length;
      }
    }
  }

  private take(n: number): Buffer {
    const all = this.chunks.length === 1 ? this.chunks[0]! : Buffer.concat(this.chunks);
    const out = all.subarray(0, n);
    const rest = all.subarray(n);
    this.chunks = rest.length ? [rest] : [];
    this.length = rest.length;
    return out;
  }

  /** Up to `n` bytes (fewer only at the end of the stream). */
  read(n: number): Promise<Buffer> {
    const next = this.chain.then(async () => {
      await this.fill(n);
      return this.take(Math.min(n, this.length));
    });
    this.chain = next.catch(() => undefined);
    return next;
  }

  idle(): Promise<unknown> {
    return this.chain;
  }
}

function parseOctal(buf: Buffer): number {
  const text = buf.toString('ascii').replace(/\0.*$/s, '').trim();
  return text ? parseInt(text, 8) : 0;
}

function parsePax(body: Buffer): Record<string, string> {
  const out: Record<string, string> = {};
  let pos = 0;
  while (pos < body.length) {
    const space = body.indexOf(0x20, pos);
    if (space < 0) break;
    const len = Number(body.subarray(pos, space).toString('ascii'));
    if (!Number.isFinite(len) || len <= 0) throw damaged();
    const record = body.subarray(space + 1, pos + len - 1).toString('utf8');
    const eq = record.indexOf('=');
    if (eq > 0) out[record.slice(0, eq)] = record.slice(eq + 1);
    pos += len;
  }
  return out;
}

export interface TarEntry {
  name: string;
  size: number;
  /** The entry's bytes; read it (or leave it) before asking for the next entry. */
  body: Readable;
}

/** Every file entry in a tar stream, in order. Throws a TarError for a damaged or incomplete archive. */
export async function* readTar(src: Readable): AsyncGenerator<TarEntry> {
  const reader = new ByteReader(src);
  let pax: Record<string, string> = {};
  let zeroBlocks = 0;
  while (true) {
    const block = await reader.read(BLOCK);
    if (block.length === 0) throw incomplete();
    if (block.length < BLOCK) throw incomplete();
    if (block.every((b) => b === 0)) {
      zeroBlocks += 1;
      if (zeroBlocks === 2) return;
      continue;
    }
    zeroBlocks = 0;
    let sum = 0;
    for (let i = 0; i < BLOCK; i++) sum += i >= 148 && i < 156 ? 0x20 : block[i]!;
    if (parseOctal(block.subarray(148, 156)) !== sum) throw damaged();

    const type = String.fromCharCode(block[156]!);
    let size = parseOctal(block.subarray(124, 136));
    if (pax.size) size = Number(pax.size);
    const rawName = block.subarray(0, 100).toString('utf8').replace(/\0.*$/s, '');
    const prefix = block.subarray(257, 263).toString('ascii').startsWith('ustar') ? block.subarray(345, 500).toString('utf8').replace(/\0.*$/s, '') : '';
    const name = pax.path ?? (prefix ? `${prefix}/${rawName}` : rawName);

    if (type === 'x' || type === 'g') {
      const body = await reader.read(size + padding(size));
      if (body.length < size + padding(size)) throw incomplete();
      if (type === 'x') pax = parsePax(body.subarray(0, size));
      continue;
    }
    pax = {};

    const state = { remaining: size, abandoned: false };
    async function* bodyChunks(): AsyncGenerator<Buffer> {
      while (state.remaining > 0 && !state.abandoned) {
        const n = Math.min(state.remaining, 64 * 1024);
        state.remaining -= n;
        const chunk = await reader.read(n);
        if (chunk.length < n) throw incomplete();
        yield chunk;
      }
    }
    const isFile = type === '0' || type === '\0';
    if (isFile) yield { name, size, body: Readable.from(bodyChunks(), { objectMode: false }) };

    // Skip whatever of the body was not read, then the padding.
    state.abandoned = true;
    await reader.idle();
    const rest = state.remaining + padding(size);
    state.remaining = 0;
    let left = rest;
    while (left > 0) {
      const skipped = await reader.read(Math.min(left, 64 * 1024));
      if (skipped.length === 0) throw incomplete();
      left -= skipped.length;
    }
  }
}
