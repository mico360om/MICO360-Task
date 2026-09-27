import { describe, it, expect } from 'vitest';
import { AiBusyError, AiRateLimitedError, createAiUsageLimiter, createConcurrencyGate } from './ai-limits';

describe('AI usage limiter (per user)', () => {
  it('allows perMinute requests, then refuses until the minute has passed', () => {
    let t = Date.parse('2026-09-26T08:00:00Z');
    const limiter = createAiUsageLimiter({ perMinute: 2, perDay: 100 }, 'Asia/Muscat', () => new Date(t));
    limiter.take('u1');
    limiter.take('u1');
    expect(() => limiter.take('u1')).toThrow(AiRateLimitedError);
    limiter.take('u2'); // other users are unaffected
    t += 61_000;
    expect(() => limiter.take('u1')).not.toThrow();
  });

  it('caps requests per company-local day and resets at local midnight', () => {
    // 19:59Z on the 26th is 23:59 in Muscat; 20:01Z is already the 27th there.
    let t = Date.parse('2026-09-26T19:00:00Z');
    const limiter = createAiUsageLimiter({ perMinute: 100, perDay: 2 }, 'Asia/Muscat', () => new Date(t));
    limiter.take('u1');
    limiter.take('u1');
    t = Date.parse('2026-09-26T19:59:00Z');
    expect(() => limiter.take('u1')).toThrow(/today/);
    t = Date.parse('2026-09-26T20:01:00Z');
    expect(() => limiter.take('u1')).not.toThrow();
  });
});

describe('concurrency gate (per model)', () => {
  it('lets at most `limit` requests run at once and queues the rest', async () => {
    const gate = createConcurrencyGate(1000);
    const r1 = await gate.acquire('m1', 2);
    const r2 = await gate.acquire('m1', 2);
    expect(gate.activeCount('m1')).toBe(2);
    let third = false;
    const pending = gate.acquire('m1', 2).then((release) => {
      third = true;
      return release;
    });
    await new Promise((r) => setTimeout(r, 10));
    expect(third).toBe(false);
    r1();
    const r3 = await pending;
    expect(third).toBe(true);
    expect(gate.activeCount('m1')).toBe(2);
    r2();
    r3();
    r3(); // releasing twice is harmless
    expect(gate.activeCount('m1')).toBe(0);
  });

  it('fails with AI_BUSY when no slot frees up in time', async () => {
    const gate = createConcurrencyGate(20);
    await gate.acquire('m1', 1);
    await expect(gate.acquire('m1', 1)).rejects.toBeInstanceOf(AiBusyError);
  });
});
