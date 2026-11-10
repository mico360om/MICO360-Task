import { access, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { faceUrlOf, originalUrlOfFace } from '../../lib/avatar-face';
import { uploadResponseHeaders } from '../../lib/upload-safety';

/**
 * Avatar thumbnails (11 Nov): the website's faces load a small copy of each photo (lib/avatar-face.ts)
 * instead of the photo itself (up to 5 MB). The copy is written when a photo is uploaded; a photo from
 * before gets it the first time it is asked for. Only a person's current photo ever gets a copy, so this
 * is no new way to read any other upload, and a request for anything else costs no picture work. When
 * the copy can't be made (the picture library missing, a damaged file) the face is the photo itself.
 */
export interface AvatarFacesDeps {
  /** The uploads folder: copies go in its faces/ folder (served at /uploads/faces/). */
  dir: string;
  /** A stored upload's bytes by its key (throws when it is gone). */
  readOriginal(key: string): Promise<Buffer>;
  /** Is this /uploads/… address someone's current photo? */
  isAvatar(url: string): Promise<boolean>;
  /** The face copy of a photo, or null when it can't be made (image-shrink `toFace`). */
  toFace(content: Buffer): Promise<Buffer | null>;
  warn?: (message: string, meta?: Record<string, unknown>) => void;
}

export type FaceAnswer = { file: string } | { fallback: string } | null;

export interface AvatarFaces {
  /** After an upload: write the photo's face copy. Never fails the upload. */
  prepare(url: string, content: Buffer): Promise<void>;
  /** A face file by its name: on disk (made now if need be), the photo itself when no copy can be made, or not found. */
  find(fileName: string): Promise<FaceAnswer>;
}

export function createAvatarFaces(deps: AvatarFacesDeps): AvatarFaces {
  const folder = join(deps.dir, 'faces');
  const warn = deps.warn ?? (() => {});

  async function exists(path: string): Promise<boolean> {
    try {
      await access(path);
      return true;
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
    await writeFile(part, face);
    await rename(part, path);
    return path;
  }

  return {
    async prepare(url, content) {
      const face = faceUrlOf(url);
      if (!face) return;
      try {
        await write(face.slice('/uploads/faces/'.length), content);
      } catch (err) {
        warn('A photo’s face copy could not be written; it is made when first asked for', { err });
      }
    },

    async find(fileName) {
      const original = originalUrlOfFace(fileName);
      if (!original) return null;
      const path = join(folder, fileName);
      if (await exists(path)) return { file: path };
      if (!(await deps.isAvatar(original))) return null;
      let content: Buffer;
      try {
        content = await deps.readOriginal(original.slice('/uploads/'.length));
      } catch {
        return null;
      }
      try {
        return (await write(fileName, content)) ? { file: path } : { fallback: original };
      } catch (err) {
        warn('A photo’s face copy could not be written', { err });
        return { fallback: original };
      }
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

/** GET /uploads/faces/:file — public like every upload; registered before the uploads folder is served. */
export async function registerAvatarFaceRoute(app: FastifyInstance, faces: AvatarFaces): Promise<void> {
  app.get('/uploads/faces/:file', async (req, reply) => {
    const { file } = req.params as { file: string };
    const found = await faces.find(file);
    if (!found) return reply.code(404).header('Cache-Control', 'no-store').send({ error: { code: 'NOT_FOUND', message: 'Not found.' } });
    if ('fallback' in found) return reply.code(302).header('Cache-Control', 'no-store').header('Location', found.fallback).send();
    const headers = uploadResponseHeaders(found.file);
    for (const [name, value] of Object.entries(headers)) reply.header(name, value);
    return reply.header('Cache-Control', FACE_CACHE_CONTROL).type('image/webp').send(await readFile(found.file));
  });
}
