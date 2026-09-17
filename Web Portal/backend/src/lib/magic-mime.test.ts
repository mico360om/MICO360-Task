import { describe, it, expect } from 'vitest';
import { sniffMime } from './magic-mime';

describe('sniffMime', () => {
  it('detects PNG', () => {
    expect(sniffMime(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2]))).toBe('image/png');
  });
  it('detects JPEG', () => {
    expect(sniffMime(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]))).toBe('image/jpeg');
  });
  it('detects GIF', () => {
    expect(sniffMime(Buffer.from('GIF89a....'))).toBe('image/gif');
  });
  it('detects PDF', () => {
    expect(sniffMime(Buffer.from('%PDF-1.4\n...'))).toBe('application/pdf');
  });
  it('detects ZIP', () => {
    expect(sniffMime(Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0]))).toBe('application/zip');
  });
  it('returns null for unknown/plain content', () => {
    expect(sniffMime(Buffer.from('hello world'))).toBeNull();
  });
});
