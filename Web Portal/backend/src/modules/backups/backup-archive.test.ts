import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Readable } from 'node:stream';
import { randomBytes } from 'node:crypto';
import { createWriteStream, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { entryLines, openArchiveEntries, rowLine, verifyArchive, writeBackupArchive, type WriteArchiveOptions } from './backup-archive';
import { fakeSqlRunner, fillingDisk, type FakeTable } from './backup-fakes';

const LS = String.fromCharCode(0x2028);
const PS = String.fromCharCode(0x2029);

/** Fails the test instead of waiting forever when `p` never settles. */
function within<T>(ms: number, p: Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout;
  return Promise.race([p, new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new Error(`still running after ${ms} ms: it hangs`)), ms)))]).finally(() => clearTimeout(timer));
}

const NOTES: FakeTable = {
  name: 'notes',
  columns: [
    { name: 'id', type: 'varchar' },
    { name: 'body', type: 'text' },
  ],
  primaryKey: ['id'],
  rows: Array.from({ length: 1200 }, (_, i) => [`n${String(i).padStart(5, '0')}`, `note ${i}${i % 7 === 0 ? `${LS}with${PS}breaks` : ''}`]),
};

describe('writing a copy', () => {
  let dir: string;
  let uploads: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mico-bk-arch-'));
    uploads = join(dir, 'uploads');
    mkdirSync(join(uploads, 'nested'), { recursive: true });
    writeFileSync(join(uploads, 'nested', 'photo.bin'), randomBytes(1024 * 1024));
    writeFileSync(join(uploads, 'note.txt'), 'hello');
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const opts = (over: Partial<WriteArchiveOptions> = {}): WriteArchiveOptions => ({
    sql: fakeSqlRunner([NOTES]),
    uploadDir: uploads,
    outFile: join(dir, 'copy.tar.gz'),
    workDir: join(dir, '.work-1'),
    appVersion: '1.19.0-test',
    trigger: 'manual',
    ...over,
  });
  /** What is left in the folder besides the uploads. */
  const leftovers = () => readdirSync(dir).filter((n) => n !== 'uploads');

  it('writes a whole copy that the checker accepts, every row as it was', async () => {
    const res = await writeBackupArchive(opts());
    expect(res).toMatchObject({ tables: 1, rows: 1200, files: 2 });
    expect(leftovers()).toEqual(['copy.tar.gz']);
    expect(await verifyArchive(join(dir, 'copy.tar.gz'))).toMatchObject({ rows: 1200, files: 2 });
    const rows: unknown[] = [];
    for await (const entry of openArchiveEntries(join(dir, 'copy.tar.gz'))) {
      if (entry.name !== 'database/notes.jsonl') {
        entry.body.resume();
        continue;
      }
      for await (const line of entryLines(entry.body)) rows.push(JSON.parse(line));
    }
    expect(rows).toEqual(NOTES.rows);
  });

  it.each([
    ['at the first byte, failing at once', 0, 0],
    ['at the first byte, failing a moment later', 0, 5],
    ['part-way through, failing at once', 200 * 1024, 0],
    ['part-way through, failing a moment later', 200 * 1024, 5],
  ])('a disk that fills up %s: the copy fails (never hangs) and leaves nothing behind', async (_when, limit, delayMs) => {
    const disk = fillingDisk(limit, { delayMs });
    const run = writeBackupArchive(opts({ openWrite: (path) => (path.endsWith('.partial') ? disk(path) : createWriteStream(path)) }));
    await expect(within(5000, run)).rejects.toMatchObject({ code: 'ENOSPC' });
    expect(leftovers()).toEqual([]);
  });

  it.each([
    ['at once', 0],
    ['a moment later', 5],
  ])('a table’s scratch file that can’t be written while the database is read (failing %s): the copy fails, no unhandled error', async (_when, delayMs) => {
    const disk = fillingDisk(0, { delayMs });
    const run = writeBackupArchive(opts({ sql: fakeSqlRunner([NOTES], { pageDelayMs: 20 }), openWrite: (path) => (path.endsWith('.jsonl') ? disk(path) : createWriteStream(path)) }));
    await expect(within(5000, run)).rejects.toMatchObject({ code: 'ENOSPC' });
    expect(leftovers()).toEqual([]);
  });

  it('stops when it is told to (a run that took too long): no copy is left', async () => {
    const stop = new AbortController();
    const run = writeBackupArchive(opts({ sql: fakeSqlRunner([NOTES], { pageDelayMs: 20 }), signal: stop.signal }));
    setTimeout(() => stop.abort(new Error('took too long')), 30);
    await expect(within(5000, run)).rejects.toThrow('took too long');
    expect(leftovers()).toEqual([]);
  });
});

async function lines(chunks: Buffer[]): Promise<string[]> {
  const out: string[] = [];
  for await (const l of entryLines(Readable.from(chunks, { objectMode: false }))) out.push(l);
  return out;
}

describe('a table row as one line of its entry', () => {
  it('has no character a line reader could take for a line break (U+2028, U+2029, CR, LF)', () => {
    const row = ['a', `one${LS}two${PS}three\r\nfour\rfive\nsix`, null, 3.5];
    const line = rowLine(row);
    expect(line.endsWith('\n')).toBe(true);
    const body = line.slice(0, -1);
    for (const c of [LS, PS, '\r', '\n']) expect(body.includes(c)).toBe(false);
    expect(JSON.parse(body)).toEqual(row);
  });
});

describe('reading the lines of a table entry', () => {
  it('splits only at "\\n": U+2028 / U+2029 inside a value stay in their row (copies made before they were escaped)', async () => {
    const rows = [['r1', `old${LS}copy${PS}text`], ['r2', 'plain']];
    const raw = Buffer.from(rows.map((r) => `${JSON.stringify(r)}\n`).join(''), 'utf8');
    expect(raw.includes(Buffer.from(LS, 'utf8'))).toBe(true);
    const got = await lines([raw]);
    expect(got.map((l) => JSON.parse(l))).toEqual(rows);
  });

  it('joins lines and characters cut across chunks, and keeps a last line without "\\n"', async () => {
    const text = `["مرفق 🚀${LS}x"]\n["b"]\n["last"]`;
    const bytes = Buffer.from(text, 'utf8');
    const oneByteChunks = [...bytes].map((b) => Buffer.from([b]));
    expect(await lines(oneByteChunks)).toEqual([`["مرفق 🚀${LS}x"]`, '["b"]', '["last"]']);
    expect(await lines([bytes.subarray(0, 7), bytes.subarray(7)])).toEqual([`["مرفق 🚀${LS}x"]`, '["b"]', '["last"]']);
  });

  it('gives an empty line for an empty row line, and nothing for an empty entry', async () => {
    expect(await lines([Buffer.from('["a"]\n\n["b"]\n')])).toEqual(['["a"]', '', '["b"]']);
    expect(await lines([])).toEqual([]);
  });
});
