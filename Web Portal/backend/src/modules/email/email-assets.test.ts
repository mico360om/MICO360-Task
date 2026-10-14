import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** Width and height from a PNG's header. */
function pngSize(file: string): { width: number; height: number } {
  const b = readFileSync(resolve(__dirname, '../../../assets', file));
  expect(b.subarray(1, 4).toString('latin1')).toBe('PNG');
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
}

describe('email assets', () => {
  it('the email logo is the MICO360 wordmark (wide, about 2.1 : 1), sharp at 94 × 44', () => {
    const { width, height } = pngSize('email-logo.png');
    expect(width / height).toBeGreaterThan(1.9);
    expect(width / height).toBeLessThan(2.4);
    expect(height).toBeGreaterThanOrEqual(88); // at least twice the size it is shown at, for sharp screens
  });
});
