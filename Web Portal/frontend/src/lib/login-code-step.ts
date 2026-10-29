/**
 * The sign-in page's "Email code" step, remembered for this browser tab only (sessionStorage), so a
 * reload keeps the person on the code step with the address the code went to and the wait before
 * another code. Never in the page's address. Forgotten on sign-in, on going back to Password or to
 * another address, and once the code would have run out (codes last 10 minutes).
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

export function rememberCodeStep(step: CodeStep): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(step));
  } catch {
    /* storage blocked: a reload starts over, as before */
  }
}

export function recallCodeStep(now: number = Date.now()): CodeStep | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<CodeStep>;
    const fresh = typeof v.resendAt === 'number' && now < v.resendAt - RESEND_AFTER_MS + KEEP_MS;
    if (typeof v.identifier === 'string' && v.identifier && fresh) return { identifier: v.identifier, resendAt: v.resendAt! };
    sessionStorage.removeItem(KEY);
  } catch {
    /* unreadable: start over */
  }
  return null;
}

export function forgetCodeStep(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* nothing to forget */
  }
}
