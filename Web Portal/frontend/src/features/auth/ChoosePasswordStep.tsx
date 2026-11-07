import { useEffect, useRef, useState, type FormEvent } from 'react';
import { FieldError, FieldLabel, fieldClass } from '../../components/ui/Field';
import { ApiError } from '../../lib/api-client';
import { isStrongPassword, PASSWORD_RULE_ERROR, PASSWORD_RULE_HINT } from '../../lib/passwordPolicy';

/**
 * 1.23.6 "Choose your own password": the step after signing in with a temporary password (and the
 * emailed code, when the address isn't confirmed yet). The step ticket stays in the page's memory only;
 * a reload starts again at the password. The password rules apply, and it can't be the temporary one.
 */
export interface ChoosePasswordStepProps {
  /** Set it; resolves when signed in. */
  onSubmit: (password: string) => Promise<void>;
  /** Back to the password step, with a reason when the step ended. */
  onBack: (reason?: string) => void;
}

/** Answers that end the step: the person starts again at the password. */
const ENDED = new Set(['PASSWORD_CHANGE_EXPIRED', 'ACCOUNT_INACTIVE']);

export function ChoosePasswordStep({ onSubmit, onBack }: ChoosePasswordStepProps) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [fieldError, setFieldError] = useState<{ field: 'password' | 'confirm'; text: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const passwordRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLInputElement>(null);

  useEffect(() => passwordRef.current?.focus(), []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!isStrongPassword(password)) {
      setFieldError({ field: 'password', text: PASSWORD_RULE_ERROR });
      passwordRef.current?.focus();
      return;
    }
    if (password !== confirm) {
      setFieldError({ field: 'confirm', text: 'The two passwords don’t match.' });
      confirmRef.current?.focus();
      return;
    }
    setFieldError(null);
    setBusy(true);
    try {
      await onSubmit(password);
    } catch (err) {
      const message =
        err instanceof ApiError && err.message && !/^Request failed/.test(err.message)
          ? err.message
          : err instanceof ApiError
            ? 'Couldn’t set your password. Please try again.'
            : 'Unable to reach the server. Check your connection and try again.';
      if (err instanceof ApiError && ENDED.has(err.code ?? '')) {
        onBack(message);
        return;
      }
      if (err instanceof ApiError && (err.code === 'SAME_AS_TEMPORARY' || err.code === 'WEAK_PASSWORD')) {
        setFieldError({ field: 'password', text: message });
        passwordRef.current?.focus();
        return;
      }
      setError(message);
    } finally {
      setBusy(false);
    }
  }

  const bad = (f: 'password' | 'confirm') => fieldError?.field === f;
  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <div className="flex flex-col gap-1.5">
        <FieldLabel htmlFor="choose-password" required>
          New password
        </FieldLabel>
        <input
          id="choose-password"
          ref={passwordRef}
          type="password"
          autoComplete="new-password"
          required
          aria-required="true"
          aria-invalid={bad('password') ? true : undefined}
          aria-describedby={bad('password') ? 'choose-password-error choose-password-hint' : 'choose-password-hint'}
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
            if (bad('password')) setFieldError(null);
          }}
          maxLength={200}
          className={fieldClass(bad('password'))}
        />
        <p id="choose-password-hint" className="text-xs text-ink-2">
          {PASSWORD_RULE_HINT} Not the temporary one.
        </p>
        <FieldError id="choose-password-error">{bad('password') ? fieldError!.text : null}</FieldError>
      </div>
      <div className="flex flex-col gap-1.5">
        <FieldLabel htmlFor="choose-password-confirm" required>
          Type it again
        </FieldLabel>
        <input
          id="choose-password-confirm"
          ref={confirmRef}
          type="password"
          autoComplete="new-password"
          required
          aria-required="true"
          aria-invalid={bad('confirm') ? true : undefined}
          aria-describedby={bad('confirm') ? 'choose-password-confirm-error' : undefined}
          value={confirm}
          onChange={(e) => {
            setConfirm(e.target.value);
            if (bad('confirm')) setFieldError(null);
          }}
          maxLength={200}
          className={fieldClass(bad('confirm'))}
        />
        <FieldError id="choose-password-confirm-error">{bad('confirm') ? fieldError!.text : null}</FieldError>
      </div>

      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={busy}
        className="mt-1 rounded-xl bg-brand-gradient px-4 py-3 text-sm font-semibold text-white shadow-brand transition hover:-translate-y-0.5 hover:shadow-lift disabled:pointer-events-none disabled:opacity-60"
      >
        {busy ? 'Setting…' : 'Set my password and sign in'}
      </button>
      <button type="button" onClick={() => onBack()} className="tap self-start text-sm font-medium text-ink-2 hover:text-brand">
        Back to sign in
      </button>
    </form>
  );
}
