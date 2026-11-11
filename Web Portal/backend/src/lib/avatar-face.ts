/**
 * A person's photo as the website's faces show it (avatar thumbnails, 11 Nov): a small square copy of
 * the photo, kept beside the uploads at /uploads/faces/<the photo's key>.webp. The address comes from
 * the photo's own — a new photo is a new key, so a face can be kept by the browser for good. The
 * original stays where it is (/uploads/<key>) for wherever a big photo is shown.
 *
 * The website has a copy of `faceUrlOf` (frontend/src/lib/person-photo.ts); a test keeps them the same.
 */

/** A face copy is this many pixels square: sharp on a 2× screen for the biggest face drawn (128 px). */
export const FACE_SIDE = 256;

/** Our stored pictures' keys: a random UUID and the extension of its checked picture type. */
const PICTURE_KEY = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(?:png|jpg|jpeg|webp|gif)$/;

/** The face copy's address for a photo, or null when it isn't one of our stored pictures. */
export function faceUrlOf(avatarUrl: string | null | undefined): string | null {
  if (!avatarUrl || !avatarUrl.startsWith('/uploads/')) return null;
  const key = avatarUrl.slice('/uploads/'.length);
  return PICTURE_KEY.test(key) ? `/uploads/faces/${key}.webp` : null;
}

/** The photo a face file name was made from (`<key>.webp` → /uploads/<key>), or null for any other name. */
export function originalUrlOfFace(fileName: string): string | null {
  if (!fileName.endsWith('.webp')) return null;
  const key = fileName.slice(0, -'.webp'.length);
  return PICTURE_KEY.test(key) ? `/uploads/${key}` : null;
}
