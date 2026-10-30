import { describe, it, expect } from 'vitest';
import { PassThrough, Readable } from 'node:stream';
import { createHash, randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, createWriteStream } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createGzip } from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { createTarWriter, readTar, TAR_END, tarBufferEntry, tarStreamEntry, waitForDrain } from './tar';
import { Writable } from 'node:stream';

async function collect(src: Readable): Promise<Buffer> {
  const parts: Buffer[] = [];
  for await (const c of src) parts.push(c as Buffer);
  return Buffer.concat(parts);
}

/** Pack the given entries into one tar buffer. */
async function pack(entries: { name: string; data: Buffer; stream?: boolean }[]): Promise<Buffer> {
  const out = new PassThrough();
  const done = collect(out);
  const tar = createTarWriter(out);
  for (const e of entries) {
    if (e.stream) await tar.addStream(e.name, e.data.length, Readable.from([e.data]));
    else await tar.addBuffer(e.name, e.data);
  }
  await tar.finish();
  out.end();
  return done;
}

async function unpack(buf: Buffer): Promise<{ name: string; data: Buffer }[]> {
  const got: { name: string; data: Buffer }[] = [];
  for await (const entry of readTar(Readable.from([buf]))) got.push({ name: entry.name, data: await collect(entry.body) });
  return got;
}

const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

