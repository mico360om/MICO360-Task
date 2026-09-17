import { useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { AuthShell } from '../components/AuthShell';
import { apiClient } from '../api/client';
import { authApi } from '../api/auth';
import { ApiError } from '../lib/api-client';
import { FieldLabel, FieldError, fieldClass } from '../components/ui/Field';

export function ForgotPasswordPage() {
  const [identifier, setIdentifier] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const identifierRef = useRef<HTMLInputElement>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (identifier.trim() === '') {
      setFieldError('Email or username is required.');
      identifierRef.current?.focus();
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await authApi(apiClient).forgotPassword(identifier);
      setSent(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to reach the server. Try again.');
    } finally {
      setLoading(false);
    }
  }

  if (sent) {
    return (
      <AuthShell title="Check your email">
        <p className="text-sm text-ink-2">
          If an account matches <span className="font-medium text-ink">{identifier}</span>, we’ve emailed a link to
          reset your password. The link expires in an hour.
        </p>
        <Link to="/login" className="mt-6 inline-block text-sm font-medium text-brand hover:underline">
          ← Back to sign in
        </Link>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Reset your password" subtitle="Enter your email or username and we’ll send a reset link.">
      <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
        <div className="flex flex-col gap-1.5">
          <FieldLabel htmlFor="identifier" required>
            Email or username
          </FieldLabel>
          <input
            id="identifier"
            ref={identifierRef}
            autoComplete="username"
            placeholder="you@company.com"
            required
            aria-required="true"
            aria-invalid={fieldError ? true : undefined}
            aria-describedby={fieldError ? 'identifier-error' : undefined}
            value={identifier}
            onChange={(e) => {
              setIdentifier(e.target.value);
              if (fieldError) setFieldError(null);
            }}
            className={fieldClass(!!fieldError, 'w-full')}
          />
          <FieldError id="identifier-error">{fieldError}</FieldError>
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
          {loading ? 'Sending…' : 'Send reset link'}
        </button>

        <Link to="/login" className="text-center text-xs font-medium text-ink-2 hover:text-brand">
          ← Back to sign in
        </Link>
      </form>
    </AuthShell>
  );
}
