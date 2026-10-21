import { crc32 } from 'node:zlib';
import sharp from 'sharp';
import { describe, expect, it, vi } from 'vitest';
import { createImageShrinker, SHRINK_MAX_SIDE } from './image-shrink';
import { jpegHeader } from './test-images';
import { printableImage } from './pdf-image';

/** A smooth picture with a little grain, like a photo: it compresses the way real ones do. */
function photo(width: number, height: number) {
  const px = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 3;
      const grain = ((x * 7919 + y * 104729) % 23) - 11;
      px[i] = Math.max(0, Math.min(255, Math.round((x / width) * 255) + grain));
      px[i + 1] = Math.max(0, Math.min(255, Math.round((y / height) * 255) + grain));
      px[i + 2] = 128 + grain;
    }
  }
  return sharp(px, { raw: { width, height, channels: 3 } });
}

/** A PNG chunk with its length and checksum. */
function chunk(type: string, data: Buffer) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])) >>> 0, 0);
  return Buffer.concat([head, data, crc]);
}

const quiet = () => ({ warn: vi.fn() });

/** The very same bytes came back (compared without printing megabytes of them on a failure). */
function expectKept(out: Buffer, original: Buffer) {
  expect(out === original, `kept as it was (${original.length} bytes in, ${out.length} out)`).toBe(true);
}

describe('createImageShrinker', () => {
  it('makes a big photo at most 1920 pixels on its long side, and smaller', async () => {
    const original = await photo(3000, 2000).jpeg({ quality: 95 }).toBuffer();
    const out = await createImageShrinker(quiet()).shrink(original, 'image/jpeg');
    const meta = await sharp(out).metadata();
    expect(SHRINK_MAX_SIDE).toBe(1920);
    expect(meta.format).toBe('jpeg');
    expect([meta.width, meta.height]).toEqual([1920, 1280]);
    expect(out.length).toBeLessThan(original.length);
  });

  it('limits a tall picture by its height, and keeps WebP as WebP', async () => {
    const original = await photo(1000, 2600).webp({ quality: 95 }).toBuffer();
    const out = await createImageShrinker(quiet()).shrink(original, 'image/webp');
    const meta = await sharp(out).metadata();
    expect(meta.format).toBe('webp');
    expect(meta.height).toBe(1920);
    expect(meta.width).toBe(738);
    expect(out.length).toBeLessThan(original.length);
  });

  it('shrinks a big PNG screenshot and keeps it a PNG', async () => {
    const original = await photo(2600, 1600).png({ compressionLevel: 0 }).toBuffer();
    const out = await createImageShrinker(quiet()).shrink(original, 'image/png');
    const meta = await sharp(out).metadata();
    expect(meta.format).toBe('png');
    expect(meta.width).toBe(1920);
    expect(out.length).toBeLessThan(original.length);
  });

  it('turns the picture upright and removes its hidden details, such as the GPS location', async () => {
    const original = await photo(400, 300)
      .withExif({ IFD0: { Make: 'PhoneMaker' }, IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '23/1 35/1 0/1', GPSMapDatum: 'WGS-84' } })
      .withMetadata({ orientation: 6 })
      .jpeg({ quality: 100 })
      .toBuffer();
    const before = await sharp(original).metadata();
    expect(before.orientation).toBe(6);
    expect(before.exif?.toString('latin1')).toContain('WGS-84');
    expect(before.exif?.toString('latin1')).toContain('PhoneMaker');

    const out = await createImageShrinker(quiet()).shrink(original, 'image/jpeg');
    const meta = await sharp(out).metadata();
    expect([meta.width, meta.height]).toEqual([300, 400]);
    expect(meta.exif).toBeUndefined();
    expect(meta.orientation).toBeUndefined();
  });

  it('keeps a picture exactly as it was when saving it again would not make it smaller', async () => {
    // Grainy and already squeezed hard: saving it again at the normal quality would only grow it.
    let seed = 1;
    const grain = Buffer.alloc(320 * 240 * 3).map(() => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) >> 23);
    const original = await sharp(grain, { raw: { width: 320, height: 240, channels: 3 } }).jpeg({ quality: 20 }).toBuffer();
    const out = await createImageShrinker(quiet()).shrink(original, 'image/jpeg');
    expectKept(out, original);
  });

  it('leaves files that are not pictures alone, without loading the picture library', async () => {
    const load = vi.fn(async () => sharp);
    const shrinker = createImageShrinker({ ...quiet(), load });
    const pdf = Buffer.from('%PDF-1.7\n%âãÏÓ\n1 0 obj<<>>endobj\n');
    expectKept(await shrinker.shrink(pdf, 'application/pdf'), pdf);
    expect(load).not.toHaveBeenCalled();
  });

  it('keeps GIFs and animated WebP pictures as they are, so they keep moving', async () => {
    const frame = (r: number) => photo(2400, 1600).linear(1, r).png({ compressionLevel: 0 }).toBuffer();
    const animated = await sharp([await frame(0), await frame(40)], { join: { animated: true } }).webp({ quality: 100 }).toBuffer();
    const shrinker = createImageShrinker(quiet());
    expectKept(await shrinker.shrink(animated, 'image/webp'), animated);

    const gif = await sharp({ create: { width: 2400, height: 1600, channels: 3, background: '#d33' } }).gif().toBuffer();
    expectKept(await shrinker.shrink(gif, 'image/gif'), gif);
  });

  it('keeps an animated PNG as it is, so it keeps moving', async () => {
    const still = await photo(2400, 1600).png({ compressionLevel: 0 }).toBuffer();
    const actl = Buffer.alloc(8);
    actl.writeUInt32BE(2, 0); // two frames
    actl.writeUInt32BE(0, 4); // loop forever
    const ihdrEnd = 8 + 25; // signature, then the 13-byte IHDR chunk with its length, type and checksum
    const animated = Buffer.concat([still.subarray(0, ihdrEnd), chunk('acTL', actl), still.subarray(ihdrEnd)]);
    expectKept(await createImageShrinker(quiet()).shrink(animated, 'image/png'), animated);
  });

  it('keeps a damaged picture as it was, and says why', async () => {
    const log = quiet();
    const damaged = Buffer.concat([jpegHeader(4000, 3000), Buffer.alloc(64, 7)]);
    expectKept(await createImageShrinker(log).shrink(damaged, 'image/jpeg'), damaged);
    expect(log.warn).toHaveBeenCalledTimes(1);
  });

  it('keeps pictures as they are when the picture library can’t load, and says so once', async () => {
    const log = quiet();
    const shrinker = createImageShrinker({ ...log, load: async () => { throw new Error('missing libvips'); } });
    const original = await photo(3000, 2000).jpeg({ quality: 95 }).toBuffer();
    expect(shrinker.status()).toBeNull();
    expectKept(await shrinker.shrink(original, 'image/jpeg'), original);
    expectKept(await shrinker.shrink(original, 'image/jpeg'), original);
    expect(await shrinker.check()).toBe(false);
    expect(shrinker.status()).toBe(false);
    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(log.warn.mock.calls[0]![0]).toMatch(/picture/i);
  });

  it('reports that pictures are made smaller once the library has loaded', async () => {
    const shrinker = createImageShrinker(quiet());
    expect(shrinker.status()).toBeNull();
    expect(await shrinker.check()).toBe(true);
    expect(shrinker.status()).toBe(true);
  });
});

