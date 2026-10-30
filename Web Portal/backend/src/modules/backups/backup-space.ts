import { existsSync } from 'node:fs';
import { readdir, stat, statfs } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { SqlRunner } from './sql-runner';

const SPARE = 50 * 1024 * 1024;

/** Bytes free on the disk a folder is on (the nearest folder that exists; null when it can't be told). */
export async function diskFree(dir: string): Promise<number | null> {
  let at = dir;
  while (!existsSync(at) && dirname(at) !== at) at = dirname(at);
  try {
    const s = await statfs(at);
    return Number(s.bavail) * Number(s.bsize);
  } catch {
    return null;
  }
}

async function folderBytes(dir: string): Promise<number> {
  let total = 0;
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) total += await folderBytes(p);
    else if (e.isFile()) total += (await stat(p).catch(() => null))?.size ?? 0;
  }
  return total;
}

/**
 * About how much room a copy needs while it is made: the uploads, the database twice (its table
 * files in the work folder, then inside the copy — before compression) and 50 MB to spare.
 */
export async function estimateBackupBytes(sql: SqlRunner, uploadDir: string): Promise<number> {
  const rows = await sql.query<{ n: bigint | number | string | null }>('SELECT COALESCE(SUM(DATA_LENGTH), 0) AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()');
  const db = Number(rows[0]?.n ?? 0);
  return (await folderBytes(uploadDir)) + 2 * db + SPARE;
}
