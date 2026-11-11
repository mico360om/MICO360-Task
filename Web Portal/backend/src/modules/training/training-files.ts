import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { ValidationError } from '../../lib/http-errors';
import { sniffMime } from '../../lib/magic-mime';
import { extensionForMime, fileContentMismatchMessage, fileTooLargeMessage, fileTypeNotAllowedMessage, safeUploadName } from '../../lib/upload-safety';
import { attachmentDisposition, downloadType } from '../clients/portal-routes';
import { LIMITS, type FileKind } from './training-types';

/**
 * Training Center files (R14): a private folder beside the uploads — never under UPLOAD_DIR, which the
 * website serves to anyone at /uploads — read only through the signed-in training routes after the
 * course's audience check. The folder is in the backups too (backup-wiring).
 */

/** Is `child` the folder `parent` or inside it? Whole folder names (M13); case-insensitive on Windows. */
function isInside(child: string, parent: string): boolean {
  const norm = (p: string) => (process.platform === 'win32' ? resolve(p).toLowerCase() : resolve(p));
  const rel = relative(norm(parent), norm(child));
  if (rel === '') return true;
  if (isAbsolute(rel)) return false;
  return rel.split(/[\\/]/)[0] !== '..';
}

/**
 * TRAINING_FILES_DIR, else `training-files` beside UPLOAD_DIR (outside the app folder, so deploys keep it).
 * Never inside the uploads folder or the web app folder (WEB_ROOT): both are served to anyone (M13).
 */
export function trainingFilesDirFor(env: { UPLOAD_DIR: string; TRAINING_FILES_DIR?: string; WEB_ROOT?: string }, cwd: string): string {
  const uploads = resolve(cwd, env.UPLOAD_DIR);
  const own = env.TRAINING_FILES_DIR?.trim();
  const dir = own ? resolve(cwd, own) : join(dirname(uploads), 'training-files');
  if (isInside(dir, uploads)) {
    throw new Error('TRAINING_FILES_DIR is inside the uploads folder, which the website serves to anyone. Choose a private folder outside it.');
  }
  const web = env.WEB_ROOT?.trim();
  if (web && isInside(dir, resolve(cwd, web))) {
    throw new Error('The training files folder is inside the web app folder (WEB_ROOT), which the website serves to anyone. Set TRAINING_FILES_DIR to a private folder outside it.');
  }
  return dir;
}

const OOXML = [
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
];
const PICTURES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
const TEXT = ['text/plain', 'text/csv'];

/** What a training document or download may be (magic-checked); pictures only for steps and signatures. */
export const TRAINING_FILE_TYPES: readonly string[] = ['application/pdf', ...PICTURES, ...OOXML, ...TEXT, 'application/zip'];

export interface TrainingUpload {
  filename: string;
  mimeType: string;
  content: Buffer;
}

/** The checked type and the name kept, or a plain refusal (400). */
export function checkTrainingUpload(file: TrainingUpload, kind: FileKind): { mimeType: string; name: string } {
  const mimeType = String(file.mimeType ?? '').toLowerCase().split(';')[0]!.trim();
  const picture = kind === 'IMAGE' || kind === 'SIGNATURE';
  if (!TRAINING_FILE_TYPES.includes(mimeType)) throw new ValidationError(fileTypeNotAllowedMessage(file.filename));
  if (picture && !PICTURES.includes(mimeType)) throw new ValidationError('Choose a picture (PNG, JPEG, GIF or WebP).');
  if (file.content.length === 0) throw new ValidationError('That file is empty.');
  const max = picture ? LIMITS.imageBytes : LIMITS.documentBytes;
  if (file.content.length > max) throw new ValidationError(fileTooLargeMessage(max));
  const actual = sniffMime(file.content);
  const ok = OOXML.includes(mimeType) ? actual === 'application/zip' : TEXT.includes(mimeType) ? actual === null && !file.content.includes(0) : actual === mimeType;
  if (!ok) throw new ValidationError(fileContentMismatchMessage(file.filename));
  return { mimeType, name: safeUploadName(file.filename, mimeType).slice(0, LIMITS.fileName) };
}

export interface TrainingFileStore {
  /** Writes the bytes under a new random key (extension from the checked type); returns the key. */
  save(content: Buffer, mimeType: string): Promise<string>;
  read(storageKey: string): Promise<Buffer>;
  remove(storageKey: string): Promise<void>;
  readonly dir: string;
}

export function createTrainingFileStore(dir: string): TrainingFileStore {
  return {
    dir,
    async save(content, mimeType) {
      await mkdir(dir, { recursive: true });
      const key = `${randomUUID()}${extensionForMime(mimeType)}`;
      await writeFile(join(dir, key), content);
      return key;
    },
    async read(storageKey) {
      // Keys are our own random names; basename() keeps a bad key from leaving the folder.
      if (basename(storageKey) !== storageKey) throw new Error('Not a training file key.');
      return readFile(join(dir, storageKey));
    },
    async remove(storageKey) {
      if (basename(storageKey) !== storageKey) return;
      await rm(join(dir, storageKey), { force: true });
    },
  };
}

const INLINE = new Set([...PICTURES, 'application/pdf']);

/** A training file's reply headers: pictures and PDFs open in the browser, anything else downloads. */
export function trainingFileHeaders(f: { name: string; mimeType: string }): Record<string, string> {
  const type = downloadType(f.mimeType);
  const disposition = attachmentDisposition(f.name);
  return {
    'Content-Type': type,
    'Content-Disposition': INLINE.has(type) ? disposition.replace(/^attachment;/, 'inline;') : disposition,
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "sandbox; default-src 'none'",
    'Cache-Control': 'no-store',
  };
}
