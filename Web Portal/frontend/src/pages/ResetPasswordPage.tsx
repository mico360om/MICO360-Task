import { useRef, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AuthShell } from '../components/AuthShell';
import { apiClient } from '../api/client';
import { authApi } from '../api/auth';
import { ApiError } from '../lib/api-client';
import { FieldLabel, FieldError, fieldClass } from '../components/ui/Field';

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<{ password?: string; confirm?: string }>({});
  const [done, setDone] = useState(false);
  const passwordRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLInputElement>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const next: { password?: string; confirm?: string } = {};
    if (!password) next.password = 'New password is required.';
    if (!confirm) next.confirm = 'Please confirm your password.';
    if (Object.keys(next).length > 0) {
      setErrors(next);
      (next.password ? passwordRef : confirmRef).current?.focus();
      return;
    }
    setErrors({});
    if (password !== confirm) {
      setError('The two passwords don’t match.');
      return;
    }
    setLoading(true);
    try {
      await authApi(apiClient).resetPassword(token, password);
      setDone(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to reach the server. Try again.');
    } finally {
      setLoading(false);
    }
  }

  if (!token) {
    return (
      <AuthShell title="Invalid reset link">
        <p className="text-sm text-ink-2">This link is missing its reset token. Request a new one to continue.</p>
        <Link to="/forgot" className="mt-6 inline-block text-sm font-medium text-brand hover:underline">
          Request a new reset link
        </Link>
      </AuthShell>
    );
  }

  if (done) {
    return (
      <AuthShell title="Password updated">
        <p className="text-sm text-ink-2">Your password has been changed and your account is unlocked. You can sign in now.</p>
        <Link to="/login" className="mt-6 inline-block text-sm font-medium text-brand hover:underline">
          Go to sign in →
        </Link>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Choose a new password" subtitle="Pick a strong password you don’t use elsewhere.">
      <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
        <div className="flex flex-col gap-1.5">
          <FieldLabel htmlFor="password" required>
            New password
          </FieldLabel>
          <input
            id="password"
            ref={passwordRef}
            type="password"
            autoComplete="new-password"
            required
            aria-required="true"
            aria-invalid={errors.password ? true : undefined}
            aria-describedby={errors.password ? 'password-error' : 'password-hint'}
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              if (errors.password) setErrors((p) => ({ ...p, password: undefined }));
            }}
            className={fieldClass(!!errors.password, 'w-full')}
          />
          <p id="password-hint" className="text-xs text-ink-2">At least 8 characters, with a letter and a number.</p>
          <FieldError id="password-error">{errors.password}</FieldError>
        </div>

        <div className="flex flex-col gap-1.5">
          <FieldLabel htmlFor="confirm" required>
            Confirm new password
          </FieldLabel>
          <input
            id="confirm"
            ref={confirmRef}
            type="password"
            autoComplete="new-password"
            required
            aria-required="true"
            aria-invalid={errors.confirm ? true : undefined}
            aria-describedby={errors.confirm ? 'confirm-error' : undefined}
            value={confirm}
            onChange={(e) => {
              setConfirm(e.target.value);
              if (errors.confirm) setErrors((p) => ({ ...p, confirm: undefined }));
            }}
            className={fieldClass(!!errors.confirm, 'w-full')}
          />
          <FieldError id="confirm-error">{errors.confirm}</FieldError>
        </div>

        {error ? (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={loading}
          className="rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-2 disabled:opacity-60"
        >
          {loading ? 'Updating…' : 'Update password'}
        </button>
      </form>
    </AuthShell>
  );
}
