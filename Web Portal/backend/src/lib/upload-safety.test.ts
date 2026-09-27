import { describe, it, expect } from 'vitest';
import { extensionForMime, uploadResponseHeaders } from './upload-safety';
import { sniffMime, SNIFFABLE } from './magic-mime';

describe('upload safety', () => {
  it('derives the stored extension from the validated MIME type, never the filename', () => {
    expect(extensionForMime('image/png')).toBe('.png');
    expect(extensionForMime('text/plain')).toBe('.txt');
    expect(extensionForMime('text/csv; charset=utf-8')).toBe('.csv');
    expect(extensionForMime('text/html')).toBe('.bin');
    expect(extensionForMime('image/svg+xml')).toBe('.bin');
  });

  it('serves raster images inline and everything else as a sandboxed download', () => {
    const img = uploadResponseHeaders('/data/uploads/abc.png');
    expect(img['Content-Disposition']).toBeUndefined();
    expect(img['X-Content-Type-Options']).toBe('nosniff');
    expect(img['Content-Security-Policy']).toContain('sandbox');

    for (const name of ['abc.pdf', 'abc.txt', 'legacy.html', 'legacy.svg', 'abc.bin']) {
      const h = uploadResponseHeaders(`/data/uploads/${name}`);
      expect(h['Content-Disposition']).toBe('attachment');
      expect(h['Content-Security-Policy']).toContain("default-src 'none'");
    }
  });

  it('verifies WebP images by their bytes', () => {
    const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0x24, 0, 0, 0]), Buffer.from('WEBPVP8 ')]);
    expect(sniffMime(webp)).toBe('image/webp');
    expect(SNIFFABLE.has('image/webp')).toBe(true);
    expect(sniffMime(Buffer.from('<html><script>alert(1)</script></html>'))).toBeNull();
  });
});
