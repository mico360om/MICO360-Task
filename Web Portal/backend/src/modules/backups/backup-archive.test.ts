import { describe, it, expect } from 'vitest';
import { Readable } from 'node:stream';
import { entryLines, rowLine } from './backup-archive';

const LS = String.fromCharCode(0x2028);
const PS = String.fromCharCode(0x2029);

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
