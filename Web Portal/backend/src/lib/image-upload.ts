import { ValidationError } from './http-errors';
import { sniffMime, SNIFFABLE } from './magic-mime';
import { imageDimensions } from './image-dimensions';
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
export interface ImageRules {
  maxBytes: number;
  /** Accepted types (default ALLOWED_IMAGE_MIME) and how to say so when a file isn't one. */
  allowedMime?: string[];
  typeMessage?: string;
  /** What to say when the bytes aren't the picture type the file claims to be. */
  contentMessage?: string;
  /** Size limits in pixels, read from the file's header (checked when given). */
  minSide?: number;
  maxSide?: number;
}

const mb = (bytes: number) => `${Math.round((bytes / 1024 / 1024) * 10) / 10} MB`;

export async function storeImageUpload(
  storage: AttachmentStorage,
  file: UploadedImage,
  opts: ImageRules,
): Promise<{ url: string; storageKey: string }> {
  if (file.content.length === 0) throw new ValidationError('File is empty.');
  if (file.content.length > opts.maxBytes) throw new ValidationError(`Images can be up to ${mb(opts.maxBytes)}; this one is ${mb(file.content.length)}.`);
  if (!(opts.allowedMime ?? ALLOWED_IMAGE_MIME).includes(file.mimeType)) {
    throw new ValidationError(opts.typeMessage ?? 'Only PNG, JPEG, WebP or GIF images are allowed.');
  }
  if (SNIFFABLE.has(file.mimeType)) {
    const actual = sniffMime(file.content);
    if (actual !== file.mimeType) throw new ValidationError(opts.contentMessage ?? 'Image content does not match its declared type.');
  }
  if (opts.minSide !== undefined || opts.maxSide !== undefined) {
    const size = imageDimensions(file.content);
    if (!size) throw new ValidationError('This file isn’t a picture that can be read.');
    if (opts.maxSide !== undefined && (size.width > opts.maxSide || size.height > opts.maxSide)) {
      throw new ValidationError(`Images can be up to ${opts.maxSide} × ${opts.maxSide} pixels; this one is ${size.width} × ${size.height}.`);
    }
    if (opts.minSide !== undefined && (size.width < opts.minSide || size.height < opts.minSide)) {
      throw new ValidationError(`Images need to be at least ${opts.minSide} × ${opts.minSide} pixels.`);
    }
  }
  const stored = await storage.save({ filename: file.filename, mimeType: file.mimeType, content: file.content });
  return { url: stored.url, storageKey: stored.storageKey };
}
