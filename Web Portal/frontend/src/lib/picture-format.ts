/**
 * How a cropped project picture is saved: JPEG when every pixel is opaque (a photo), else PNG, which
 * keeps the transparency of a logo fitted in the square. Both can be printed in the minutes PDF
 * (WebP can't), and the server flattens a transparent PNG onto white there.
 * `rgba` is the canvas's pixel data (getImageData().data); null when it can't be read.
 */
export function pictureFormat(rgba: Uint8ClampedArray | null): { type: 'image/jpeg'; quality: number } | { type: 'image/png' } {
  if (!rgba || rgba.length === 0) return { type: 'image/png' };
  for (let i = 3; i < rgba.length; i += 4) if (rgba[i]! < 255) return { type: 'image/png' };
  return { type: 'image/jpeg', quality: 0.9 };
}
