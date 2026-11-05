import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { readFileText, type FileText } from './file-text';

/**
 * 1.23 search (review I3): read a file's text off the main thread — in a worker of its own (the built
 * file-text-worker.js), given at most `timeoutMs` and `maxMemoryMb`: a file that takes too long, runs
 * out of memory or breaks the reader ends as FAILED, and the server goes on answering meanwhile.
 * Without the built worker (running the TypeScript sources: tests, tsx) it reads in this thread.
 */
export async function readFileTextOffThread(
  content: Buffer,
  file: { filename: string; mimeType: string },
  opts: { timeoutMs?: number; maxMemoryMb?: number; script?: string } = {},
): Promise<FileText> {
  const script = opts.script ?? join(__dirname, 'file-text-worker.js');
  if (!existsSync(script)) return readFileText(content, file);
  const failed = (error: string): FileText => ({ status: 'FAILED', method: null, text: '', truncated: false, images: [], error: error.slice(0, 200) });
  return new Promise<FileText>((resolve) => {
    let done = false;
    const finish = (out: FileText) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      void worker.terminate().catch(() => undefined);
      resolve(out);
    };
    const worker = new Worker(script, {
      workerData: { content: new Uint8Array(content), filename: file.filename, mimeType: file.mimeType },
      resourceLimits: { maxOldGenerationSizeMb: opts.maxMemoryMb ?? 256, maxYoungGenerationSizeMb: 32 },
    });
    const timer = setTimeout(() => finish(failed('Reading the file took too long.')), opts.timeoutMs ?? 20_000);
    worker.once('message', (r: FileText) => finish({ ...r, images: (r.images ?? []).map((b) => Buffer.from(b)) }));
    worker.once('error', (err) => finish(failed(err instanceof Error ? err.message : 'The file could not be read.')));
    worker.once('exit', (code) => finish(failed(`The reader stopped (${code}).`)));
  });
}
