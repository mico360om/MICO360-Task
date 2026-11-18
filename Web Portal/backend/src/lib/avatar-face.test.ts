import { describe, it, expect } from 'vitest';
import { FACE_SIDE, faceUrlOf, originalUrlOfFace } from './avatar-face';

// Avatar thumbnails (coordinator, 11 Nov): a face shows a small copy of the photo, made once and kept by
// the browser; its address comes from the photo's own, so a new photo is a new address.
const KEY = '0b2f6c1e-1d2a-4c3b-9e8f-7a6b5c4d3e2f.png';

describe('a photo’s face copy address', () => {
  it('is the photo’s key under /uploads/faces/, as WebP', () => {
    expect(faceUrlOf(`/uploads/${KEY}`)).toBe(`/uploads/faces/${KEY}.webp`);
    expect(faceUrlOf('/uploads/0b2f6c1e-1d2a-4c3b-9e8f-7a6b5c4d3e2f.jpg')).toBe('/uploads/faces/0b2f6c1e-1d2a-4c3b-9e8f-7a6b5c4d3e2f.jpg.webp');
  });

  it('none for no photo, a photo elsewhere, or anything not one of our stored pictures', () => {
    for (const url of [null, undefined, '', 'https://example.com/a.png', '/uploads/../secret.png', '/uploads/faces/x.png.webp', `/uploads/${KEY}?x=1`, '/uploads/report.pdf', `/uploads/sub/${KEY}`]) {
      expect(faceUrlOf(url), String(url)).toBeNull();
    }
  });

  it('goes back to the photo from a face file name — only a well-formed one', () => {
    expect(originalUrlOfFace(`${KEY}.webp`)).toBe(`/uploads/${KEY}`);
    for (const name of ['x.webp', `${KEY}`, `../${KEY}.webp`, `${KEY}.webp.webp`, '0b2f6c1e-1d2a-4c3b-9e8f-7a6b5c4d3e2f.pdf.webp']) {
      expect(originalUrlOfFace(name), name).toBeNull();
    }
  });

  it('is 256 pixels square: sharp on a 2× screen for the biggest face (128 px)', () => {
    expect(FACE_SIDE).toBe(256);
  });
});

// 1.23.39 Upload folders: a photo kept at shared/<YYYY>/<MM>/<person>/profile-photos/<uuid>.<ext> gets its
// face copy at the same folders under /uploads/faces/.
describe('a photo in the upload folders', () => {
  const NESTED = `shared/2026/11/ckuser1/profile-photos/${KEY}`;
  it('mirrors the photo’s folders under /uploads/faces/, and goes back', () => {
    expect(faceUrlOf(`/uploads/${NESTED}`)).toBe(`/uploads/faces/${NESTED}.webp`);
    expect(originalUrlOfFace(`${NESTED}.webp`)).toBe(`/uploads/${NESTED}`);
  });

  it('only a profile photo’s folders, and nothing that climbs out', () => {
    for (const url of [`/uploads/ckco1/2026/11/ckuser1/task-files/${KEY}`, `/uploads/shared/2026/11/ckuser1/profile-photos/../${KEY}`, `/uploads/shared/2026/11/ckuser1/profile-photos/${KEY.replace('.png', '.pdf')}`]) {
      expect(faceUrlOf(url), url).toBeNull();
    }
    for (const name of [`shared/2026/11/ckuser1/task-files/${KEY}.webp`, `shared/2026/11/ckuser1/profile-photos/../../${KEY}.webp`, `shared\\2026\\11\\u\\profile-photos\\${KEY}.webp`]) {
      expect(originalUrlOfFace(name), name).toBeNull();
    }
  });
});
