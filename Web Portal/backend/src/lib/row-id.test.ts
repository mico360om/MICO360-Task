import { describe, it, expect } from 'vitest';
import { newRowId } from './row-id';

describe('row ids for rows written in bulk', () => {
  it('look like the ids Prisma gives (25 characters, starting with c, lower-case letters and digits)', () => {
    const id = newRowId();
    expect(id).toMatch(/^c[0-9a-z]{24}$/);
  });

  it('never repeat, even many at once', () => {
    const ids = new Set(Array.from({ length: 20_000 }, () => newRowId()));
    expect(ids.size).toBe(20_000);
  });
});
