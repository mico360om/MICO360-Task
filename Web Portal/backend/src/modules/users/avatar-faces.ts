import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { faceUrlOf, originalUrlOfFace } from '../../lib/avatar-face';
import { uploadResponseHeaders } from '../../lib/upload-safety';
import { removeStoredFile } from '../../lib/stored-files';

/**
 * Avatar thumbnails (11 Nov): the website's faces load a small copy of each photo (lib/avatar-face.ts)
 * instead of the photo itself (up to 5 MB). The copy is written when a photo is uploaded; a photo from
 * before gets it the first time it is asked for. Only a person's current photo ever gets a copy, so this
 * is no new way to read any other upload. The route has no rate limit (no upload does), so a request
 * costs nothing beyond a file check unless a stored photo is behind the name; copies are made one at a
 * time, each once however many ask at once, and a photo whose copy failed isn't tried again on every
 * view. When no copy can be made (the picture library missing, a damaged file) the face is the photo.
 */
export interface AvatarFacesDeps {
  /** The uploads folder: photos are in it by key, copies go in its faces/ folder (served at /uploads/faces/). */
  dir: string;
  /** A stored upload's bytes by its key (throws when it is gone). */
  readOriginal(key: string): Promise<Buffer>;
  /** Is this /uploads/… address someone's current photo? */
  isAvatar(url: string): Promise<boolean>;
  /** The face copy of a photo, or null when it can't be made (image-shrink `toFace`). */
  toFace(content: Buffer): Promise<Buffer | null>;
  /** False when copies can't be made on this server (the picture library didn't load). */
  canMake?: () => boolean;
  warn?: (message: string, meta?: Record<string, unknown>) => void;
}

export type FaceAnswer = { file: string } | { fallback: string } | null;

export interface AvatarFaces {
  /** After an upload: write the photo's face copy. Never fails the upload. */
  prepare(url: string, content: Buffer): Promise<void>;
  /** A face file by its name: on disk (made now if need be), the photo itself when no copy can be made, or not found. */
  find(fileName: string): Promise<FaceAnswer>;
  /** Review fix #24: a replaced or removed photo's face copy is deleted (tried again, then logged; never thrown). */
  discard(url: string): Promise<void>;
}

/** Photos whose copy failed, remembered (up to this many) until the server restarts. */
const FAILED_KEPT = 1000;

export function createAvatarFaces(deps: AvatarFacesDeps): AvatarFaces {
  const folder = join(deps.dir, 'faces');
  const warn = deps.warn ?? (() => {});
  const canMake = deps.canMake ?? (() => true);
  const failed = new Set<string>();
  const making = new Map<string, Promise<FaceAnswer>>();
  // One copy made at a time: a page of old photos doesn't fill the server's worker threads at once.
  let turn: Promise<unknown> = Promise.resolve();
  const inTurn = <T>(work: () => Promise<T>): Promise<T> => {
    const run = turn.then(work, work);
    turn = run.catch(() => undefined);
    return run;
  };

  async function isFile(path: string): Promise<boolean> {
    try {
      return (await stat(path)).isFile();
    } catch {
      return false;
    }
  }

  /** Make and save one copy; the path written, or null when no copy could be made. */
  async function write(fileName: string, content: Buffer): Promise<string | null> {
    const face = await deps.toFace(content);
    if (!face) return null;
    await mkdir(folder, { recursive: true });
    const path = join(folder, fileName);
    // Written whole under another name, then moved into place: a reader never gets half a picture.
    const part = join(folder, `.${randomUUID()}.part`);
    try {
      await writeFile(part, face);
      await rename(part, path);
    } catch (err) {
      await rm(part, { force: true }).catch(() => {});
      throw err;
    }
    return path;
  }

  function remember(fileName: string) {
    if (failed.size >= FAILED_KEPT) failed.delete(failed.values().next().value as string);
    failed.add(fileName);
  }

  async function make(fileName: string, original: string, path: string): Promise<FaceAnswer> {
    if (!(await deps.isAvatar(original))) return null;
    let content: Buffer;
    try {
      content = await deps.readOriginal(original.slice('/uploads/'.length));
    } catch {
      return null;
    }
    try {
      if (await inTurn(() => write(fileName, content))) return { file: path };
    } catch (err) {
      warn('A photo’s face copy could not be written', { err });
    }
    remember(fileName);
    return { fallback: original };
  }

  return {
    async prepare(url, content) {
      const face = faceUrlOf(url);
      if (!face) return;
      try {
        await inTurn(() => write(face.slice('/uploads/faces/'.length), content));
      } catch (err) {
        warn('A photo’s face copy could not be written; it is made when first asked for', { err });
      }
    },

    async find(fileName) {
      const original = originalUrlOfFace(fileName);
      if (!original) return null;
      const path = join(folder, fileName);
      if (await isFile(path)) return { file: path };
      // No stored photo behind the name: nothing more is asked (a made-up name never reaches the database).
      if (!(await isFile(join(deps.dir, original.slice('/uploads/'.length))))) return null;
      // Nothing to try (no picture library, or it failed before): the photo itself, at once.
      if (!canMake() || failed.has(fileName)) return { fallback: original };
      const already = making.get(fileName);
      if (already) return already;
      const job = make(fileName, original, path).finally(() => making.delete(fileName));
      making.set(fileName, job);
      return job;
    },

    async discard(url) {
      const face = faceUrlOf(url);
      if (!face) return;
      const fileName = face.slice('/uploads/faces/'.length);
      // A copy being made right now is waited for, so it can't land after the delete.
      await making.get(fileName)?.catch(() => null);
      failed.delete(fileName);
      await removeStoredFile({ remove: (name) => rm(join(folder, name), { force: true }) }, fileName, { logger: { warn }, what: 'a replaced profile photo’s face copy' });
    },
  };
}

/** Is this /uploads/… address someone's current photo? Asked only when a face is first made. */
export const prismaIsAvatar =
  (prisma: Pick<PrismaClient, 'user'>) =>
  async (url: string): Promise<boolean> =>
    (await prisma.user.findFirst({ where: { avatarUrl: url }, select: { id: true } })) !== null;

/** A face never changes at its address (a new photo is a new address): the browser keeps it for good. */
export const FACE_CACHE_CONTROL = 'private, max-age=31536000, immutable';
/** No copy for now: the photo itself, asked again after an hour (the library may be back). */
const FALLBACK_CACHE_CONTROL = 'private, max-age=3600';

/** GET /uploads/faces/:file — public like every upload; it takes precedence over the uploads folder's route. */
export async function registerAvatarFaceRoute(app: FastifyInstance, faces: AvatarFaces): Promise<void> {
  app.get('/uploads/faces/:file', async (req, reply) => {
    const { file } = req.params as { file: string };
    const found = await faces.find(file);
    if (!found) return reply.code(404).header('Cache-Control', 'no-store').send({ error: { code: 'NOT_FOUND', message: 'Not found.' } });
    if ('fallback' in found) return reply.code(302).header('Cache-Control', FALLBACK_CACHE_CONTROL).header('Location', found.fallback).send();
    const headers = uploadResponseHeaders(found.file);
    for (const [name, value] of Object.entries(headers)) reply.header(name, value);
    return reply.header('Cache-Control', FACE_CACHE_CONTROL).type('image/webp').send(await readFile(found.file));
  });
}
