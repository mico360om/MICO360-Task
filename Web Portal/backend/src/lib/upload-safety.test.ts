import { describe, it, expect } from 'vitest';
import { extensionForMime, uploadResponseHeaders , fileTooLargeMessage, fileTypeNotAllowedMessage, fileContentMismatchMessage } from './upload-safety';
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
    // People's files: shared caches (proxies, CDNs) must not keep copies.
    expect(img['Cache-Control']).toBe('private, no-cache');

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

describe('why an upload was refused, in words for the person who chose the file', () => {
  it('gives the size limit in MB or KB, not bytes', () => {
    expect(fileTooLargeMessage(10 * 1024 * 1024)).toBe('That file is too large — the limit is 10 MB.');
    expect(fileTooLargeMessage(512 * 1024)).toBe('That file is too large — the limit is 512 KB.');
    expect(fileTooLargeMessage(1536 * 1024)).toBe('That file is too large — the limit is 1.5 MB.');
  });

  it('names the kind of file by its extension, never by an internal type like application/x-msdownload', () => {
    expect(fileTypeNotAllowedMessage('setup.exe')).toBe('“.exe” files can’t be attached. Try a document, image, PDF or zip instead.');
    expect(fileTypeNotAllowedMessage('ARCHIVE.TAR.GZ')).toBe('“.gz” files can’t be attached. Try a document, image, PDF or zip instead.');
    expect(fileTypeNotAllowedMessage('README')).toBe('This kind of file can’t be attached. Try a document, image, PDF or zip instead.');
    expect(fileTypeNotAllowedMessage(undefined)).not.toMatch(/application|octet/);
  });

  it('explains a file whose contents are not what its name says', () => {
    expect(fileContentMismatchMessage('photo.png')).toBe('“photo.png” isn’t really a .png file — it may be damaged or renamed.');
    expect(fileContentMismatchMessage('')).toBe('That file isn’t what its name says — it may be damaged or renamed.');
  });
});

