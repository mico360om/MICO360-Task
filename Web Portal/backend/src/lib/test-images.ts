/** Test fixtures: just the header bytes of PNG, JPEG and WebP files, with a chosen width and height. */
/** The first bytes of real image files, with the given size written where each format keeps it. */
export function pngHeader(width: number, height: number): Buffer {
  const b = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8);
  b.write('IHDR', 12, 'ascii');
  b.writeUInt32BE(width, 16);
  b.writeUInt32BE(height, 20);
  b.writeUInt8(8, 24);
  b.writeUInt8(6, 25);
  return b;
}

export function jpegHeader(width: number, height: number): Buffer {
  const app0 = Buffer.from([0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00]);
  const sof = Buffer.alloc(19);
  sof.writeUInt16BE(0xffc0, 0);
  sof.writeUInt16BE(17, 2);
  sof.writeUInt8(8, 4);
  sof.writeUInt16BE(height, 5);
  sof.writeUInt16BE(width, 7);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, sof]);
}

export function riff(chunk: string, body: Buffer): Buffer {
  const head = Buffer.alloc(20);
  head.write('RIFF', 0, 'ascii');
  head.writeUInt32LE(12 + body.length, 4);
  head.write('WEBP', 8, 'ascii');
  head.write(chunk, 12, 'ascii');
  head.writeUInt32LE(body.length, 16);
  return Buffer.concat([head, body]);
}

export function webpLossy(width: number, height: number): Buffer {
  const body = Buffer.alloc(10);
  Buffer.from([0x00, 0x00, 0x00, 0x9d, 0x01, 0x2a]).copy(body, 0); // frame tag, then the start code
  body.writeUInt16LE(width & 0x3fff, 6);
  body.writeUInt16LE(height & 0x3fff, 8);
  return riff('VP8 ', body);
}

export function webpLossless(width: number, height: number): Buffer {
  const body = Buffer.alloc(5);
  body.writeUInt8(0x2f, 0);
  const bits = ((width - 1) & 0x3fff) | (((height - 1) & 0x3fff) << 14);
  body.writeUInt32LE(bits >>> 0, 1);
  return riff('VP8L', body);
}

export function webpExtended(width: number, height: number): Buffer {
  const body = Buffer.alloc(10);
  body.writeUIntLE(width - 1, 4, 3);
  body.writeUIntLE(height - 1, 7, 3);
  return riff('VP8X', body);
}
