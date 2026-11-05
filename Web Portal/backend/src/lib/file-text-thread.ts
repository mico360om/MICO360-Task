import { fork } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { readFileText, type FileText } from './file-text';

/**
 * 1.23 search: read a file's text away from the server — in a process of its own (the built
 * file-text-worker.js), given at most `timeoutMs` and `maxMemoryMb`: a file that takes too long, runs out
 * of memory or breaks the reader ends as FAILED, and the server goes on answering meanwhile.
 *
 * Security review (1.23): a worker THREAD was not enough. When one big array outgrew a limited thread's
 * memory, V8 stopped the whole process ("Reached heap limit"), the server with it — a 16 KB PDF did that.
 * A child process that runs out of memory dies alone.
 *
 * Without the built reader (running the TypeScript sources: tests, tsx) it reads in this thread.
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
    let timer: NodeJS.Timeout | undefined;
    let child: ReturnType<typeof fork> | undefined;
    const finish = (out: FileText) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try {
        if (child && child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      } catch {
        // already gone
      }
      resolve(out);
    };
    try {
      child = fork(script, [], {
        // Its own heap limit (never the server's own flags: a development loader isn't wanted there).
        execArgv: [`--max-old-space-size=${opts.maxMemoryMb ?? 256}`, '--max-semi-space-size=16'],
        // Buffers travel as they are; nothing it prints (an out-of-memory report) reaches the server's log.
        serialization: 'advanced',
        stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      });
    } catch (err) {
      finish(failed(err instanceof Error ? `The reader could not start: ${err.message}` : 'The reader could not start.'));
      return;
    }
    timer = setTimeout(() => finish(failed('Reading the file took too long.')), opts.timeoutMs ?? 20_000);
    child.once('message', (r: FileText) => finish({ ...r, images: (r.images ?? []).map((b) => Buffer.from(b)) }));
    child.once('error', (err) => finish(failed(err instanceof Error ? err.message : 'The file could not be read.')));
    child.once('exit', (code, signal) => finish(failed(`The reader stopped (${signal ?? code}).`)));
    child.send({ content: new Uint8Array(content.buffer, content.byteOffset, content.byteLength), filename: file.filename, mimeType: file.mimeType }, (err) => {
      if (err) finish(failed('The file could not be handed to the reader.'));
    });
  });
}
