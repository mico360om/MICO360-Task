import { useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { FieldLabel, FieldError, fieldClass } from '../../components/ui/Field';

export interface LoginFormProps {
  onSubmit: (identifier: string, password: string) => void | Promise<void>;
  /** When provided, the "Email code" (passwordless OTP) mode is offered. */
  onRequestCode?: (identifier: string) => void | Promise<void>;
  onVerifyCode?: (identifier: string, code: string) => void | Promise<void>;
  error?: string | null;
  /** Machine-readable error code (e.g. ACCOUNT_LOCKED) for tailored messaging. */
  errorCode?: string | null;
  /** A neutral status note, e.g. "We emailed you a code." */
  info?: string | null;
  loading?: boolean;
  /** Controlled: true once a code has been emailed, so the code entry step shows. */
  codeSent?: boolean;
  /** Called when the user switches auth mode or edits the email, to clear stale state. */
  onModeChange?: () => void;
  /** Route for the "Forgot password?" link shown next to "Keep me signed in". */
  forgotTo?: string;
}

/** A form control with a leading icon (and optional trailing slot). */
function IconField({ icon, trailing, children }: { icon: ReactNode; trailing?: ReactNode; children: ReactNode }) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" aria-hidden="true">
        {icon}
      </span>
      {children}
      {trailing ? <span className="absolute right-2 top-1/2 -translate-y-1/2">{trailing}</span> : null}
    </div>
  );
}

const UserIcon = (
  <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="8" r="3.4" />
    <path d="M4.5 20a7.5 7.5 0 0115 0" />
  </svg>
);
const LockIcon = (
  <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <rect x="4.5" y="10.5" width="15" height="10" rx="2.5" />
    <path d="M8 10.5V7.5a4 4 0 018 0v3" />
  </svg>
);
const MailIcon = (
  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="5.5" width="18" height="13" rx="2.5" />
    <path d="M4 7l8 6 8-6" />
  </svg>
);
const LockSmall = (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
    <rect x="4.5" y="10.5" width="15" height="10" rx="2.5" />
    <path d="M8 10.5V7.5a4 4 0 018 0v3" />
  </svg>
);

type Mode = 'password' | 'code';
interface Errors {
  identifier?: string;
  password?: string;
  code?: string;
}

