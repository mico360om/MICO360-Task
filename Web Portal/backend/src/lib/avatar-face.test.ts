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
