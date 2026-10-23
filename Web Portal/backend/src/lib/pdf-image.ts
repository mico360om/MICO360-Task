import { crc32, deflateSync, inflateSync } from 'node:zlib';

/** The biggest see-through picture flattened here (in pixels): bigger ones need the picture library. */
const MAX_FLATTEN_PIXELS = 2048 * 2048;

/**
 * Whether pdfkit can embed this picture exactly as stored, without unpacking it: a JPEG, or an
 * opaque, non-interlaced PNG. (pdfkit unpacks an interlaced or see-through PNG later, asynchronously,
 * so a document built in one go — PdfDocument.build — would come out broken.) Reads the header only.
 */
export function printableAsStored(buf: Buffer): boolean {
  if (isJpeg(buf)) return true;
  const png = readPng(buf, false);
  return png !== null && (png.colorType === 0 || png.colorType === 2 || png.colorType === 3) && !png.transparent && png.interlace === 0;
}

/**
 * A picture ready for pdfkit, or null when it can't be printed.
 *
 * A picture printable as stored (printableAsStored) is returned as it is. A see-through PNG is
 * flattened here onto white — only what the app's own picture cropper makes: 8-bit, non-interlaced,
 * at most 2048 × 2048 pixels, and never unpacked past the size it says it is, so a crafted file
 * can't fill the server's memory. Anything else (WebP, an interlaced PNG…) returns null, and the
 * caller draws something else instead (a project's initials tile) or has the picture library
 * convert it first.
 */
export function printableImage(buf: Buffer): Buffer | null {
  if (printableAsStored(buf)) return buf;
  const png = readPng(buf, true);
  if (!png) return null;
  const { width, height, bitDepth, colorType, interlace, idat } = png;
  if ((colorType !== 6 && colorType !== 4) || bitDepth !== 8 || interlace !== 0) return null;
  if (width < 1 || height < 1 || width * height > MAX_FLATTEN_PIXELS) return null;

  const channels = colorType === 6 ? 4 : 2;
  let raw: Buffer;
  try {
    // Exactly what the rows need (a filter byte each): more stops the unpacking with an error.
    raw = inflateSync(idat, { maxOutputLength: height * (1 + width * channels) });
  } catch {
    return null;
  }
  const pixels = unfilter(raw, width, height, channels);
  if (!pixels) return null;

  // Composite each pixel onto white and keep RGB.
  const out = Buffer.alloc(height * (1 + width * 3));
  for (let y = 0; y < height; y++) {
    const row = y * (1 + width * 3); // filter byte 0 (none) leads each row
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * channels;
      const a = pixels[i + channels - 1]!;
      const over = (c: number) => Math.round((c * a + 255 * (255 - a)) / 255);
      const r = pixels[i]!;
      const g = channels === 4 ? pixels[i + 1]! : r;
      const b = channels === 4 ? pixels[i + 2]! : r;
      out[row + 1 + x * 3] = over(r);
      out[row + 2 + x * 3] = over(g);
      out[row + 3 + x * 3] = over(b);
    }
  }
  return writePng(width, height, out);
}

/**
 * A project's uploaded picture for a PDF badge (the minutes and task PDFs): read from storage and,
 * when the PDF can't take it as stored (WebP, GIF, see-through or interlaced PNGs), converted by the
 * picture library — or, without one, flattened here when it can be. Null when there is none, it
 * can't be read or nothing can print it, so the caller draws the project's icon or initials instead.
 */
export async function readProjectPicture(
  imageUrl: string | null | undefined,
  read: ((imageUrl: string) => Promise<Buffer | null>) | undefined,
  convert?: (raw: Buffer) => Promise<Buffer | null>,
): Promise<Buffer | null> {
  if (!imageUrl || !read) return null;
  const stored = await read(imageUrl).catch(() => null);
  if (!stored) return null;
  if (printableAsStored(stored)) return stored;
  if (convert) return convert(stored).catch(() => null);
  return printableImage(stored);
}

interface PngInfo {
  width: number;
  height: number;
  bitDepth: number;
  colorType: number;
  interlace: number;
  /** Has a tRNS chunk (transparency without an alpha channel). */
  transparent: boolean;
  idat: Buffer;
}

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const isJpeg = (buf: Buffer) => buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;

/** A PNG's header and whether it has transparency; with `withData`, its picture data joined up too. */
function readPng(buf: Buffer, withData: boolean): PngInfo | null {
  if (buf.length < 33 || !buf.subarray(0, 8).equals(SIGNATURE)) return null;
  let p = 8;
  let info: Omit<PngInfo, 'idat' | 'transparent'> | null = null;
  let transparent = false;
  let hasData = false;
  const idat: Buffer[] = [];
  while (p + 8 <= buf.length) {
    const len = buf.readUInt32BE(p);
    const type = buf.toString('latin1', p + 4, p + 8);
    const data = buf.subarray(p + 8, p + 8 + len);
    if (data.length !== len) return null;
    if (type === 'IHDR' && len >= 13) {
      info = { width: data.readUInt32BE(0), height: data.readUInt32BE(4), bitDepth: data[8]!, colorType: data[9]!, interlace: data[12]! };
    } else if (type === 'tRNS') transparent = true;
    else if (type === 'IDAT') {
      hasData = true;
      if (!withData) break; // the header and any tRNS come before the picture data
      idat.push(data);
    } else if (type === 'IEND') break;
    p += 12 + len;
  }
  return info && hasData ? { ...info, transparent, idat: Buffer.concat(idat) } : null;
}

/** Undo the PNG row filters (none, sub, up, average, Paeth) of 8-bit samples. */
function unfilter(raw: Buffer, width: number, height: number, bpp: number): Buffer | null {
  const stride = width * bpp;
  if (raw.length < height * (stride + 1)) return null;
  const out = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!;
    const src = y * (stride + 1) + 1;
    const dst = y * stride;
    for (let x = 0; x < stride; x++) {
      const v = raw[src + x]!;
      const left = x >= bpp ? out[dst + x - bpp]! : 0;
      const up = y > 0 ? out[dst - stride + x]! : 0;
      const upLeft = y > 0 && x >= bpp ? out[dst - stride + x - bpp]! : 0;
      let pred: number;
      switch (filter) {
        case 0: pred = 0; break;
        case 1: pred = left; break;
        case 2: pred = up; break;
        case 3: pred = (left + up) >> 1; break;
        case 4: {
          const pa = Math.abs(up - upLeft);
          const pb = Math.abs(left - upLeft);
          const pc = Math.abs(left + up - 2 * upLeft);
          pred = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
          break;
        }
        default: return null;
      }
      out[dst + x] = (v + pred) & 0xff;
    }
  }
  return out;
}

/** An 8-bit RGB PNG from rows that already carry their filter byte. */
function writePng(width: number, height: number, rows: Buffer): Buffer {
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
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  return Buffer.concat([SIGNATURE, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}
