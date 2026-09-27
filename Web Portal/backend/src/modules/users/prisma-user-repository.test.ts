import { describe, it, expect } from 'vitest';
import { tombstone } from './prisma-user-repository';

describe('tombstone (freeing a deleted account’s email / username)', () => {
  it('keeps the original recognisable and makes it unique', () => {
    const a = tombstone('ali@mico360.com', 'ckuser00000001');
    expect(a.startsWith('ali@mico360.com~deleted-')).toBe(true);
    expect(a).not.toBe('ali@mico360.com');
  });

  it('never exceeds the 191-character column', () => {
    expect(tombstone('x'.repeat(191), 'ckuser00000001').length).toBeLessThanOrEqual(191);
  });

  it('works for Arabic usernames', () => {
    expect(tombstone('علي', 'ckuser00000001').startsWith('علي~deleted-')).toBe(true);
  });
});
