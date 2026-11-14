import { createHmac, hkdfSync, timingSafeEqual } from 'node:crypto';

/**
 * 1.23.29 Private file links (docs/superpowers/specs/2026-11-13-private-file-links-design.md §7.1).
 *
 * A task or chat file keeps its address, `/uploads/<key>`, with `?u=<person>&e=<expiry>&s=<signature>`
 * added: the server writes this link into the same `url` field the website, the Android app and the
 * extension already read, signed for the person asking. On every download the file route checks the
 * signature and expiry, that the account is still active with the same session version (which is inside
 * the signature, never in the link: a password change or "sign out everywhere" ends every link at once),
 * and that the person can still see the task or chat.
 *
 * Links are the same all through a 6-hour block (pictures stay in caches; the extension doesn't redraw a
 * message on every poll) and stop working 30 hours after their block began, so 24–30 hours after they
 * were given. Only letters, digits, `-` and `_` are added: no dot, `%`, `#` or backslash, which the
 * extension's and the app's checks would refuse.
 */
export const FILE_LINK_LIFE_HOURS = 30;
export const FILE_LINK_BLOCK_HOURS = 6;

/** Who a link is for: the person and their session version (the access token's `ver`). */
export interface FileViewer {
  id: string;
  ver: number;
}

/** A link's three parts as read from its address. */
export interface FileLinkParts {
  u: string;
  e: string;
  s: string;
}

const UPLOADS = '/uploads/';
const USER_ID = /^[A-Za-z0-9_-]{1,64}$/;
const EXPIRY = /^[0-9a-z]{1,12}$/;
/** HMAC-SHA256 in base64url without padding: 43 characters. */
const SIGNATURE = /^[A-Za-z0-9_-]{43}$/;
/** A stored task or chat file's address: /uploads/<one name>, nothing more. */
const STORED_URL = /^\/uploads\/([^/?#\\]+)$/;

export interface FileLinkOptions {
  /** The server's secret (JWT_ACCESS_SECRET; FILE_LINK_SECRET when set). A key for file links alone is made from it. */
  secret: string;
  /** Testing only: a shorter life, in minutes (a block is a fifth of it). Default 30 hours. */
  minutes?: number;
  now?: () => number;
}

export function createFileLinks(opts: FileLinkOptions) {
  const now = opts.now ?? (() => Date.now());
  const key = Buffer.from(hkdfSync('sha256', opts.secret, 'mico360-file-links', 'mico360/file-links/v1', 32));
  const lifeSec = Math.max(60, Math.round((opts.minutes ?? FILE_LINK_LIFE_HOURS * 60) * 60));
  const blockSec = Math.max(1, Math.floor(lifeSec / (FILE_LINK_LIFE_HOURS / FILE_LINK_BLOCK_HOURS)));
  /** How far past a full life an expiry may be (clock differences): an hour for a 30-hour life. */
  const slackSec = Math.max(60, Math.floor(lifeSec / FILE_LINK_LIFE_HOURS));

  const mac = (storageKey: string, u: string, e: string, ver: number) =>
    createHmac('sha256', key).update(`f1|${storageKey}|${u}|${e}|${ver}`).digest('base64url');

  /** The expiry of a link made now: the start of the current block, plus a full life. */
  function expiry(): string {
    const nowSec = Math.floor(now() / 1000);
    return (Math.floor(nowSec / blockSec) * blockSec + lifeSec).toString(36);
  }

  /** The signed address of a stored file for this person. */
  function sign(storageKey: string, viewer: FileViewer): string {
    const e = expiry();
    return `${UPLOADS}${encodeURIComponent(storageKey)}?u=${encodeURIComponent(viewer.id)}&e=${e}&s=${mac(storageKey, viewer.id, e, viewer.ver)}`;
  }

  /** A stored `/uploads/<key>` address, signed; anything else (another site, a face copy, empty) as it is. */
  function signUrl(url: string, viewer: FileViewer): string {
    const m = STORED_URL.exec(url ?? '');
    if (!m) return url;
    let storageKey: string;
    try {
      storageKey = decodeURIComponent(m[1]!);
    } catch {
      return url;
    }
    return sign(storageKey, viewer);
  }

  /** The link's parts from a request's query, or null when one is missing, repeated or malformed. */
  function parse(query: unknown): FileLinkParts | null {
    if (!query || typeof query !== 'object') return null;
    const q = query as Record<string, unknown>;
    const { u, e, s } = q;
    if (typeof u !== 'string' || typeof e !== 'string' || typeof s !== 'string') return null;
    if (!USER_ID.test(u) || !EXPIRY.test(e) || !SIGNATURE.test(s)) return null;
    // One spelling per expiry (no leading zeros): the signed text is exactly what the server wrote.
    if (parseInt(e, 36).toString(36) !== e) return null;
    return { u, e, s };
  }

  /** Not expired, and not further ahead than a link this server could have made. */
  function fresh(link: FileLinkParts): boolean {
    const e = parseInt(link.e, 36);
    const nowSec = now() / 1000;
    return Number.isFinite(e) && e > nowSec && e - nowSec <= lifeSec + slackSec;
  }

  /** Does the signature match this file, person, expiry and session version? (Timing-safe.) */
  function verify(storageKey: string, link: FileLinkParts, ver: number): boolean {
    const want = Buffer.from(mac(storageKey, link.u, link.e, ver));
    const got = Buffer.from(link.s);
    return want.length === got.length && timingSafeEqual(want, got);
  }

  return { sign, signUrl, parse, fresh, verify };
}

export type FileLinks = ReturnType<typeof createFileLinks>;

/** Is this an address the server signed (a stored file's path with u, e and s)? */
export function isSignedUploadUrl(url: string): boolean {
  return /^\/uploads\/[^/?#\\]+\?u=[A-Za-z0-9_-]+&e=[0-9a-z]+&s=[A-Za-z0-9_-]+$/.test(url);
}

/** A list of stored files with each `url` signed for the viewer (by its storage key). */
export function signFiles<T extends { storageKey: string; url: string }>(links: FileLinks | undefined, files: T[], viewer: FileViewer): T[] {
  if (!links) return files;
  return files.map((f) => ({ ...f, url: links.sign(f.storageKey, viewer) }));
}

/** A chat message with its files' links signed for the viewer (a message without files comes back as it is). */
export function signMessageFiles<M extends { attachments?: { storageKey: string; url: string }[] }>(links: FileLinks | undefined, message: M, viewer: FileViewer): M {
  if (!links || !message.attachments || message.attachments.length === 0) return message;
  return { ...message, attachments: signFiles(links, message.attachments, viewer) };
}

/** The person a signed-in request is answered for (its session version is on the request: auth-guard.ts). */
export function viewerOfRequest(req: { user?: { id: string; ver?: number } }): FileViewer {
  return { id: req.user!.id, ver: req.user?.ver ?? 0 };
}
