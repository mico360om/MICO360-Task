import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify from 'fastify';
import { createAvatarFaces, registerAvatarFaceRoute, FACE_CACHE_CONTROL, type AvatarFacesDeps } from './avatar-faces';

// Avatar thumbnails (coordinator, 11 Nov): faces load a ~256 px copy of the photo. It is written on
// upload; a photo from before gets it on its first request. Only a person's current photo ever gets a
// face (no new way to read any other upload); when the copy can't be made, the face is the photo itself.
const KEY = '0b2f6c1e-1d2a-4c3b-9e8f-7a6b5c4d3e2f.png';
const FACE = `${KEY}.webp`;
let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'faces-'));
  writeFileSync(join(dir, KEY), 'original'); // the stored photo
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function make(over: Partial<AvatarFacesDeps> = {}) {
  const deps = {
    dir,
    readOriginal: vi.fn(async (key: string) => {
      if (key !== KEY) throw new Error('gone');
      return Buffer.from('original');
    }),
    isAvatar: vi.fn(async (url: string) => url === `/uploads/${KEY}`),
    toFace: vi.fn(async (_content: Buffer): Promise<Buffer | null> => Buffer.from('face-webp')),
    ...over,
  };
  return { faces: createAvatarFaces(deps), deps };
}

describe('avatar faces', () => {
  it('on upload: writes the face copy beside the uploads, from the uploaded bytes', async () => {
    const { faces, deps } = make();
    await faces.prepare(`/uploads/${KEY}`, Buffer.from('uploaded'));
    expect(deps.toFace).toHaveBeenCalledWith(Buffer.from('uploaded'));
    expect(readFileSync(join(dir, 'faces', FACE)).toString()).toBe('face-webp');
  });

  it('on upload: never fails the upload — a copy that can’t be made is simply not written', async () => {
    const { faces } = make({ toFace: vi.fn(async () => null) });
    await expect(faces.prepare(`/uploads/${KEY}`, Buffer.from('x'))).resolves.toBeUndefined();
    const { faces: throwing } = make({ toFace: vi.fn(async () => { throw new Error('boom'); }) });
    await expect(throwing.prepare(`/uploads/${KEY}`, Buffer.from('x'))).resolves.toBeUndefined();
    expect(existsSync(join(dir, 'faces', FACE))).toBe(false);
    // Not one of our stored pictures: nothing to do.
    await expect(faces.prepare('https://example.com/a.png', Buffer.from('x'))).resolves.toBeUndefined();
  });

  it('a face already made is served from disk, without asking the database', async () => {
    const isAvatar = vi.fn(async () => true);
    const { faces } = make({ isAvatar });
    await faces.prepare(`/uploads/${KEY}`, Buffer.from('uploaded'));
    expect(await faces.find(FACE)).toEqual({ file: join(dir, 'faces', FACE) });
    expect(isAvatar).not.toHaveBeenCalled();
  });

  it('a photo from before gets its face on the first request, made once', async () => {
    const { faces, deps } = make();
    expect(await faces.find(FACE)).toEqual({ file: join(dir, 'faces', FACE) });
    expect(deps.readOriginal).toHaveBeenCalledWith(KEY);
    expect(readFileSync(join(dir, 'faces', FACE)).toString()).toBe('face-webp');
    await faces.find(FACE);
    expect(deps.toFace).toHaveBeenCalledTimes(1);
  });

  it('only a person’s current photo gets a face: any other upload, a bad name or a gone file is not found', async () => {
    const { faces, deps } = make({ isAvatar: vi.fn(async () => false) });
    expect(await faces.find(FACE)).toBeNull();
    expect(deps.readOriginal).not.toHaveBeenCalled();
    expect(await faces.find('../../etc/passwd.webp')).toBeNull();
    expect(deps.isAvatar).toHaveBeenCalledTimes(1);
    rmSync(join(dir, KEY));
    const gone = make();
    expect(await gone.faces.find(FACE)).toBeNull();
    expect(gone.deps.isAvatar).not.toHaveBeenCalled();
  });

  it('a made-up name with no stored photo behind it never reaches the database (the route has no rate limit)', async () => {
    const { faces, deps } = make();
    expect(await faces.find('11111111-2222-4333-8444-555555555555.png.webp')).toBeNull();
    expect(deps.isAvatar).not.toHaveBeenCalled();
    expect(deps.readOriginal).not.toHaveBeenCalled();
  });

  it('no picture library on this server: the photo itself at once — no database, no reading the photo', async () => {
    const { faces, deps } = make({ canMake: () => false });
    expect(await faces.find(FACE)).toEqual({ fallback: `/uploads/${KEY}` });
    expect(deps.isAvatar).not.toHaveBeenCalled();
    expect(deps.readOriginal).not.toHaveBeenCalled();
  });

  it('a photo whose copy failed is not tried again on every view', async () => {
    const { faces, deps } = make({ toFace: vi.fn(async () => null) });
    expect(await faces.find(FACE)).toEqual({ fallback: `/uploads/${KEY}` });
    expect(await faces.find(FACE)).toEqual({ fallback: `/uploads/${KEY}` });
    expect(deps.toFace).toHaveBeenCalledTimes(1);
    expect(deps.isAvatar).toHaveBeenCalledTimes(1);
    expect(deps.readOriginal).toHaveBeenCalledTimes(1);
  });

  it('many first requests at once make the copy once', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const toFace = vi.fn(async () => {
      await gate;
      return Buffer.from('face-webp');
    });
    const { faces, deps } = make({ toFace });
    const all = Promise.all(Array.from({ length: 6 }, () => faces.find(FACE)));
    await new Promise((r) => setTimeout(r, 20));
    release();
    expect(new Set((await all).map((a) => JSON.stringify(a)))).toEqual(new Set([JSON.stringify({ file: join(dir, 'faces', FACE) })]));
    expect(toFace).toHaveBeenCalledTimes(1);
    expect(deps.readOriginal).toHaveBeenCalledTimes(1);
  });

  it('a copy that can’t be put in place leaves no half-written file behind', async () => {
    mkdirSync(join(dir, 'faces', FACE), { recursive: true }); // something in the way: the move fails
    const { faces } = make();
    expect(await faces.find(FACE)).toEqual({ fallback: `/uploads/${KEY}` });
    expect(readdirSync(join(dir, 'faces')).filter((n) => n.endsWith('.part'))).toEqual([]);
  });

  it('when the copy can’t be made, the face is the photo itself', async () => {
    const { faces } = make({ toFace: vi.fn(async () => null) });
    expect(await faces.find(FACE)).toEqual({ fallback: `/uploads/${KEY}` });
    expect(existsSync(join(dir, 'faces', FACE))).toBe(false);
  });
});

