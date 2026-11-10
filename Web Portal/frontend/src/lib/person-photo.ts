/**
 * Avatar thumbnails (11 Nov): every face on the website loads the photo's small copy — 256 px square,
 * a few KB — instead of the photo itself (up to 5 MB). The copy's address comes from the photo's own (the
 * server's rule in backend/src/lib/avatar-face.ts, word for word; person-photo.test.ts compares them), so
 * a new photo is a new address and the browser keeps a copy for good. The server makes a copy for an
 * older photo the first time it is asked for, and sends the photo itself when it can't.
 */

/** Our stored pictures' keys: a random UUID and the extension of its checked picture type. */
const PICTURE_KEY = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(?:png|jpg|jpeg|webp|gif)$/;

/** The face copy's address for a photo, or null when it isn't one of our stored pictures. */
export function faceUrlOf(avatarUrl: string | null | undefined): string | null {
  if (!avatarUrl || !avatarUrl.startsWith('/uploads/')) return null;
  const key = avatarUrl.slice('/uploads/'.length);
  return PICTURE_KEY.test(key) ? `/uploads/faces/${key}.webp` : null;
}
