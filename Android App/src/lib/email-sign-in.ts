import { normalizeDigits } from './form-input';
import type { KeyValueStore } from './storage';
/**
 * Signing in with an emailed code (the "Email code" tab), as the website's sign-in page
 * (Web Portal/frontend/src/lib/login-code-step.ts and pages/LoginPage.tsx; a test checks the words
 * and rules are the same).
 *
 * The server can send codes only when its email is set up, so the tab is offered only once the
 * server has said so. A code can be re-sent once a minute (the server's own limit) — asked too soon,
 * the server sends nothing and says how long to wait — and is 4 to 10 digits long (OTP_LENGTH). The
 * step (the address and when Resend works again) is kept on the phone, so it is still there when
 * Android closed the app while the person read the email.
 */

/** How long another code waits after one is asked for (the server sends one a minute). */
export const RESEND_AFTER_MS = 60_000;
/** A code lasts 10 minutes: after that, there is no step to come back to. */
const KEEP_MS = 10 * 60_000;
const CODE_MIN_DIGITS = 4;
const CODE_MAX_DIGITS = 10;

/**
 * Whether the server can email sign-in codes and reset links: its public /config says. Null when
 * that is unknown (no answer, or an older server that does not say).
 */
export async function fetchEmailEnabled(
  apiBase: string,
  fetchImpl: typeof fetch = (...a) => fetch(...a),
  timeoutMs = 8000,
): Promise<boolean | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(`${apiBase}/config`, { signal: controller.signal });
    if (!res.ok) return null;
    const body = (await res.json()) as { data?: { emailEnabled?: unknown } };
    const enabled = body?.data?.emailEnabled;
    return typeof enabled === 'boolean' ? enabled : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Seconds left before another code may be asked for (0 = now): until `resendAt`. */
export function resendWaitSeconds(resendAt: number | null, nowMs: number): number {
  if (resendAt === null) return 0;
  return Math.max(0, Math.ceil((resendAt - nowMs) / 1000));
}

/** The server's answer to "email me a code": `sent: false` when the same address asked less than a minute ago. */
export interface CodeAnswer {
  sent?: boolean;
  retryAfterSeconds?: number;
}

/** The seconds to wait when the server sent nothing (asked too soon), else null. */
export function waitFromAnswer(answer: CodeAnswer | null | undefined): number | null {
  return answer?.sent === false && typeof answer.retryAfterSeconds === 'number' ? Math.max(1, Math.ceil(answer.retryAfterSeconds)) : null;
}

/** Said when the same address asked again too soon — true whether or not it has an account. */
export const askedTooSoon = (seconds: number) =>
  `You asked for a code less than a minute ago, so we haven’t sent another. Check your email — and your spam folder — or ask again in ${seconds}\u00a0s.`; // no line break between the number and its unit

/** Said when another code went: the one before it no longer works. */
export const NEW_CODE_SENT = 'We’ve sent a new code. Use the newest one — the earlier code no longer works.';

/** Said once a code was asked for (the website's sign-in page). */
export const CODE_SENT = 'If that account exists, we’ve emailed it a one-time code. Check your inbox — and your spam folder.';

/** Where the phone keeps the "Email code" step (the website keeps it under the same name). */
export const CODE_STEP_KEY = 'mico360.signInCode';

export interface CodeStep {
  /** The address (or username) the code was asked for. */
  identifier: string;
  /** When another code may be asked for (ms since 1970). */
  resendAt: number;
}

/**
 * The "Email code" step kept on the phone: recalled while the code still lasts (10 minutes from
 * when it was asked for), forgotten otherwise, on every sign-in and on going back. A store that
 * fails never throws (the step simply starts over).
 */
export function createCodeStepMemory(store: KeyValueStore, key: string = CODE_STEP_KEY) {
  return {
    async remember(step: CodeStep): Promise<void> {
      try {
        await store.setItem(key, JSON.stringify(step));
      } catch {
        /* not kept: the step starts over after a restart, as before */
      }
    },
    async recall(now: number = Date.now()): Promise<CodeStep | null> {
      try {
        const raw = await store.getItem(key);
        if (!raw) return null;
        const v = JSON.parse(raw) as Partial<CodeStep>;
        const fresh = typeof v.resendAt === 'number' && now < v.resendAt - RESEND_AFTER_MS + KEEP_MS;
        if (typeof v.identifier === 'string' && v.identifier && fresh) return { identifier: v.identifier, resendAt: v.resendAt! };
        await store.deleteItem(key);
      } catch {
        try {
          await store.deleteItem(key);
        } catch {
          /* nothing to forget */
        }
      }
      return null;
    },
    async forget(): Promise<void> {
      try {
        await store.deleteItem(key);
      } catch {
        /* nothing to forget */
      }
    },
  };
}

export function resendLabel(waitSeconds: number): string {
  if (waitSeconds <= 0) return 'Resend code';
  return `Resend code in ${Math.floor(waitSeconds / 60)}:${String(waitSeconds % 60).padStart(2, '0')}`;
}

/** What TalkBack says for Resend: the same wait as resendLabel, in words ("1 minute 15 seconds"). */
export function resendA11yLabel(waitSeconds: number): string {
  if (waitSeconds <= 0) return 'Resend code';
  const m = Math.floor(waitSeconds / 60);
  const sec = waitSeconds % 60;
  const unit = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
  const left = [m ? unit(m, 'minute') : null, sec ? unit(sec, 'second') : null].filter(Boolean).join(' ');
  return `Resend code, available in ${left}`;
}

/** Digits only (a pasted "123 456" or "123-456" works), at most the longest code the server sends. */
export function normaliseCode(text: string): string {
  // Arabic-Indic and Persian digits (an Arabic keyboard) count as the code's digits too.
  return normalizeDigits(text).replace(/\D/g, '').slice(0, CODE_MAX_DIGITS);
}

export function isCodeComplete(code: string): boolean {
  return code.length >= CODE_MIN_DIGITS;
}