describe('GET /uploads/faces/:file', () => {
  async function serve(over: Partial<AvatarFacesDeps> = {}) {
    const app = Fastify();
    const { faces } = make(over);
    await registerAvatarFaceRoute(app, faces);
    return app;
  }

  it('sends the face as WebP, kept by the browser for good (a new photo is a new address)', async () => {
    const app = await serve();
    const res = await app.inject({ method: 'GET', url: `/uploads/faces/${FACE}` });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('image/webp');
    expect(res.headers['cache-control']).toBe(FACE_CACHE_CONTROL);
    expect(FACE_CACHE_CONTROL).toBe('private, max-age=31536000, immutable');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toMatch(/sandbox/);
    expect(res.rawPayload.toString()).toBe('face-webp');
  });

  it('not a current photo, or a bad name: 404 and nothing else', async () => {
    const app = await serve({ isAvatar: vi.fn(async () => false) });
    for (const url of [`/uploads/faces/${FACE}`, '/uploads/faces/nope.webp', '/uploads/faces/%2e%2e%2fsecret.png.webp']) {
      const res = await app.inject({ method: 'GET', url });
      expect(res.statusCode, url).toBe(404);
      expect(res.headers['cache-control'], url).toBe('no-store');
    }
  });

  it('no copy possible: sends the browser to the photo itself (asked again after an hour)', async () => {
    const app = await serve({ toFace: vi.fn(async () => null) });
    const res = await app.inject({ method: 'GET', url: `/uploads/faces/${FACE}` });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe(`/uploads/${KEY}`);
    expect(res.headers['cache-control']).toBe('private, max-age=3600');
  });

  it('beside the uploads folder as the server serves it: the face route answers (GET and HEAD), the photo is still the folder’s', async () => {
    const app = Fastify();
    const { faces } = make();
    await registerAvatarFaceRoute(app, faces);
    const { default: fastifyStatic } = await import('@fastify/static');
    await app.register(fastifyStatic, { root: dir, prefix: '/uploads/' });
    const face = await app.inject({ method: 'GET', url: `/uploads/faces/${FACE}` });
    expect([face.statusCode, face.headers['content-type'], face.headers['cache-control']]).toEqual([200, 'image/webp', FACE_CACHE_CONTROL]);
    expect((await app.inject({ method: 'HEAD', url: `/uploads/faces/${FACE}` })).statusCode).toBe(200);
    const photo = await app.inject({ method: 'GET', url: `/uploads/${KEY}` });
    expect([photo.statusCode, photo.body]).toEqual([200, 'original']);
  });
});
