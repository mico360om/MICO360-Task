import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { faceUrlOf } from './person-photo';

// Avatar thumbnails (11 Nov): every face loads the photo's small copy; the address is the server's rule.
const KEY = '0b2f6c1e-1d2a-4c3b-9e8f-7a6b5c4d3e2f.png';

describe('a photo’s face copy address (the website’s copy of the server’s rule)', () => {
  it('our stored pictures: /uploads/faces/<key>.webp', () => {
    expect(faceUrlOf(`/uploads/${KEY}`)).toBe(`/uploads/faces/${KEY}.webp`);
  });

  it('anything else has none (the face shows the photo itself)', () => {
    for (const url of [null, undefined, '', 'https://example.com/a.png', '/uploads/avatars/km.png', '/uploads/../secret.png', `/uploads/faces/${KEY}.webp`, `/uploads/${KEY}?v=2`]) {
      expect(faceUrlOf(url), String(url)).toBeNull();
    }
  });

  it('is word for word the server’s (lib/avatar-face.ts)', () => {
    const server = readFileSync(resolve(__dirname, '../../../backend/src/lib/avatar-face.ts'), 'utf8');
    const web = readFileSync(resolve(__dirname, './person-photo.ts'), 'utf8');
    const part = (text: string) => {
      const key = /const PICTURE_KEY = .*;/.exec(text)?.[0];
      const fn = /export function faceUrlOf\([\s\S]*?\n}\n/.exec(text)?.[0];
      return `${key}\n${fn}`;
    };
    expect(part(web)).toBe(part(server));
    expect(part(web)).toContain('PICTURE_KEY');
  });
});
