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

describe('AI usage limiter: checking without counting', () => {
  it('says whether one more request would be allowed, without counting it', () => {
    const limiter = createAiUsageLimiter({ perMinute: 100, perDay: 2 }, 'Asia/Muscat', () => new Date('2026-09-26T08:00:00Z'));
    limiter.check('u1');
    limiter.check('u1');
    limiter.take('u1');
    limiter.check('u1');
    limiter.take('u1');
    expect(() => limiter.check('u1')).toThrow(/today/);
  });
});

describe('AI usage limiter: MICO AI questions', () => {
  it('a question counts once against the minute; each of its calls counts against the day only', () => {
    const limiter = createAiUsageLimiter({ perMinute: 2, perDay: 5 }, 'Asia/Muscat', () => new Date('2026-09-26T08:00:00Z'));
    limiter.startQuestion('u1');
    for (let i = 0; i < 4; i++) limiter.takeDaily('u1'); // many calls, but the minute counted the question only
    limiter.startQuestion('u1');
    expect(() => limiter.startQuestion('u1')).toThrow(/too quickly/);
    limiter.takeDaily('u1');
    expect(() => limiter.takeDaily('u1')).toThrow(/today/);
    expect(() => limiter.take('u2')).not.toThrow(); // others are unaffected
  });

  it('a question is refused up front when the day is used up', () => {
    const limiter = createAiUsageLimiter({ perMinute: 10, perDay: 1 }, 'Asia/Muscat', () => new Date('2026-09-26T08:00:00Z'));
    limiter.takeDaily('u1');
    expect(() => limiter.startQuestion('u1')).toThrow(/today/);
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
