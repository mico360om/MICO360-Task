/**
 * Detect a file's real MIME type from its leading "magic" bytes, so a spoofed
 * Content-Type can't slip a disguised file past validation (T2.6). Returns null
 * for content we don't recognise (e.g. plain text/CSV).
 */
export function sniffMime(buf: Buffer): string | null {
  const b = buf;
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length >= 6 && b.toString('ascii', 0, 6).match(/^GIF8[79]a$/)) return 'image/gif';
  if (b.length >= 5 && b.toString('ascii', 0, 5) === '%PDF-') return 'application/pdf';
  if (b.length >= 4 && b[0] === 0x50 && b[1] === 0x4b && (b[2] === 0x03 || b[2] === 0x05) && (b[3] === 0x04 || b[3] === 0x06)) return 'application/zip';
  return null;
}

/** MIME types we can verify by magic bytes; others (text/csv) are trusted by declaration. */
export const SNIFFABLE = new Set(['image/png', 'image/jpeg', 'image/gif', 'application/pdf', 'application/zip']);
