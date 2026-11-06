import { useEffect, useRef, useState, type FormEvent } from 'react';
import { FieldError, FieldLabel, fieldClass } from '../../components/ui/Field';
import { ApiError } from '../../lib/api-client';
import { askedTooSoon, NEW_CODE_SENT } from '../../lib/login-code-step';
import type { ChallengeResend, SignInChallenge } from '../../api/auth';

/**
 * Onboarding: "Check your email" — the step between the right password and the first session for an
 * account whose email address isn't confirmed yet (the same step the two-step sign-in will use). The
 * challenge token stays in this component's memory only: a reload starts again at the password, and
 * signing in again reuses the code already emailed.
 */
export interface EmailCheckStepProps {
  challenge: SignInChallenge;
  /** Send the code; resolves when signed in. */
  onVerify: (code: string) => Promise<void>;
  onResend: () => Promise<ChallengeResend>;
  /** Back to the password step (a different account), with a reason when the step ended. */
  onBack: (reason?: string) => void;
}

/** Answers that end the step: the person starts again at the password. */
const ENDED = new Set(['SIGN_IN_EXPIRED', 'ACCOUNT_INACTIVE', 'TOO_MANY_WRONG_CODES']);
const countdown = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
const REUSED = 'We emailed you a code a moment ago — use that one. It works for 10 minutes.';

export function EmailCheckStep({ challenge, onVerify, onResend, onBack }: EmailCheckStepProps) {
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(challenge.codeSent ? null : REUSED);
  const [busy, setBusy] = useState(false);
  const [resendAt, setResendAt] = useState(() => Date.parse(challenge.resendAt) || 0);
  const [now, setNow] = useState(() => Date.now());
  const codeRef = useRef<HTMLInputElement>(null);
  const resendIn = Math.max(0, Math.ceil((resendAt - now) / 1000));
  const waiting = resendIn > 0;

  useEffect(() => codeRef.current?.focus(), []);
  useEffect(() => {
    if (!waiting) return;
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, [waiting, resendAt]);

  function problem(e: unknown, fallback: string): string {
    return e instanceof ApiError && e.message && !/^Request failed/.test(e.message) ? e.message : e instanceof ApiError ? fallback : 'Unable to reach the server. Check your connection and try again.';
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const digits = code.replace(/\s+/g, '');
    if (!/^\d{6}$/.test(digits)) {
      setFieldError('Enter the 6-digit code from the email.');
      codeRef.current?.focus();
      return;
    }
    setFieldError(null);
    setBusy(true);
    try {
      await onVerify(digits);
    } catch (err) {
      const message = problem(err, 'That code didn’t work. Please try again.');
      if (err instanceof ApiError && ENDED.has(err.code ?? '')) {
        onBack(message);
        return;
      }
      setError(message);
      codeRef.current?.focus();
      codeRef.current?.select();
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    if (waiting || busy) return;
    setError(null);
    setInfo(null);
    setBusy(true);
    try {
      const out = await onResend();
      setResendAt(Date.parse(out.resendAt) || Date.now() + 60_000);
      setNow(Date.now());
      setInfo(out.codeSent ? NEW_CODE_SENT : askedTooSoon(out.retryAfterSeconds ?? 60));
      setCode('');
      codeRef.current?.focus();
    } catch (err) {
      if (err instanceof ApiError && ENDED.has(err.code ?? '')) {
        onBack(problem(err, ''));
        return;
      }
      setError(problem(err, 'We couldn’t send another code. Please try again in a minute.'));
    } finally {
      setBusy(false);
    }
  }

  const invalid = !!fieldError || !!error;
  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <div className="flex flex-col gap-1.5">
        <FieldLabel htmlFor="email-check-code" required>
          6-digit code
        </FieldLabel>
        <input
          id="email-check-code"
          ref={codeRef}
          inputMode="numeric"
          autoComplete="one-time-code"
          placeholder="123456"
          required
          aria-required="true"
          aria-invalid={invalid ? true : undefined}
          aria-describedby={fieldError ? 'email-check-code-error' : error ? 'email-check-error' : 'email-check-hint'}
          maxLength={8}
          value={code}
          onChange={(e) => {
            setCode(e.target.value.replace(/[^\d ]/g, '').slice(0, 8));
            if (fieldError) setFieldError(null);
          }}
          className={fieldClass(invalid, 'text-center font-mono text-lg tracking-[0.4em] placeholder:font-sans placeholder:text-sm placeholder:tracking-normal')}
        />
        <p id="email-check-hint" className="text-xs text-ink-2">The code works once, for 10 minutes. Check your spam folder if it hasn’t arrived.</p>
        <FieldError id="email-check-code-error">{fieldError}</FieldError>
      </div>

      {error ? (
        <p id="email-check-error" role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : info ? (
        <p role="status" className="rounded-lg bg-brand/5 px-3 py-2 text-sm text-ink-2">
          {info}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={busy}
        className="mt-1 rounded-xl bg-brand-gradient px-4 py-3 text-sm font-semibold text-white shadow-brand transition hover:-translate-y-0.5 hover:shadow-lift disabled:pointer-events-none disabled:opacity-60"
      >
        {busy ? 'Checking…' : 'Confirm and sign in'}
      </button>

      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <button
          type="button"
          onClick={() => void resend()}
          disabled={waiting || busy}
          className="tap text-xs font-medium text-brand hover:underline disabled:cursor-default disabled:text-ink-2 disabled:no-underline"
        >
          {waiting ? (
            <>
              Resend code in <span className="tabular-nums">{countdown(resendIn)}</span>
            </>
          ) : (
            'Resend code'
          )}
        </button>
        <button type="button" onClick={() => onBack()} className="tap text-xs font-medium text-ink-2 hover:text-brand hover:underline">
          Sign in with a different account
        </button>
      </div>
    </form>
  );
}
