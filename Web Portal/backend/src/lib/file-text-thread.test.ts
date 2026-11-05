import { describe, it, expect, beforeAll } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFileTextOffThread } from './file-text-thread';

// The real reader is the built file-text-worker.js, run as a process of its own; these stand-ins check
// how its answer, one that never ends, one that throws and ones that run out of memory are handled.
let dir = '';
const script = (name: string, body: string) => {
  const p = join(dir, name);
  writeFileSync(p, `process.once('message', (job) => {\n${body}\n});\n`);
  return p;
};
/** A stand-in that does its thing at once, without waiting for the file. */
const rawScript = (name: string, body: string) => {
  const p = join(dir, name);
  writeFileSync(p, `${body}\n`);
  return p;
};
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'file-text-thread-'));
});

const file = { filename: 'a.pdf', mimeType: 'application/pdf' };

describe('readFileTextOffThread', () => {
  it('returns what the reader read (pictures as Buffers again), and gives it the file', async () => {
    const ok = script(
      'ok.js',
      "process.send({ status: 'NEEDS_OCR', method: null, text: job.filename + ':' + Buffer.from(job.content).toString(), truncated: false, images: [new Uint8Array([255, 216, 255])] }, () => process.exit(0));",
    );
    const out = await readFileTextOffThread(Buffer.from('x'), file, { script: ok });
    expect(out.status).toBe('NEEDS_OCR');
    expect(out.text).toBe('a.pdf:x');
    expect(Buffer.isBuffer(out.images[0])).toBe(true);
    expect(out.images[0]!.subarray(0, 3)).toEqual(Buffer.from([255, 216, 255]));
  });

  it('a reader that runs too long is stopped: FAILED, never a hang', async () => {
    const slow = script('slow.js', 'for (;;) {}');
    const out = await readFileTextOffThread(Buffer.from('x'), file, { script: slow, timeoutMs: 300 });
    expect(out).toMatchObject({ status: 'FAILED', error: expect.stringMatching(/too long/) });
  });

  it('a reader that throws, or runs out of memory, is FAILED — the server carries on', async () => {
    const thrower = script('throw.js', "throw new Error('broken file');");
    expect(await readFileTextOffThread(Buffer.from('x'), file, { script: thrower })).toMatchObject({ status: 'FAILED' });
    const hog = script('hog.js', 'const a = []; for (;;) a.push(new Array(1e6).fill(1));');
    const out = await readFileTextOffThread(Buffer.from('x'), file, { script: hog, maxMemoryMb: 32, timeoutMs: 20_000 });
    expect(out.status).toBe('FAILED');
  }, 30_000);

  // Security review (1.23): one huge array of numbers running out of memory took a worker THREAD's whole
  // process down (V8's "Reached heap limit" aborts the process) — the server with it. A process of its own
  // dies alone.
  it('a reader whose one big array overflows its memory is FAILED, and this process carries on', async () => {
    const grow = rawScript('grow.js', 'const a = []; for (let i = 0; ; i++) a.push(i);');
    const out = await readFileTextOffThread(Buffer.from('x'), file, { script: grow, maxMemoryMb: 64, timeoutMs: 20_000 });
    expect(out.status).toBe('FAILED');
    expect(process.memoryUsage().rss).toBeGreaterThan(0); // still here
  }, 30_000);

  it('a reader that ends without an answer is FAILED', async () => {
    const quits = script('quits.js', 'process.exit(3);');
    expect(await readFileTextOffThread(Buffer.from('x'), file, { script: quits })).toMatchObject({ status: 'FAILED' });
  });

  it('without a built reader (the TypeScript sources) it reads in this thread', async () => {
    const out = await readFileTextOffThread(Buffer.from('Torque values'), { filename: 'n.txt', mimeType: 'text/plain' }, { script: join(dir, 'missing.js') });
    expect(out).toMatchObject({ status: 'READ', text: 'Torque values' });
  });
});
