/**
 * 1.23 search (review I3): the file reader run in a worker thread (lib/file-text-thread), so reading a
 * big or hostile file never holds up the server: the main thread sends the bytes, this reads them and
 * posts the result back.
 */
import { parentPort, workerData } from 'node:worker_threads';
import { readFileText } from './file-text';

const job = workerData as { content?: Uint8Array; filename?: string; mimeType?: string } | null;
if (parentPort && job?.content) {
  parentPort.postMessage(readFileText(Buffer.from(job.content), { filename: job.filename ?? '', mimeType: job.mimeType ?? '' }));
}
