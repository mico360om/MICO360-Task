import { ValidationError } from './http-errors';
import { sniffMime, SNIFFABLE } from './magic-mime';
import type { AttachmentStorage } from '../modules/tasks/attachment-repository';

/** Image types accepted for avatars and project images. */
export const ALLOWED_IMAGE_MIME = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

export interface UploadedImage {
  filename: string;
  mimeType: string;
  content: Buffer;
}

/**
 * Validate an uploaded image (non-empty, within size, an allowed image type, and — where the
 * type is sniffable — that the bytes match the declared type) and persist it via the storage
 * adapter. Returns the server-relative url (e.g. /uploads/<key>) + the storage key.
 */
export async function storeImageUpload(
  storage: AttachmentStorage,
  file: UploadedImage,
  opts: { maxBytes: number },
): Promise<{ url: string; storageKey: string }> {
  if (file.content.length === 0) throw new ValidationError('File is empty.');
  if (file.content.length > opts.maxBytes) throw new ValidationError(`Image exceeds the ${opts.maxBytes}-byte limit.`);
  if (!ALLOWED_IMAGE_MIME.includes(file.mimeType)) {
    throw new ValidationError('Only PNG, JPEG, WebP or GIF images are allowed.');
  }
  if (SNIFFABLE.has(file.mimeType)) {
    const actual = sniffMime(file.content);
    if (actual !== file.mimeType) throw new ValidationError('Image content does not match its declared type.');
  }
  const stored = await storage.save({ filename: file.filename, mimeType: file.mimeType, content: file.content });
  return { url: stored.url, storageKey: stored.storageKey };
}