const hasTar = (() => {
  try {
    execFileSync('tar', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

describe('tar writer and reader', () => {
  it('round-trips short, long (150 characters), Arabic, empty and multi-block entries', async () => {
    const long = `files/${'a'.repeat(140)}/x.txt`;
    const big = randomBytes(3 * 1024 * 1024 + 17);
    const entries = [
      { name: 'manifest.json', data: Buffer.from('{"ok":true}') },
      { name: long, data: Buffer.from('long name') },
      { name: 'files/مرفق جديد.pdf', data: Buffer.from('arabic name') },
      { name: 'files/empty.txt', data: Buffer.alloc(0) },
      { name: 'files/big.bin', data: big, stream: true },
    ];
    const got = await unpack(await pack(entries));
    expect(got.map((g) => g.name)).toEqual(entries.map((e) => e.name));
    for (let i = 0; i < entries.length; i++) expect(sha(got[i]!.data)).toBe(sha(entries[i]!.data));
  });

  it('pads a stream that ends short of its declared size with zeros, and reports what it read', async () => {
    const out = new PassThrough();
    const done = collect(out);
    const tar = createTarWriter(out);
    const res = await tar.addStream('files/shrunk.bin', 10, Readable.from([Buffer.from('abc')]));
    await tar.finish();
    out.end();
    expect(res.written).toBe(3);
    const stored = Buffer.concat([Buffer.from('abc'), Buffer.alloc(7)]);
    // The checksum is of what the entry holds, so a restored file matches it byte for byte.
    expect(res.sha256).toBe(sha(stored));
    const [entry] = await unpack(await done);
    expect(entry!.data).toEqual(stored);
  });

  it('never writes more than the declared size when the stream is longer', async () => {
    const out = new PassThrough();
    const done = collect(out);
    const tar = createTarWriter(out);
    const res = await tar.addStream('files/grew.bin', 3, Readable.from([Buffer.from('abcdef')]));
    await tar.finish();
    out.end();
    expect(res.written).toBe(3);
    const [entry] = await unpack(await done);
    expect(entry!.data.toString()).toBe('abc');
  });

  it('refuses names that could escape the folder they are restored into', async () => {
    const out = new PassThrough();
    out.resume();
    const tar = createTarWriter(out);
    await expect(tar.addBuffer('../evil', Buffer.from('x'))).rejects.toThrow();
    await expect(tar.addBuffer('/etc/passwd', Buffer.from('x'))).rejects.toThrow();
    await expect(tar.addBuffer('files/a/../../b', Buffer.from('x'))).rejects.toThrow();
  });

  it('reports a damaged archive (bad header checksum) instead of reading garbage', async () => {
    const buf = await pack([{ name: 'a.txt', data: Buffer.from('hello') }]);
    buf[10] = buf[10]! ^ 0xff;
    await expect(unpack(buf)).rejects.toThrow(/damaged/i);
  });

  it('reports an archive that stops part-way through', async () => {
    const buf = await pack([{ name: 'a.bin', data: randomBytes(5000) }]);
    await expect(unpack(buf.subarray(0, 2048))).rejects.toThrow(/incomplete/i);
  });

  it.skipIf(!hasTar)('writes archives the standard tar tool can list', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mico-tar-'));
    try {
      const out = new PassThrough();
      const written = pipeline(out, createGzip(), createWriteStream(join(dir, 'x.tar.gz')));
      const tar = createTarWriter(out);
      const longName = `files/${'b'.repeat(120)}.txt`;
      await tar.addBuffer('manifest.json', Buffer.from('{}'));
      await tar.addBuffer(longName, Buffer.from('x'));
      await tar.finish();
      out.end();
      await written;
      // A relative name keeps GNU tar (Git Bash) from reading "D:" as a remote host.
      const listing = execFileSync('tar', ['-tzf', 'x.tar.gz'], { encoding: 'utf8', cwd: dir }).split(/\r?\n/).filter(Boolean);
      expect(listing).toEqual(['manifest.json', longName]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it('waiting for a full output to drain leaves no listeners behind', async () => {
    const slow = new Writable({ highWaterMark: 4, write: (_c, _e, done) => setImmediate(done) });
    for (let i = 0; i < 50; i++) {
      if (!slow.write(Buffer.alloc(16))) await waitForDrain(slow);
    }
    expect(slow.listenerCount('error')).toBe(0);
    expect(slow.listenerCount('drain')).toBe(0);
    expect(slow.listenerCount('close')).toBe(0);
  });

  it('an output that already failed (a full disk ended the pipeline): writes and waits fail at once, never hang', async () => {
    const hang = (ms: number) => new Promise((_, reject) => setTimeout(() => reject(new Error('it hangs')), ms).unref());
    const out = new PassThrough();
    out.on('error', () => undefined);
    out.destroy(Object.assign(new Error('ENOSPC: no space left on device'), { code: 'ENOSPC' }));
    await new Promise((r) => setImmediate(r)); // its 'error' and 'close' events are over
    await expect(Promise.race([waitForDrain(out), hang(1000)])).rejects.toMatchObject({ code: 'ENOSPC' });
    const tar = createTarWriter(out);
    await expect(Promise.race([tar.addBuffer('manifest.json', Buffer.alloc(10)), hang(1000)])).rejects.toMatchObject({ code: 'ENOSPC' });
    const src = Readable.from([Buffer.alloc(100)]);
    await expect(Promise.race([tar.addStream('files/a.bin', 100, src), hang(1000)])).rejects.toMatchObject({ code: 'ENOSPC' });
    expect(src.destroyed).toBe(true);
    const closedOnly = new PassThrough();
    closedOnly.destroy();
    await new Promise((r) => setImmediate(r));
    await expect(Promise.race([waitForDrain(closedOnly), hang(1000)])).rejects.toThrow(/closed before the copy was finished/);
  });

  it('tarStreamEntry / tarBufferEntry make the same archive as the writer', async () => {
    const data = randomBytes(70 * 1024);
    const pieces: Buffer[] = [Buffer.from(tarBufferEntry('manifest.json', Buffer.from('{}')))];
    const it = tarStreamEntry('files/مرفق.bin', data.length, Readable.from([data]));
    let next = await it.next();
    while (!next.done) {
      pieces.push(next.value);
      next = await it.next();
    }
    expect(next.value).toEqual({ sha256: sha(data), written: data.length });
    pieces.push(TAR_END);
    const viaWriter = await pack([{ name: 'manifest.json', data: Buffer.from('{}') }, { name: 'files/مرفق.bin', data, stream: true }]);
    expect(sha(Buffer.concat(pieces))).toBe(sha(viaWriter));
  });
});
