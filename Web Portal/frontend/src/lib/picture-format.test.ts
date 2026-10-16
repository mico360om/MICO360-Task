import { describe, it, expect } from 'vitest';
import { pictureFormat } from './picture-format';

const pixels = (...alphas: number[]) => new Uint8ClampedArray(alphas.flatMap((a) => [10, 20, 30, a]));

describe('pictureFormat', () => {
  it('saves a fully opaque picture (a photo) as JPEG: small, and printable in the minutes PDF', () => {
    expect(pictureFormat(pixels(255, 255, 255))).toEqual({ type: 'image/jpeg', quality: 0.9 });
  });

  it('saves a picture with any transparency (a logo fitted in the square) as PNG, keeping it', () => {
    expect(pictureFormat(pixels(255, 254, 255))).toEqual({ type: 'image/png' });
    expect(pictureFormat(pixels(0))).toEqual({ type: 'image/png' });
  });

  it('chooses PNG when the pixels can’t be read', () => {
    expect(pictureFormat(null)).toEqual({ type: 'image/png' });
  });
});
