import { describe, it, expect } from 'vitest';
import { imageDimensions } from './image-dimensions';
import { jpegHeader, pngHeader, webpExtended, webpLossless, webpLossy } from './test-images';

describe('imageDimensions — the real size of an uploaded picture', () => {
  it('reads PNG, JPEG and all three kinds of WebP', () => {
    expect(imageDimensions(pngHeader(512, 300))).toEqual({ width: 512, height: 300 });
    expect(imageDimensions(jpegHeader(1024, 768))).toEqual({ width: 1024, height: 768 });
    expect(imageDimensions(webpLossy(640, 480))).toEqual({ width: 640, height: 480 });
    expect(imageDimensions(webpLossless(256, 256))).toEqual({ width: 256, height: 256 });
    expect(imageDimensions(webpExtended(5000, 20))).toEqual({ width: 5000, height: 20 });
  });

  it('gives up (null) on anything it cannot read', () => {
    expect(imageDimensions(Buffer.from('not an image'))).toBeNull();
    expect(imageDimensions(Buffer.from([0xff, 0xd8, 0xff]))).toBeNull();
    expect(imageDimensions(Buffer.alloc(0))).toBeNull();
  });
});
