import { describe, it, expect } from 'vitest';
import { newIdempotencyKey, idempotencyHeaders } from './idempotency';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('newIdempotencyKey', () => {
  it('produces a v4-shaped UUID', () => {
    expect(newIdempotencyKey()).toMatch(UUID_V4);
  });

  it('produces a v4-shaped UUID from the Math.random fallback (no crypto in Hermes)', () => {
    let seed = 1;
    const rnd = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    expect(newIdempotencyKey(rnd, () => 1_700_000_000_000)).toMatch(UUID_V4);
  });

  it('does not repeat across many calls', () => {
    const keys = new Set(Array.from({ length: 2000 }, () => newIdempotencyKey()));
    expect(keys.size).toBe(2000);
  });
});

describe('idempotencyHeaders', () => {
  it('builds the header only when a key is present', () => {
    expect(idempotencyHeaders('k1')).toEqual({ headers: { 'Idempotency-Key': 'k1' } });
    expect(idempotencyHeaders(undefined)).toEqual({});
    expect(idempotencyHeaders('')).toEqual({});
  });
});
