import { mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { AttachmentStorage, UploadedFile } from './attachment-repository';
import { extensionForMime } from '../../lib/upload-safety';
import { buildUploadKey, parseUploadKey, uploadUrlOf, type UploadPlace } from '../files/upload-paths';

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
 *
 * 1.23.38 Upload folders: a new file goes to <company>/<YYYY>/<MM>/<uploader>/<type>/<uuid>.<ext>
 * (modules/files/upload-paths.ts). Files are read and removed only by a key `parseUploadKey` accepts:
 * those folders, or a 1.23.31 plain name — nothing can reach outside the uploads folder.
 */
export function createLocalDiskStorage({ baseDir, publicPrefix }: LocalDiskStorageDeps): AttachmentStorage {
  const pathOf = (storageKey: string): string | null => {
    const parsed = parseUploadKey(storageKey);
    return parsed ? join(baseDir, ...parsed.key.split('/')) : null;
  };

  async function save(file: UploadedFile, place: UploadPlace) {
    const storageKey = buildUploadKey({ ...place, ext: extensionForMime(file.mimeType) });
    const path = join(baseDir, ...storageKey.split('/'));
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, file.content);
    return {
      storageKey,
      url: publicPrefix === '/uploads' ? uploadUrlOf(storageKey) : `${publicPrefix}/${storageKey}`,
      sizeBytes: file.content.length,
    };
  }

  async function remove(storageKey: string): Promise<void> {
    const path = pathOf(storageKey);
    if (path) await rm(path, { force: true });
  }

  async function read(storageKey: string): Promise<Buffer> {
    const path = pathOf(storageKey);
    if (!path) throw new Error('Not a stored file’s key.');
    return readFile(path);
  }

  return { save, remove, read };
}
