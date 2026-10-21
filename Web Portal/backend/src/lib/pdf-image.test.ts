import { describe, it, expect, beforeAll, vi } from 'vitest';
import { crc32, deflateSync, inflateSync } from 'node:zlib';
import { printableImage, readProjectPicture } from './pdf-image';
import { blankPng } from './test-images';

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

  it('returns nothing for an interlaced PNG of any colour type: pdfkit would unpack it after the PDF is written, and break it', () => {
    const pixel: Record<number, number[]> = { 0: [0], 2: [0, 0, 0], 3: [0], 4: [0, 255], 6: [0, 0, 0, 255] };
    for (const colorType of [0, 2, 3, 4, 6]) {
      expect(printableImage(png(1, 1, colorType, pixel[colorType]!, { interlace: 1 })), `colour type ${colorType}`).toBeNull();
    }
  });

  it('returns nothing for what it can’t print (WebP, 16-bit or interlaced PNG, not an image)', () => {
    expect(printableImage(Buffer.from('RIFF\u0000\u0000\u0000\u0000WEBPVP8 ', 'latin1'))).toBeNull();
    expect(printableImage(png(1, 1, 6, [0, 0, 0, 0, 0, 0, 0, 0], { bitDepth: 16 }))).toBeNull();
    expect(printableImage(png(1, 1, 6, [0, 0, 0, 0], { interlace: 1 }))).toBeNull();
    expect(printableImage(Buffer.from('hello'))).toBeNull();
    expect(printableImage(Buffer.alloc(0))).toBeNull();
  });
});

describe('printableImage: a crafted picture can’t freeze or crash the server', () => {
  // 64 × 64 pixels need 16 KB; this one's data unpacks to 256 MB (and its checksum is wrong, so
  // the picture library turns it down and the upload stores it as it was).
  let bomb: Buffer;
  beforeAll(async () => {
    bomb = await blankPng(64, 64, { unpacked: 256 * 1024 * 1024, brokenChecksum: true });
  }, 30_000);

  it('turns down a picture whose data unpacks to far more than its size needs, at once, without unpacking it', () => {
    const started = performance.now();
    const out = printableImage(bomb);
    const ms = performance.now() - started;
    expect(out, `${bomb.length} bytes in, ${out?.length ?? 0} out`).toBeNull();
    expect(ms).toBeLessThan(500);
  });

  it('turns down a see-through picture bigger than 2048 × 2048 pixels without unpacking it', async () => {
    const big = await blankPng(4096, 4096); // a valid 64 KB file that unpacks to 64 MB
    const started = performance.now();
    const out = printableImage(big);
    const ms = performance.now() - started;
    expect(out === null, `returned ${out?.length ?? 0} bytes after ${Math.round(ms)} ms`).toBe(true);
    expect(ms).toBeLessThan(500);
  }, 30_000);

  it('sends a project picture the PDF can’t print as stored straight to the converter, without unpacking it here', async () => {
    const convert = vi.fn(async () => null);
    const started = performance.now();
    const out = await readProjectPicture('/uploads/projects/p.png', async () => bomb, convert);
    const ms = performance.now() - started;
    expect(out === null, `returned ${out?.length ?? 0} bytes`).toBe(true);
    expect(convert).toHaveBeenCalledTimes(1);
    expect(ms).toBeLessThan(500);
  });
});

describe('readProjectPicture', () => {
  const read = (buf: Buffer) => async () => buf;
  const opaque = () => png(2, 2, 2, [10, 20, 30]);
  const seeThrough = () => png(2, 2, 6, [200, 0, 0, 128]);

  it('keeps a JPEG or an opaque PNG as stored, without converting it', async () => {
    const convert = vi.fn(async () => Buffer.from('converted'));
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46]);
    const rgb = opaque();
    expect(await readProjectPicture('/uploads/a.jpg', read(jpeg), convert)).toBe(jpeg);
    expect(await readProjectPicture('/uploads/b.png', read(rgb), convert)).toBe(rgb);
    expect(convert).not.toHaveBeenCalled();
  });

  it('converts anything else when it can, else flattens a see-through PNG itself', async () => {
    const converted = Buffer.from('converted');
    expect(await readProjectPicture('/uploads/c.png', read(seeThrough()), async () => converted)).toBe(converted);
    const flat = (await readProjectPicture('/uploads/c.png', read(seeThrough())))!;
    expect(flat[25]).toBe(2); // an opaque RGB PNG, ready to print
    expect(printableImage(flat)).toBe(flat);
  });

  it('has nothing when there is no picture, it can’t be read, or nothing can print it', async () => {
    expect(await readProjectPicture(null, read(opaque()))).toBeNull();
    expect(await readProjectPicture('/uploads/gone.png', async () => { throw new Error('ENOENT'); })).toBeNull();
    expect(await readProjectPicture('/uploads/x.webp', read(Buffer.from('RIFF....WEBPVP8 ')))).toBeNull();
    expect(await readProjectPicture('/uploads/x.webp', read(Buffer.from('RIFF....WEBPVP8 ')), async () => { throw new Error('libvips'); })).toBeNull();
  });
});