describe('toPrintable (a picture for a PDF)', () => {
  const logo = () => sharp({ create: { width: 900, height: 600, channels: 4, background: { r: 30, g: 90, b: 139, alpha: 0.6 } } });

  it('turns WebP, GIF, 16-bit and see-through palette PNG pictures into one a PDF can print', async () => {
    const shrinker = createImageShrinker(quiet());
    const inputs = {
      webp: await logo().webp().toBuffer(),
      gif: await logo().gif().toBuffer(),
      png16: await logo().png().toColourspace('rgb16').toBuffer(),
      palette: await logo().png({ palette: true }).toBuffer(),
    };
    for (const [kind, input] of Object.entries(inputs)) {
      expect(printableImage(input), `${kind} can't be printed as it is`).toBeNull();
      const out = await shrinker.toPrintable(input);
      expect(out && printableImage(out), `${kind} printable after`).not.toBeNull();
      const meta = await sharp(out!).metadata();
      expect(Math.max(meta.width!, meta.height!), kind).toBeLessThanOrEqual(512);
      expect(meta.hasAlpha, kind).toBe(false); // on white, so it prints in one go
    }
  });

  it('returns nothing for a file that isn’t a picture', async () => {
    expect(await createImageShrinker(quiet()).toPrintable(Buffer.from('not a picture'))).toBeNull();
  });

  it('returns nothing when the picture library can’t load', async () => {
    const shrinker = createImageShrinker({ ...quiet(), load: async () => { throw new Error('missing libvips'); } });
    expect(await shrinker.toPrintable(await logo().webp().toBuffer())).toBeNull();
  });
});

describe('toThumbnail (a small picture for a document, such as a task’s attached photos)', () => {
  it('makes any picture a small, upright JPEG on white that a PDF can print as it is', async () => {
    const shrinker = createImageShrinker(quiet());
    const big = await photo(3000, 2000).jpeg({ quality: 95 }).toBuffer();
    const out = (await shrinker.toThumbnail(big))!;
    const meta = await sharp(out).metadata();
    expect(meta.format).toBe('jpeg');
    expect([meta.width, meta.height]).toEqual([600, 400]);
    expect(out.length).toBeLessThan(big.length / 10);
    expect(printableImage(out)).toBe(out);
    // WebP, GIF and see-through PNG pictures too.
    const seeThrough = sharp({ create: { width: 300, height: 200, channels: 4, background: { r: 30, g: 90, b: 139, alpha: 0.4 } } });
    for (const input of [await seeThrough.clone().webp().toBuffer(), await seeThrough.clone().gif().toBuffer(), await seeThrough.clone().png().toBuffer()]) {
      const t = await sharp((await shrinker.toThumbnail(input))!).metadata();
      expect([t.format, t.width, t.height, t.hasAlpha]).toEqual(['jpeg', 300, 200, false]);
    }
  });

  it('returns nothing for a file that isn’t a picture, or when the picture library can’t load', async () => {
    expect(await createImageShrinker(quiet()).toThumbnail(Buffer.from('not a picture'))).toBeNull();
    const broken = createImageShrinker({ ...quiet(), load: async () => { throw new Error('missing libvips'); } });
    expect(await broken.toThumbnail(await photo(40, 30).jpeg().toBuffer())).toBeNull();
  });
});
