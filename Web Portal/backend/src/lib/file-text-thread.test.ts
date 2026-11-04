import { describe, it, expect, beforeAll } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFileTextOffThread } from './file-text-thread';

// The real worker is the built file-text-worker.js; these stand-ins check how a worker's answer, a
// worker that never ends, one that throws and one that runs out of memory are handled.
let dir = '';
const script = (name: string, body: string) => {
  const p = join(dir, name);
  writeFileSync(p, `const { parentPort, workerData } = require('node:worker_threads');\n${body}\n`);
  return p;
};
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'file-text-thread-'));
});

const file = { filename: 'a.pdf', mimeType: 'application/pdf' };

describe('readFileTextOffThread', () => {
  it('returns what the worker read (pictures as Buffers again)', async () => {
    const ok = script('ok.js', "parentPort.postMessage({ status: 'NEEDS_OCR', method: null, text: '', truncated: false, images: [new Uint8Array([255, 216, 255])] });");
    const out = await readFileTextOffThread(Buffer.from('x'), file, { script: ok });
    expect(out.status).toBe('NEEDS_OCR');
    expect(Buffer.isBuffer(out.images[0])).toBe(true);
    expect(out.images[0]!.subarray(0, 3)).toEqual(Buffer.from([255, 216, 255]));
  });

  it('a worker that runs too long is stopped: FAILED, never a hang', async () => {
    const slow = script('slow.js', 'for (;;) {}');
    const out = await readFileTextOffThread(Buffer.from('x'), file, { script: slow, timeoutMs: 300 });
    expect(out).toMatchObject({ status: 'FAILED', error: expect.stringMatching(/too long/) });
  });

  it('a worker that throws, or runs out of memory, is FAILED — the server carries on', async () => {
    const thrower = script('throw.js', "throw new Error('broken file');");
    expect(await readFileTextOffThread(Buffer.from('x'), file, { script: thrower })).toMatchObject({ status: 'FAILED' });
    const hog = script('hog.js', 'const a = []; for (;;) a.push(new Array(1e6).fill(1));');
    const out = await readFileTextOffThread(Buffer.from('x'), file, { script: hog, maxMemoryMb: 32, timeoutMs: 20_000 });
    expect(out.status).toBe('FAILED');
  }, 30_000);

  it('without a built worker (the TypeScript sources) it reads in this thread', async () => {
    const out = await readFileTextOffThread(Buffer.from('Torque values'), { filename: 'n.txt', mimeType: 'text/plain' }, { script: join(dir, 'missing.js') });
    expect(out).toMatchObject({ status: 'READ', text: 'Torque values' });
  });
});
