import { createHash, randomUUID } from 'node:crypto';
import { extensionForMime } from '../../lib/upload-safety';

/**
 * 1.23.38 Upload folders (docs/superpowers/specs/2026-11-18-upload-folders-design.md): every stored file
 * is kept at
 *
 *   <companyId | shared>/<YYYY>/<MM>/<uploaderUserId | system>/<type>/<uuid>.<ext>
 *
 * — the company of the task, chat, project or company it belongs to (`shared`: a profile photo, a direct
 * chat, the Learning Hub), the upload's UTC year and month, the person who uploaded it, and its kind. The
 * name is still a random UUID, so names never collide. Only database ids appear (never names).
 *
 * The path is never trusted on its own: the database row decides who may open a file (file-access.ts).
 * A name is only ever looked up when `parseUploadKey` accepts it: one of the 1.23.31 plain names, or
 * exactly the six parts above — no `..`, backslash, NUL, `%`, space or anything else.
 */
export const UPLOAD_TYPES = [
  'task-files',
  'chat-files',
  'meeting-files',
  'decision-files',
  'inspection-photos',
  'signatures',
  'profile-photos',
  'project-pictures',
  'company-logos',
  'learning-hub',
] as const;
export type UploadType = (typeof UPLOAD_TYPES)[number];

/** Where a new file goes: its company (null: shared), its uploader (null: system), its kind and when. */
export interface UploadPlace {
  companyId: string | null;
  userId: string | null;
  type: UploadType;
  /** The upload's time (default now); its UTC year and month name the folders. */
  at?: Date;
}

export const SHARED = 'shared';
export const SYSTEM = 'system';
const MAX_KEY = 200;
/** A database id (cuid) or our own words: letters, digits, `-` and `_`. */
const ID = /^[A-Za-z0-9_-]{1,64}$/;
/** Folder names at the top of the uploads folder that are never a company. */
const RESERVED_TOP = new Set([SHARED, 'faces', 'downloads', 'training-files', 'backups']);
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const EXT = /^\.[A-Za-z0-9]{1,10}$/;
/** The 1.23.31 names: a random UUID, and an extension (v0.1.0 kept the uploader's own). */
const LEGACY = new RegExp(`^${UUID}(?:\\.[^/\\\\%\\0]{1,40})?$`, 'i');
const NEW_FORM = new RegExp(`^([A-Za-z0-9_-]{1,64})/(\\d{4})/(0[1-9]|1[0-2])/([A-Za-z0-9_-]{1,64})/(${UPLOAD_TYPES.join('|')})/(${UUID}(?:\\.[A-Za-z0-9]{1,10})?)$`, 'i');

export interface ParsedUploadKey {
  key: string;
  /** A 1.23.31 plain name (no folders). */
  legacy: boolean;
  /** The company in the path; null for `shared` or a plain name. */
  companyId: string | null;
  type: UploadType | null;
  /** The file's own name (the last part). */
  name: string;
}

/** A stored name this server could have made, or null for anything else (never looked up). */
export function parseUploadKey(raw: unknown): ParsedUploadKey | null {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > MAX_KEY) return null;
  if (/[\\%\0\s?#]/.test(raw) || raw.includes('..')) return null;
  if (LEGACY.test(raw)) return { key: raw, legacy: true, companyId: null, type: null, name: raw };
  const m = NEW_FORM.exec(raw);
  if (!m) return null;
  const company = m[1]!;
  if (company !== SHARED && RESERVED_TOP.has(company)) return null;
  if (!(UPLOAD_TYPES as readonly string[]).includes(m[5]!)) return null; // the type is matched case-sensitively
  return { key: raw, legacy: false, companyId: company === SHARED ? null : company, type: m[5] as UploadType, name: m[6]! };
}

function folders(place: UploadPlace): string {
  const company = place.companyId ?? SHARED;
  const user = place.userId ?? SYSTEM;
  if (place.companyId !== null && (!ID.test(company) || RESERVED_TOP.has(company))) throw new Error('Not a company id for an upload folder.');
  if (!ID.test(user)) throw new Error('Not a person id for an upload folder.');
  if (!(UPLOAD_TYPES as readonly string[]).includes(place.type)) throw new Error('Not an upload type.');
  const at = place.at ?? new Date();
  const year = String(at.getUTCFullYear()).padStart(4, '0');
  const month = String(at.getUTCMonth() + 1).padStart(2, '0');
  return `${company}/${year}/${month}/${user}/${place.type}`;
}

/** A new file's key: its folders and `<uuid><ext>` (ext like '.png', or ''). */
export function buildUploadKey(place: UploadPlace & { ext: string }, uuid: string = randomUUID()): string {
  if (place.ext !== '' && !EXT.test(place.ext)) throw new Error('Not an extension for an upload.');
  const key = `${folders(place)}/${uuid}${place.ext}`;
  if (!parseUploadKey(key)) throw new Error('Not an upload key.');
  return key;
}

/** A UUID made from an old name that isn't one (the same name always gives the same UUID). */
export function uuidNameFor(oldName: string): string {
  const h = createHash('sha256').update(`mico360-upload-name|${oldName}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${((parseInt(h[16]!, 16) & 3) | 8).toString(16)}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/**
 * The key an old plain name moves to: the same UUID (so a move that stopped half way finds the same
 * copy), its extension when it is a plain one, else the checked type's.
 */
export function newFormKey(oldKey: string, place: UploadPlace & { mimeType?: string | null }): string {
  const m = new RegExp(`^(${UUID})(\\..*)?$`, 'i').exec(oldKey);
  const uuid = m ? m[1]!.toLowerCase() : uuidNameFor(oldKey);
  const own = m?.[2] ?? '';
  const ext = own === '' ? '' : EXT.test(own) ? own : place.mimeType ? extensionForMime(place.mimeType) : '';
  return buildUploadKey({ ...place, ext: ext === '' || EXT.test(ext) ? ext : '' }, uuid);
}

/** A new-form key with another company (a project that moved): null for a plain name. */
export function refiledKey(key: string, companyId: string | null): string | null {
  const parsed = parseUploadKey(key);
  if (!parsed || parsed.legacy) return null;
  const rest = key.slice(key.indexOf('/'));
  const next = `${companyId ?? SHARED}${rest}`;
  return parseUploadKey(next) ? next : null;
}

/** '/uploads/<key>' with each part of the key encoded on its own (the slashes stay slashes). */
export function uploadUrlOf(key: string): string {
  return `/uploads/${key.split('/').map(encodeURIComponent).join('/')}`;
}
