import { describe, it, expect } from 'vitest';
import { crc32, deflateSync, inflateSync } from 'node:zlib';
import { printableImage } from './pdf-image';

/** A PNG of `width`×`height` 8-bit pixels of `colorType` (2 RGB, 6 RGBA, 0 grey, 4 grey+alpha), filter 0 rows. */
function png(width: number, height: number, colorType: number, pixel: number[], opts: { bitDepth?: number; interlace?: number } = {}): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = opts.bitDepth ?? 8;
  ihdr[9] = colorType;
  ihdr[12] = opts.interlace ?? 0;
  const row = Buffer.from([0, ...Array.from({ length: width }, () => pixel).flat()]);
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

/** The colour type and the first pixel of a PNG this module wrote (RGB, filter-0 rows). */
function firstPixel(buf: Buffer): { colorType: number; rgb: number[] } {
  const colorType = buf[25]!;
  let p = 8;
  const idat: Buffer[] = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p);
    const type = buf.toString('latin1', p + 4, p + 8);
    if (type === 'IDAT') idat.push(buf.subarray(p + 8, p + 8 + len));
    p += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  return { colorType, rgb: [raw[1]!, raw[2]!, raw[3]!] };
}

describe('printableImage', () => {
  it('passes a JPEG through unchanged', () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46]);
    expect(printableImage(jpeg)).toBe(jpeg);
  });

  it('passes an opaque PNG through unchanged', () => {
    const rgb = png(2, 2, 2, [10, 20, 30]);
    expect(printableImage(rgb)).toBe(rgb);
  });

  it('flattens a transparent PNG onto white, so the PDF can be written in one go', () => {
    const out = printableImage(png(3, 2, 6, [200, 0, 0, 128]))!; // half-transparent red
    expect(out).not.toBeNull();
    const { colorType, rgb } = firstPixel(out);
    expect(colorType).toBe(2); // RGB, no alpha
    expect(rgb).toEqual([227, 127, 127]); // red over white: (200·128 + 255·127) / 255
    const clear = firstPixel(printableImage(png(1, 1, 6, [0, 0, 0, 0]))!);
    expect(clear.rgb).toEqual([255, 255, 255]);
  });

  it('flattens grey with transparency too', () => {
    expect(firstPixel(printableImage(png(1, 1, 4, [0, 255]))!).rgb).toEqual([0, 0, 0]);
  });

  it('returns nothing for what it can’t print (WebP, 16-bit or interlaced PNG, not an image)', () => {
    expect(printableImage(Buffer.from('RIFF\u0000\u0000\u0000\u0000WEBPVP8 ', 'latin1'))).toBeNull();
    expect(printableImage(png(1, 1, 6, [0, 0, 0, 0, 0, 0, 0, 0], { bitDepth: 16 }))).toBeNull();
    expect(printableImage(png(1, 1, 6, [0, 0, 0, 0], { interlace: 1 }))).toBeNull();
    expect(printableImage(Buffer.from('hello'))).toBeNull();
    expect(printableImage(Buffer.alloc(0))).toBeNull();
  });
});
