import { HttpError } from '../../lib/http-errors';
import { todayKey } from '../../lib/due-date';

export class AiRateLimitedError extends HttpError {
  constructor(message: string) {
    super(message, 'AI_RATE_LIMITED', 429);
  }
}

export class AiBusyError extends HttpError {
  constructor() {
    super('The AI model is busy right now. Try again in a moment.', 'AI_BUSY', 429);
  }
}

export interface AiUsageLimits {
  /** AI requests per user per minute. */
  perMinute: number;
  /** AI requests per user per company-local day. */
  perDay: number;
}

/** Per-user request budget (in-process): a short-term rate plus a daily cap (AI-02). */
export function createAiUsageLimiter(limits: AiUsageLimits, timeZone: string, now: () => Date = () => new Date()) {
  const recent = new Map<string, number[]>();
  const daily = new Map<string, { day: string; count: number }>();

  /** Count one request for the user, or throw when they are over a limit. */
  function take(userId: string): void {
    const at = now();
    const t = at.getTime();
    const lastMinute = (recent.get(userId) ?? []).filter((x) => t - x < 60_000);
    if (lastMinute.length >= limits.perMinute) {
      throw new AiRateLimitedError('You’re sending AI requests too quickly. Wait a minute and try again.');
    }
    const day = todayKey(timeZone, at);
    const used = daily.get(userId);
    const count = used && used.day === day ? used.count : 0;
    if (count >= limits.perDay) throw new AiRateLimitedError('You’ve reached today’s AI request limit. It resets tomorrow.');
    lastMinute.push(t);
    recent.set(userId, lastMinute);
    daily.set(userId, { day, count: count + 1 });
  }

  return { take };
}

/**
 * Per-model concurrency limit (the model's `concurrencyLimit`, which used to be stored but never
 * enforced). A request waits up to `waitMs` for a free slot, then fails with AI_BUSY.
 */
export function createConcurrencyGate(waitMs = 20_000) {
  const active = new Map<string, number>();
  const waiting = new Map<string, Array<() => void>>();

  function release(key: string): void {
    active.set(key, Math.max(0, (active.get(key) ?? 1) - 1));
    const next = waiting.get(key)?.shift();
    next?.();
  }

  async function acquire(key: string, limit: number): Promise<() => void> {
    const deadline = Date.now() + waitMs;
    while ((active.get(key) ?? 0) >= Math.max(1, limit)) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new AiBusyError();
      await new Promise<void>((resolve, reject) => {
        const queue = waiting.get(key) ?? [];
        waiting.set(key, queue);
        const wake = () => {
          clearTimeout(timer);
          resolve();
        };
        const timer = setTimeout(() => {
          const i = queue.indexOf(wake);
          if (i >= 0) queue.splice(i, 1);
          reject(new AiBusyError());
        }, remaining);
        queue.push(wake);
      });
    }
    active.set(key, (active.get(key) ?? 0) + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      release(key);
    };
  }

  return { acquire, activeCount: (key: string) => active.get(key) ?? 0 };
}
