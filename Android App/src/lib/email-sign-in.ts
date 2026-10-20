import { normalizeDigits } from './form-input';
/**
 * Signing in with an emailed code (the "Email code" tab).
 *
 * The server can send codes only when its email is set up, so the tab is offered only once the
 * server has said so. A code can be re-sent once a minute (the server's own limit), and is 4 to 10
 * digits long (the server's OTP_LENGTH).
 */

/** The server sends at most one code a minute per account, so "Resend" waits as long. */
export const RESEND_AFTER_SECONDS = 60;
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

/** Seconds left before another code may be asked for (0 = now). */
export function resendWaitSeconds(sentAtMs: number | null, nowMs: number): number {
  if (sentAtMs === null) return 0;
  return Math.max(0, Math.ceil((sentAtMs + RESEND_AFTER_SECONDS * 1000 - nowMs) / 1000));
}

export function resendLabel(waitSeconds: number): string {
  if (waitSeconds <= 0) return 'Resend code';
  return `Resend code in ${Math.floor(waitSeconds / 60)}:${String(waitSeconds % 60).padStart(2, '0')}`;
}

/** Digits only (a pasted "123 456" or "123-456" works), at most the longest code the server sends. */
export function normaliseCode(text: string): string {
  // Arabic-Indic and Persian digits (an Arabic keyboard) count as the code's digits too.
  return normalizeDigits(text).replace(/\D/g, '').slice(0, CODE_MAX_DIGITS);
}

export function isCodeComplete(code: string): boolean {
  return code.length >= CODE_MIN_DIGITS;
}
