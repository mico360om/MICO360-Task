/**
 * Your profile on the phone (6a), as the website's Profile page shows it: the full name from the
 * people directory, the role as Administrator or Employee, the photo, and "Download my data". Pure
 * helpers; the screen supplies the picker, the requests and the share sheet.
 */
import { ApiError, isNetworkError } from './api-client';
import { attachmentHref, uploadMimeType } from './attachments';
import type { Session } from './types';

/** You, as the server sends you back after a photo change (POST/DELETE /users/me/avatar). */
export interface ApiAccountUser {
  id: string;
  email: string;
  username: string;
  firstName: string;
  lastName: string;
  roles: string[];
  avatarUrl: string | null;
}

/** "Download my data": everything the system holds about you, as a JSON file. */
export const MY_DATA_EXPORT_PATH = '/users/me/export';

/** The role as the website labels it: an administrator is "Administrator", everyone else "Employee". */
export function accountRoleLabel(roles: readonly string[] | null | undefined): 'Administrator' | 'Employee' {
  return (roles ?? []).includes('ADMIN') ? 'Administrator' : 'Employee';
}

/** "First Last" from the people directory, else the username (as the website), else a dash. */
export function fullNameOf(
  me: { firstName?: string | null; lastName?: string | null; username?: string | null } | null | undefined,
  username: string | null | undefined,
): string {
  const name = me ? `${me.firstName ?? ''} ${me.lastName ?? ''}`.trim() : '';
  return name || me?.username || username || '—';
}

/** The two letters on a photo-less avatar, as the website makes them. */
export function initialsOf(name: string): string {
  return (name || '?').slice(0, 2).toUpperCase();
}

/** The picture types the server takes for a profile photo (PNG, JPEG, WebP, GIF). */
export const AVATAR_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

const EXTENSION: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' };

/** A picked picture as the multipart part ({ uri, name, type }); a nameless pick gets "photo.<ext>". */
export function avatarPart(asset: { uri: string; name?: string | null; mimeType?: string | null }): { uri: string; name: string; type: string } {
  const picked = (asset.mimeType ?? '').trim().toLowerCase();
  const name = asset.name?.trim() || `photo.${EXTENSION[picked] ?? 'jpg'}`;
  return { uri: asset.uri, name, type: uploadMimeType(name, asset.mimeType) };
}

/** Where to show a photo from (the API server's origin + its path), or null for none. */
export function avatarHref(apiBase: string, url: string | null | undefined): string | null {
  return url ? attachmentHref(apiBase, url) : null;
}

/** Did the server give a reason of its own (not just "Request failed (400)")? */
const ownReason = (e: ApiError) => e.code !== 'ERROR' && !!e.message && !/^Request failed/.test(e.message);

/** Why a picture wasn't taken, in the website's words; offline and slow uploads say so plainly. */
export function photoUploadProblem(error: unknown): string {
  if (isNetworkError(error)) {
    return (error as { timedOut?: unknown }).timedOut === true
      ? 'The upload took too long. Check your connection and try again.'
      : 'You’re offline — your photo can be changed when you’re connected.';
  }
  if (error instanceof ApiError) {
    if (error.status === 413) return 'That picture is too large. Choose a smaller one.';
    if (error.status === 400 && /does not match/i.test(error.message)) {
      return 'That file isn’t a real picture — it may be damaged or renamed. Choose a PNG, JPEG, WebP or GIF image.';
    }
    if (error.status >= 400 && error.status < 500 && ownReason(error)) return error.message;
  }
  return 'Couldn’t upload the photo. Please try again.';
}

/** Why the photo wasn't removed. */
export function photoRemoveProblem(error: unknown): string {
  if (isNetworkError(error)) return 'You’re offline — your photo can be removed when you’re connected.';
  return 'Couldn’t remove the photo. Please try again.';
}

/** The session with a new photo (the tokens and everything else as they are). */
export function withAvatar(session: Session, avatarUrl: string | null): Session {
  return { ...session, user: { ...session.user, avatarUrl } };
}

/** The people list with one person's new photo; the others are the same objects. */
export function withDirectoryUser<T extends { id: string; avatarUrl?: string | null }>(
  list: T[] | undefined,
  user: { id: string; avatarUrl: string | null },
): T[] | undefined {
  return list?.map((p) => (p.id === user.id ? { ...p, avatarUrl: user.avatarUrl } : p));
}

/** The website's name for the file (the server's own name, from its header, wins). */
export function myDataFileName(today: string): string {
  return `mico360-my-data-${today}.json`;
}

/** Why "Download my data" didn't give a file. */
export function myDataProblem(error: unknown): string {
  if (isNetworkError(error)) return 'You’re offline — your data can be downloaded when you’re connected.';
  if (error instanceof ApiError) return 'Couldn’t prepare your data. Please try again.';
  return error instanceof Error && error.message ? error.message : 'Couldn’t prepare your data. Please try again.';
}
