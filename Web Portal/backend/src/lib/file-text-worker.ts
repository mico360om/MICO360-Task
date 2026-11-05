/**
 * 1.23 search: the file reader run as a process of its own (lib/file-text-thread), so reading a big or
 * hostile file never holds up — or takes down — the server: the server sends the bytes, this reads them,
 * answers and ends.
 */
import { readFileText } from './file-text';

process.once('message', (job: { content?: Uint8Array; filename?: string; mimeType?: string } | null) => {
  if (!job?.content || !process.send) {
    process.exit(2);
    return;
  }
  const out = readFileText(Buffer.from(job.content.buffer, job.content.byteOffset, job.content.byteLength), { filename: job.filename ?? '', mimeType: job.mimeType ?? '' });
  process.send(out, () => process.exit(0));
});