export function LoginForm({
  onSubmit,
  onRequestCode,
  onVerifyCode,
  error,
  errorCode,
  info,
  loading = false,
  codeSent = false,
  onModeChange,
  forgotTo,
}: LoginFormProps) {
  const [mode, setMode] = useState<Mode>('password');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [keepSignedIn, setKeepSignedIn] = useState(true);
  const [errors, setErrors] = useState<Errors>({});
  const identifierRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const codeRef = useRef<HTMLInputElement>(null);
  const otpAvailable = Boolean(onRequestCode && onVerifyCode);
  const locked = errorCode === 'ACCOUNT_LOCKED';

  function switchMode(next: Mode) {
    if (next === mode) return;
    setMode(next);
    setCode('');
    setErrors({});
    onModeChange?.();
  }

  /** Validate the fields active in the current step; focus + return the first invalid. */
  function validate(): boolean {
    const next: Errors = {};
    if (!identifier.trim()) next.identifier = 'Email or username is required.';
    if (mode === 'password' && !password) next.password = 'Password is required.';
    if (mode === 'code' && codeSent && !code.trim()) next.code = 'Enter the code we emailed you.';
    setErrors(next);
    if (next.identifier) identifierRef.current?.focus();
    else if (next.password) passwordRef.current?.focus();
    else if (next.code) codeRef.current?.focus();
    return Object.keys(next).length === 0;
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!validate()) return;
    if (mode === 'password') {
      void onSubmit(identifier, password);
    } else if (!codeSent) {
      void onRequestCode?.(identifier);
    } else {
      void onVerifyCode?.(identifier, code);
    }
  }

  const submitLabel =
    mode === 'password'
      ? loading
        ? 'Signing in…'
        : 'Sign in'
      : !codeSent
        ? loading
          ? 'Sending…'
          : 'Email me a code'
        : loading
          ? 'Verifying…'
          : 'Verify & sign in';

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
      {otpAvailable ? (
        <div role="tablist" aria-label="Sign-in method" className="grid grid-cols-2 gap-1 rounded-xl bg-ground p-1">
          {(['password', 'code'] as Mode[]).map((m) => (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={mode === m}
              onClick={() => switchMode(m)}
              className={`inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                mode === m ? 'bg-surface text-brand shadow-sm' : 'text-ink-2 hover:text-ink'
              }`}
            >
              <span aria-hidden="true">{m === 'password' ? LockSmall : MailIcon}</span>
              {m === 'password' ? 'Password' : 'Email code'}
            </button>
          ))}
        </div>
      ) : null}

      <div className="flex flex-col gap-1.5">
        <FieldLabel htmlFor="identifier" required>
          Email or username
        </FieldLabel>
        <IconField icon={UserIcon}>
          <input
            id="identifier"
            name="identifier"
            ref={identifierRef}
            autoComplete="username"
            placeholder="you@company.com"
            required
            aria-required="true"
            aria-invalid={errors.identifier ? true : undefined}
            aria-describedby={errors.identifier ? 'identifier-error' : undefined}
            value={identifier}
            onChange={(e) => {
              setIdentifier(e.target.value);
              if (errors.identifier) setErrors((p) => ({ ...p, identifier: undefined }));
            }}
            className={fieldClass(!!errors.identifier, 'w-full pl-10')}
          />
        </IconField>
        <FieldError id="identifier-error">{errors.identifier}</FieldError>
      </div>

      {mode === 'password' ? (
        <div className="flex flex-col gap-1.5">
          <FieldLabel htmlFor="password" required>
            Password
          </FieldLabel>
          <IconField
            icon={LockIcon}
            trailing={
              <button
                type="button"
                onClick={() => setShowPw((v) => !v)}
                className="rounded px-2 py-1 text-[11px] font-bold uppercase tracking-wide text-ink-3 hover:text-brand"
              >
                {showPw ? 'Hide' : 'Show'}
              </button>
            }
          >
            <input
              id="password"
              name="password"
              ref={passwordRef}
              type={showPw ? 'text' : 'password'}
              autoComplete="current-password"
              placeholder="Enter your password"
              required
              aria-required="true"
              aria-invalid={errors.password ? true : undefined}
              aria-describedby={errors.password ? 'password-error' : undefined}
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                if (errors.password) setErrors((p) => ({ ...p, password: undefined }));
              }}
              className={fieldClass(!!errors.password, 'w-full pl-10 pr-16')}
            />
          </IconField>
          <FieldError id="password-error">{errors.password}</FieldError>

          <div className="mt-1 flex items-center justify-between">
            <label className="flex cursor-pointer items-center gap-2 text-sm text-ink-2">
              <input
                type="checkbox"
                checked={keepSignedIn}
                onChange={(e) => setKeepSignedIn(e.target.checked)}
                className="h-4 w-4 rounded border-line accent-brand"
              />
              Keep me signed in
            </label>
            {forgotTo ? (
              <Link to={forgotTo} className="text-sm font-semibold text-brand hover:underline">
                Forgot password?
              </Link>
            ) : null}
          </div>
        </div>
      ) : codeSent ? (
        <div className="flex flex-col gap-1.5">
          <FieldLabel htmlFor="code" required>
            One-time code
          </FieldLabel>
          <input
            id="code"
            name="code"
            ref={codeRef}
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="6-digit code"
            required
            aria-required="true"
            aria-invalid={errors.code ? true : undefined}
            aria-describedby={errors.code ? 'code-error' : undefined}
            value={code}
            onChange={(e) => {
              setCode(e.target.value.replace(/\D/g, '').slice(0, 8));
              if (errors.code) setErrors((p) => ({ ...p, code: undefined }));
            }}
            className={fieldClass(!!errors.code, 'text-center font-mono text-lg tracking-[0.4em]')}
          />
          <FieldError id="code-error">{errors.code}</FieldError>
          {onRequestCode ? (
            <button
              type="button"
              onClick={() => onRequestCode(identifier)}
              className="self-start text-xs font-medium text-brand hover:underline"
            >
              Resend code
            </button>
          ) : null}
        </div>
      ) : (
        <p className="text-sm text-ink-2">We’ll email you a one-time code — no password needed.</p>
      )}

      {locked ? (
        <div role="alert" className="rounded-lg border border-danger/30 bg-danger/5 p-3 text-sm">
          <p className="font-semibold text-danger">Account locked</p>
          <p className="mt-1 text-ink-2">
            Too many failed attempts. <span className="font-medium text-ink">Reset your password</span> to unlock — ask
            your administrator to send a reset if you can’t access it.
          </p>
        </div>
      ) : error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : info ? (
        <p role="status" className="rounded-lg bg-brand/5 px-3 py-2 text-sm text-ink-2">
          {info}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={loading}
        className="mt-1 rounded-xl bg-brand-gradient px-4 py-3 text-sm font-semibold text-white shadow-brand transition hover:-translate-y-0.5 hover:shadow-lift disabled:pointer-events-none disabled:opacity-60"
      >
        {submitLabel}
      </button>

      {mode === 'password' && otpAvailable ? (
        <button
          type="button"
          onClick={() => switchMode('code')}
          className="text-center text-xs font-medium text-ink-2 hover:text-brand"
        >
          Trouble signing in? Get a one-time email code
        </button>
      ) : null}
    </form>
  );
}
