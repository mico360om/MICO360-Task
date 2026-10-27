/**
 * Rows for a bulk insert, in pieces: at most `maxRows` rows and about `maxBytes` of data each, so one
 * statement stays well under MySQL's `max_allowed_packet` (16 MB by default) — 500 tasks with long
 * descriptions would otherwise make one statement of 30 MB and more. A row's size is its JSON in
 * UTF-8 bytes (close to what goes over the wire); a single row bigger than the limit goes on its own.
 */
export function chunkRows<T>(rows: T[], { maxRows = 500, maxBytes = 2_000_000 }: { maxRows?: number; maxBytes?: number } = {}): T[][] {
  const chunks: T[][] = [];
  let current: T[] = [];
  let bytes = 0;
  for (const row of rows) {
    const size = Buffer.byteLength(JSON.stringify(row) ?? '', 'utf8');
    if (current.length && (current.length >= maxRows || bytes + size > maxBytes)) {
      chunks.push(current);
      current = [];
      bytes = 0;
    }
    current.push(row);
    bytes += size;
  }
  if (current.length) chunks.push(current);
  return chunks;
}

/** Write rows in chunkRows pieces, one after another (inside the caller's transaction). */
export async function inChunks<T>(rows: T[], write: (chunk: T[]) => Promise<unknown>, opts?: { maxRows?: number; maxBytes?: number }): Promise<void> {
  for (const chunk of chunkRows(rows, opts)) await write(chunk);
}
