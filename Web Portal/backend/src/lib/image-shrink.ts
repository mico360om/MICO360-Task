import type SharpType from 'sharp';

/** Pictures are made at most this many pixels on their long side. */
export const SHRINK_MAX_SIDE = 1920;

/** Pictures bigger than this (in pixels) are kept as they are rather than unpacked into memory. */
const MAX_INPUT_PIXELS = 100_000_000;

/** The picture types that can be made smaller safely; GIFs are left alone so they keep moving. */
const SHRINKABLE = new Set(['image/jpeg', 'image/png', 'image/webp']);

type Sharp = typeof SharpType;

export interface ImageShrinkerOptions {
  /** Where the picture library comes from (tests stand in for it). */
  load?: () => Promise<Sharp>;
  warn?: (message: string, meta?: Record<string, unknown>) => void;
}

export interface ImageShrinker {
  /** The picture made smaller; the same bytes when it isn't a picture, can't be, or wouldn't get smaller. */
  shrink(content: Buffer, mimeType: string): Promise<Buffer>;
  /** Whether pictures can be made smaller on this server (loads the library the first time). */
  check(): Promise<boolean>;
  /** What the last check found: null before anything has asked. */
  status(): boolean | null;
  /**
   * Any picture (WebP, GIF, any PNG…) as a small opaque PNG on white that a PDF can embed as it is
   * (a project's logo in the minutes); null when it can't be read or the library can't load.
   */
  toPrintable(content: Buffer): Promise<Buffer | null>;
  /**
   * Any picture as a small upright JPEG on white (at most 600 pixels on its long side), which a PDF
   * embeds as it is and keeps small (a task's attached photos); null when it can't be read or the
   * library can't load.
   */
  toThumbnail(content: Buffer): Promise<Buffer | null>;
}

/** A logo in a document is printed small: this many pixels on its long side is plenty. */
const PRINTABLE_MAX_SIDE = 512;

/** A photo printed a third of a page wide: this many pixels on its long side keeps it sharp. */
const THUMBNAIL_MAX_SIDE = 600;

/** A picture for a document that takes longer than this to prepare is given up (a crafted file can't keep the server busy). */
const DOCUMENT_PICTURE_SECONDS = 10;

/** An animated PNG says so in an acTL chunk before its first image data. */
export function isAnimatedPng(content: Buffer): boolean {
  let at = 8;
  while (at + 8 <= content.length) {
    const type = content.toString('ascii', at + 4, at + 8);
    if (type === 'acTL') return true;
    if (type === 'IDAT') return false;
    at += 12 + content.readUInt32BE(at);
  }
  return false;
}

async function loadSharp(): Promise<Sharp> {
  const { default: sharp } = await import('sharp');
  // A small shared server: one picture at a time, and nothing kept in memory afterwards.
  sharp.concurrency(1);
  sharp.cache(false);
  return sharp;
}

/**
 * Makes attached pictures smaller to save storage: JPEG, PNG and WebP pictures are turned upright,
 * limited to 1920 pixels on the long side, saved again in the same format without their hidden
 * details (camera, GPS location) and kept only when that made them smaller. Anything it can't do
 * — a damaged file, or a server where the library won't load — leaves the file exactly as it was.
 */
export function createImageShrinker({ load = loadSharp, warn = () => {} }: ImageShrinkerOptions = {}): ImageShrinker {
  let loading: Promise<Sharp | null> | null = null;
  let available: boolean | null = null;

  function library(): Promise<Sharp | null> {
    loading ??= load().then(
      (sharp) => {
        available = true;
        return sharp;
      },
      (err: unknown) => {
        available = false;
        warn('Attached pictures are stored at full size: the picture library could not load', { err });
        return null;
      },
    );
    return loading;
  }

  async function shrink(content: Buffer, mimeType: string): Promise<Buffer> {
    if (!SHRINKABLE.has(mimeType)) return content;
    if (mimeType === 'image/png' && isAnimatedPng(content)) return content;
    const sharp = await library();
    if (!sharp) return content;
    try {
      const input = { limitInputPixels: MAX_INPUT_PIXELS, sequentialRead: true };
      if (mimeType === 'image/webp' && ((await sharp(content, input).metadata()).pages ?? 1) > 1) return content;
      const image = sharp(content, input)
        .rotate()
        .resize({ width: SHRINK_MAX_SIDE, height: SHRINK_MAX_SIDE, fit: 'inside', withoutEnlargement: true });
      const out = await (mimeType === 'image/jpeg'
        ? image.jpeg({ quality: 80, mozjpeg: true })
        : mimeType === 'image/png'
          ? image.png({ compressionLevel: 9, adaptiveFiltering: true })
          : image.webp({ quality: 80 })
      ).toBuffer();
      return out.length < content.length ? out : content;
    } catch (err) {
      warn('An attached picture is stored at full size: it could not be read', { err, mimeType, bytes: content.length });
      return content;
    }
  }

  async function toPrintable(content: Buffer): Promise<Buffer | null> {
    const sharp = await library();
    if (!sharp) return null;
    try {
      return await sharp(content, { limitInputPixels: MAX_INPUT_PIXELS })
        .rotate()
        .resize({ width: PRINTABLE_MAX_SIDE, height: PRINTABLE_MAX_SIDE, fit: 'inside', withoutEnlargement: true })
        .flatten({ background: '#ffffff' })
        .toColourspace('srgb')
        .png()
        .timeout({ seconds: DOCUMENT_PICTURE_SECONDS })
        .toBuffer();
    } catch (err) {
      warn('A picture could not be prepared for a document', { err, bytes: content.length });
      return null;
    }
  }

  async function toThumbnail(content: Buffer): Promise<Buffer | null> {
    const sharp = await library();
    if (!sharp) return null;
    try {
      return await sharp(content, { limitInputPixels: MAX_INPUT_PIXELS })
        .rotate()
        .resize({ width: THUMBNAIL_MAX_SIDE, height: THUMBNAIL_MAX_SIDE, fit: 'inside', withoutEnlargement: true })
        .flatten({ background: '#ffffff' })
        .toColourspace('srgb')
        .jpeg({ quality: 80, mozjpeg: true })
        .timeout({ seconds: DOCUMENT_PICTURE_SECONDS })
        .toBuffer();
    } catch (err) {
      warn('A picture could not be prepared for a document', { err, bytes: content.length });
      return null;
    }
  }

  return {
    shrink,
    check: async () => (await library()) !== null,
    status: () => available,
    toPrintable,
    toThumbnail,
  };
}
