import { describe, it, expect } from 'vitest';
import { OCR_MAX_BYTES, ocrPictures } from './file-text-service';

const MB = 1024 * 1024;

// Security review (1.23): the 8 MB cap held only for a picture file — a scanned PDF's page pictures had
// none, and a page drawn several times was sent several times (up to ~67 MB to the paid AI provider in
// one request). The pictures sent are now each sent once, at most five, at most 8 MB together.
describe('ocrPictures — what one OCR request may send', () => {
  it('a picture file: itself while it is at most 8 MB, else nothing', () => {
    const photo = Buffer.alloc(2 * MB, 1);
    expect(ocrPictures({ picture: { data: photo, mimeType: 'image/png' } })).toEqual([{ data: photo, mimeType: 'image/png' }]);
    expect(ocrPictures({ picture: { data: Buffer.alloc(OCR_MAX_BYTES + 1), mimeType: 'image/png' } })).toEqual([]);
  });

  it('a scanned PDF’s pages: each picture once, in page order, at most five and 8 MB together', () => {
    const a = Buffer.alloc(3 * MB, 1);
    const b = Buffer.alloc(3 * MB, 2);
    const c = Buffer.alloc(3 * MB, 3); // would pass 8 MB: left out
    const d = Buffer.alloc(1 * MB, 4); // still fits
    const sent = ocrPictures({ pages: [a, Buffer.from(a), b, c, d, a] });
    expect(sent.map((p) => p.data[0])).toEqual([1, 2, 4]);
    expect(sent.every((p) => p.mimeType === 'image/jpeg')).toBe(true);
    expect(sent.reduce((n, p) => n + p.data.length, 0)).toBeLessThanOrEqual(OCR_MAX_BYTES);
    const small = Array.from({ length: 9 }, (_, i) => Buffer.alloc(10, i + 1));
    expect(ocrPictures({ pages: small })).toHaveLength(5);
  });
});
