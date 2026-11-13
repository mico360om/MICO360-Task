/**
 * Review fix #23 (batch 4b): removing a stored upload (task and chat files, profile photos, project pictures,
 * company logos — everything under /uploads) once nothing points at it any more.
 *
 * The record goes first, then the file: a record never points at a missing file. A file the disk won't let go
 * of (Windows keeps a file that is open elsewhere, a virus scanner may hold it for a moment) is tried again a
 * couple of times; if it still can't be deleted it is logged with its key — so it can be found and removed by
 * hand — and the caller carries on: the person's delete or change has already happened.
 */
export interface StoredFileRemover {
  remove(storageKey: string): Promise<void>;
}

export interface RemoveStoredFileOptions {
  /** Where a file that couldn't be deleted is reported. Absent: the console. */
  logger?: { warn(message: string, context?: Record<string, unknown>): void };
  /** What the file was, for the log ("a deleted task file"). */
  what?: string;
  /** Tries in all (default 3). */
  attempts?: number;
  /** The pause before a retry grows from this (ms; default 200). */
  pauseMs?: number;
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** True when the file is gone; false (logged, never thrown) when it couldn't be deleted. */
export async function removeStoredFile(storage: StoredFileRemover, storageKey: string, opts: RemoveStoredFileOptions = {}): Promise<boolean> {
  const attempts = Math.max(1, opts.attempts ?? 3);
  const pauseMs = opts.pauseMs ?? 200;
  let last: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      await storage.remove(storageKey);
      return true;
    } catch (err) {
      last = err;
      if (attempt < attempts && pauseMs > 0) await pause(pauseMs * attempt);
    }
  }
  const context = { storageKey, what: opts.what ?? 'a file', err: last };
  try {
    if (opts.logger) opts.logger.warn('A stored file could not be deleted; it is still on disk', context);
    else console.warn('A stored file could not be deleted; it is still on disk', context);
  } catch {
    // Reporting is best effort too.
  }
  return false;
}

/** The storage key of one of our own /uploads/<key> addresses (one file, at the top of the folder), else null. */
export function storedKeyOf(url: string | null | undefined): string | null {
  if (!url || !url.startsWith('/uploads/')) return null;
  const key = url.slice('/uploads/'.length);
  return key && !key.includes('/') && !key.includes('\\') && !key.startsWith('.') ? key : null;
}
