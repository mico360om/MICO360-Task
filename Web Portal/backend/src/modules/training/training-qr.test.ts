import { describe, expect, it } from 'vitest';
import { qrMatrix } from './training-qr';

describe('qrMatrix', () => {
  const url = 'https://acme.example/verify/TC-2345-6789-ABCD';
  it('is a square grid of a valid QR size with three finder patterns', () => {
    const m = qrMatrix(url);
    const n = m.length;
    expect(n).toBeGreaterThanOrEqual(21);
    expect(n % 4).toBe(1);
    for (const row of m) expect(row).toHaveLength(n);
    const finder = (r0: number, c0: number) => {
      for (let i = 0; i < 7; i++) {
        expect(m[r0]![c0 + i]).toBe(true);
        expect(m[r0 + 6]![c0 + i]).toBe(true);
        expect(m[r0 + i]![c0]).toBe(true);
        expect(m[r0 + i]![c0 + 6]).toBe(true);
      }
      expect(m[r0 + 1]![c0 + 1]).toBe(false);
      expect(m[r0 + 3]![c0 + 3]).toBe(true);
    };
    finder(0, 0);
    finder(0, n - 7);
    finder(n - 7, 0);
  });
  it('is deterministic', () => {
    expect(qrMatrix(url)).toEqual(qrMatrix(url));
  });
});
