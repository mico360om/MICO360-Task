/**
 * An "Email code" step, remembered for this browser tab only (sessionStorage), so a reload keeps the
 * person on the code step with the address the code went to and the wait before another code. Never
 * in the page's address. Forgotten on sign-in, on going back (to Password, or to another address),
 * and once the code would have run out (codes last 10 minutes). The staff sign-in page and the client
 * page each keep their own (the client page one per shared link).
 */

const KEY = 'mico360.signInCode';
/** How long another code waits after one is asked for (the server sends one a minute). */
export const RESEND_AFTER_MS = 60_000;
/** A code lasts 10 minutes: after that, there is no step to come back to. */
const KEEP_MS = 10 * 60_000;

export interface CodeStep {
  /** The address (or username) the code was asked for. */
  identifier: string;
  /** When another code may be asked for (ms since 1970). */
  resendAt: number;
}

export interface CodeStepMemory {
  remember(step: CodeStep): void;
  recall(now?: number): CodeStep | null;
  forget(): void;
}

/** A code step remembered under `key` in this browser tab's sessionStorage. */
export function codeStepMemory(key: string): CodeStepMemory {
  return {
    remember(step) {
      try {
        sessionStorage.setItem(key, JSON.stringify(step));
      } catch {
        /* storage blocked: a reload starts over, as before */
      }
    },
    recall(now = Date.now()) {
      try {
        const raw = sessionStorage.getItem(key);
        if (!raw) return null;
        const v = JSON.parse(raw) as Partial<CodeStep>;
        const fresh = typeof v.resendAt === 'number' && now < v.resendAt - RESEND_AFTER_MS + KEEP_MS;
        if (typeof v.identifier === 'string' && v.identifier && fresh) return { identifier: v.identifier, resendAt: v.resendAt! };
        sessionStorage.removeItem(key);
      } catch {
        /* unreadable: start over */
      }
      return null;
    },
    forget() {
      try {
        sessionStorage.removeItem(key);
      } catch {
        /* nothing to forget */
      }
    },
  };
}

/** The staff sign-in page's code step. */
const signInStep = codeStepMemory(KEY);
export const rememberCodeStep = (step: CodeStep): void => signInStep.remember(step);
export const recallCodeStep = (now: number = Date.now()): CodeStep | null => signInStep.recall(now);
export const forgetCodeStep = (): void => signInStep.forget();

/**
 * A short tag for a private link (FNV-1a), so the client page can keep one code step per link
 * without storing the link itself.
 */
export function linkTag(link: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < link.length; i++) {
    h ^= link.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
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
  `You asked for a code less than a minute ago, so we haven’t sent another. Check your email — and your spam folder — or ask again in ${seconds} s.`; // no line break between the number and its unit

/** Said when another code went: the one before it no longer works. */
export const NEW_CODE_SENT = 'We’ve sent a new code. Use the newest one — the earlier code no longer works.';
