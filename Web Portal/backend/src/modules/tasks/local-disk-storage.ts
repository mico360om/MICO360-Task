import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { AttachmentStorage, UploadedFile } from './attachment-repository';

export interface LocalDiskStorageDeps {
  /** Directory on disk where files are written. */
  baseDir: string;
  /** URL prefix the files are served from (e.g. "/uploads"). */
  publicPrefix: string;
}

/**
 * Stores attachment bytes on the local filesystem. The storageKey is a random,
 * unguessable name that keeps the original extension; swap this adapter for an
 * S3/GCS one in production without touching the service.
 */
export function createLocalDiskStorage({ baseDir, publicPrefix }: LocalDiskStorageDeps): AttachmentStorage {
  async function save(file: UploadedFile) {
    await mkdir(baseDir, { recursive: true });
    const storageKey = `${randomUUID()}${extname(file.filename)}`;
    await writeFile(join(baseDir, storageKey), file.content);
    return {
      storageKey,
      url: `${publicPrefix}/${storageKey}`,
      sizeBytes: file.content.length,
    };
  }

  async function remove(storageKey: string): Promise<void> {
    await rm(join(baseDir, storageKey), { force: true });
  }

  return { save, remove };
}
