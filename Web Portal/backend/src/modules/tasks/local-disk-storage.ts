import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { AttachmentStorage, UploadedFile } from './attachment-repository';
import { extensionForMime } from '../../lib/upload-safety';

export interface LocalDiskStorageDeps {
  /** Directory on disk where files are written. */
  baseDir: string;
  /** URL prefix the files are served from (e.g. "/uploads"). */
  publicPrefix: string;
}

/**
 * Stores attachment bytes on the local filesystem. The storageKey is a random,
 * unguessable name whose extension comes from the validated MIME type — never from
 * the uploader's filename, so an upload can't become an .html/.svg page on our
 * origin. Swap this adapter for an S3/GCS one without touching the service.
 */
export function createLocalDiskStorage({ baseDir, publicPrefix }: LocalDiskStorageDeps): AttachmentStorage {
  async function save(file: UploadedFile) {
    await mkdir(baseDir, { recursive: true });
    const storageKey = `${randomUUID()}${extensionForMime(file.mimeType)}`;
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
