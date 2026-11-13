import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../api/client';
import { configApi } from '../api/config';
import { androidAppLink, checkHostedApk } from '../lib/android-app-link';
import { LoginForm } from '../features/auth/LoginForm';
import { createApiClient, ApiError } from '../lib/api-client';
import { useAuthStore, type Session } from '../stores/auth-store';
import { askedTooSoon, forgetCodeStep, NEW_CODE_SENT, recallCodeStep, rememberCodeStep, RESEND_AFTER_MS, waitFromAnswer, type CodeAnswer, type CodeStep } from '../lib/login-code-step';
import logoW from '../assets/logo-w.png';
import { HeroField } from '../components/HeroField';
import { BrandLogo } from '../components/ui/BrandLogo';
import { EmailCheckStep } from '../features/auth/EmailCheckStep';
import { ChoosePasswordStep } from '../features/auth/ChoosePasswordStep';
import type { ChallengeResend, SignInChallenge } from '../api/auth';

const api = createApiClient({
  baseUrl: import.meta.env.VITE_API_URL ?? 'http://localhost:4000/api/v1',
  getToken: () => useAuthStore.getState().accessToken,
});

interface AuthResponse {
  data: Session;
}

/** 1.23.6: a temporary password signs in only as far as "Choose your own password" (a step ticket). */
interface PasswordStep {
  ticket: string;
  expiresAt: string;
}

/**
 * Onboarding: a password sign-in answers with a session, or (an unconfirmed email address) the code step,
 * or (1.23.6, a temporary password) the "Choose your own password" step.
 */
interface SignInResponse {
  data: Session | { challenge: SignInChallenge } | { changePassword: PasswordStep };
}
/** The code steps answer with a session or (a temporary password) the "Choose your own password" step. */
interface StepResponse {
  data: Session | { changePassword: PasswordStep };
}

/** The answer to "email me a code": `sent: false` when the same address asked less than a minute ago. */
interface CodeRequestResponse {
  data?: CodeAnswer;
}

// Said alike for every address, so it never tells whether an account exists.
const CODE_SENT = 'If that account exists, we’ve emailed it a one-time code. Check your inbox — and your spam folder.';

export function LoginPage() {
  const setSession = useAuthStore((s) => s.setSession);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [lockedForSeconds, setLockedForSeconds] = useState<number | null>(null);
  // Public config: when outbound email isn't set up, don't offer "email me a code" (it can't be sent).
  const configQ = useQuery({ queryKey: ['app-config'], queryFn: () => configApi(apiClient).get(), staleTime: Infinity, refetchOnWindowFocus: false });
  // Offered only once the server has said email works: shown first and then removed, the "Email code"
  // tab made the form jump (and stayed for good when the answer never came).
  const emailEnabled = configQ.data?.emailEnabled === true;
  // A reset link is emailed too. Known to be off: say who can help instead. Unknown (the server did
  // not answer): keep the link — the reset page explains if it cannot send.
  const emailOff = configQ.data?.emailEnabled === false;
  const canReset = emailEnabled || configQ.isError;
  // "Download for Android" (in the footer row since 13 Nov: Install App comes first): the APK this site
  // hosts at its own, unchanging address (or an address the administrator configured). A hosted file
  // the site does not have would be a link that fails, so the site is asked first and the link is left
  // out when it has none; until it answers, the link is offered.
  const androidLink = androidAppLink(configQ.data?.androidAppUrl);
  const apkQ = useQuery({
    queryKey: ['android-apk', androidLink.href],
    queryFn: () => checkHostedApk(androidLink.href),
    enabled: androidLink.hosted,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
  const androidAvailable = !androidLink.hosted || apkQ.data !== false;
  // A reload on the "Email code" step comes back to it (remembered for this browser tab only).
  const [resumed] = useState<CodeStep | null>(() => recallCodeStep());
  const [info, setInfo] = useState<string | null>(resumed ? CODE_SENT : null);
  const [loading, setLoading] = useState(false);
  const [codeSent, setCodeSent] = useState(resumed !== null);
  /** When another code may be asked for: as the server said (asked too soon), or as remembered. */
  const [waitUntil, setWaitUntil] = useState<number | null>(resumed?.resendAt ?? null);
  // Back on a remembered code step, it stays usable while the server hasn't said yet whether email works.
  const otpOn = emailEnabled || (resumed !== null && configQ.data === undefined);
  // Onboarding: "Check your email" — the code step after the right password (kept in memory only), and
  // the "Keep me signed in" choice made on the password step.
  const [challenge, setChallenge] = useState<SignInChallenge | null>(null);
  const [keepChoice, setKeepChoice] = useState(true);
  // 1.23.6: "Choose your own password" after a temporary one (the step ticket, in memory only).
  const [passwordStep, setPasswordStep] = useState<PasswordStep | null>(null);

  function fail(e: unknown) {
    setLockedForSeconds(null);
    if (e instanceof ApiError) {
      if (e.code === 'EMAIL_NOT_CONFIGURED') {
        setError(e.message || 'Email sign-in codes aren’t available right now. Sign in with your password instead.');
        setErrorCode(e.code);
        return;
      }
      setError(e.message);
      setErrorCode(e.code);
      const retry = (e.details as { retryAfterSeconds?: unknown } | undefined)?.retryAfterSeconds;
      if (e.code === 'ACCOUNT_LOCKED' && typeof retry === 'number') setLockedForSeconds(retry);
    } else {
      setError('Unable to reach the server. Check your connection and try again.');
      setErrorCode(null);
    }
  }

  function clearMessages() {
    setError(null);
    setErrorCode(null);
    setLockedForSeconds(null);
    setInfo(null);
    setCodeSent(false);
    setWaitUntil(null);
    forgetCodeStep();
  }

  async function handleLogin(identifier: string, password: string, keepSignedIn = true) {
    setLoading(true);
    clearMessages();
    try {
      // Onboarding: this page can take the emailed-code step and (1.23.6) the "Choose your own password"
      // step after a temporary password (the app and the extension can't, yet).
      const res = await api.post<SignInResponse>('/auth/login', { identifier, password, acceptChallenge: true, acceptPasswordChange: true });
      if ('challenge' in res.data) {
        setKeepChoice(keepSignedIn);
        setChallenge(res.data.challenge);
        return;
      }
      if ('changePassword' in res.data) {
        setKeepChoice(keepSignedIn);
        setPasswordStep(res.data.changePassword);
        return;
      }
      // Unticked "Keep me signed in" → the session lives only in this window (sessionStorage).
      setSession(res.data, { remember: keepSignedIn });
    } catch (e) {
      fail(e);
    } finally {
      setLoading(false);
    }
  }

  async function handleRequestCode(identifier: string) {
    setLoading(true);
    setError(null);
    setErrorCode(null);
    try {
      const res = await api.post<CodeRequestResponse>('/auth/otp/request', { identifier });
      const wait = waitFromAnswer(res?.data);
      if (wait !== null) {
        // Nothing was sent: say so, and wait as long as the server asks. The code sent before still works.
        const at = Date.now() + wait * 1000;
        setInfo(askedTooSoon(wait));
        setWaitUntil(at);
        rememberCodeStep({ identifier, resendAt: at });
      } else {
        // A new code replaces the one before it (the server stops accepting the old one).
        setInfo(codeSent ? NEW_CODE_SENT : CODE_SENT);
        setWaitUntil(null);
        rememberCodeStep({ identifier, resendAt: Date.now() + RESEND_AFTER_MS });
      }
      setCodeSent(true);
    } catch (e) {
      fail(e);
    } finally {
      setLoading(false);
    }
  }

  async function handleVerifyCode(identifier: string, code: string, keepSignedIn = true) {
    setLoading(true);
    setError(null);
    setErrorCode(null);
    try {
      const res = await api.post<StepResponse>('/auth/otp/verify', { identifier, code, acceptPasswordChange: true });
      forgetCodeStep();
      if ('changePassword' in res.data) {
        setKeepChoice(keepSignedIn);
        setPasswordStep(res.data.changePassword);
        return;
      }
      setSession(res.data, { remember: keepSignedIn });
    } catch (e) {
      fail(e);
    } finally {
      setLoading(false);
    }
  }

  async function verifyChallenge(code: string) {
    if (!challenge) return;
    const res = await api.post<StepResponse>('/auth/challenge/verify', { challenge: challenge.token, code, acceptPasswordChange: true });
    setChallenge(null);
    if ('changePassword' in res.data) {
      setPasswordStep(res.data.changePassword);
      return;
    }
    setSession(res.data, { remember: keepChoice });
  }

  /** 1.23.6: their own password in place of the temporary one; then the session. */
  async function choosePassword(password: string) {
    if (!passwordStep) return;
    const res = await api.post<AuthResponse>('/auth/password/first-change', { ticket: passwordStep.ticket, password });
    setPasswordStep(null);
    setSession(res.data, { remember: keepChoice });
  }

  function leavePasswordStep(reason?: string) {
    setPasswordStep(null);
    clearMessages();
    if (reason) setError(reason);
  }

  async function resendChallenge(): Promise<ChallengeResend> {
    const res = await api.post<{ data: ChallengeResend }>('/auth/challenge/resend', { challenge: challenge?.token ?? '' });
    return res.data;
  }

  function leaveChallenge(reason?: string) {
    setChallenge(null);
    clearMessages();
    if (reason) setError(reason);
  }

  return (
    <div className="grid min-h-screen bg-ground lg:grid-cols-[1.08fr_1fr]">
      {/* ── Brand hero (dark, premium) — hidden on small screens ────────────── */}
      <aside className="relative hidden overflow-hidden bg-[#160b0b] px-14 py-12 text-white lg:flex lg:min-h-screen lg:flex-col lg:justify-between">
        {/* Ambient glow + concentric rings + dotted texture */}
        <div aria-hidden="true" className="pointer-events-none absolute -right-40 -top-40 h-[34rem] w-[34rem] rounded-full bg-brand/25 blur-[120px]" />
        <div aria-hidden="true" className="pointer-events-none absolute right-[-12rem] top-[-6rem] h-[40rem] w-[40rem] rounded-full border border-white/5" />
        <div aria-hidden="true" className="pointer-events-none absolute right-[-6rem] top-[2rem] h-[28rem] w-[28rem] rounded-full border border-white/5" />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 opacity-[0.35]"
          style={{ backgroundImage: 'radial-gradient(rgba(255,255,255,0.06) 1px, transparent 1px)', backgroundSize: '22px 22px' }}
        />

        {/* Floating task-icon physics field (gravity + cursor scatter) */}
        <HeroField />

        {/* Brand chip — the white logo carries the MICO360 wordmark; a small tagline gives product context. */}
        <div className="relative z-10 flex items-center gap-4">
          {/* Above the fold: fetched at once (a lazy image is left out of the browser's early scan). */}
          <img src={logoW} alt="MICO360" width={409} height={192} decoding="async" className="h-12 w-auto object-contain" />
          <span aria-hidden="true" className="h-8 w-px bg-white/15" />
          <span className="text-[11px] font-semibold uppercase tracking-[0.22em] text-white/50">Task Management</span>
        </div>

        {/* Middle — pitch + feature list + mockup */}
        <div className="relative z-10 grid max-w-xl gap-8">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-white/70">
              <span className="h-1.5 w-1.5 rounded-full bg-brand-3" /> Built for teams
            </span>
            <h2 className="mt-5 font-display text-[2.75rem] font-extrabold leading-[1.05] tracking-tight text-balance">
              Every task,
              <br />
              <span className="bg-gradient-to-r from-brand-3 to-[#e08a6f] bg-clip-text text-transparent">in one board.</span>
            </h2>
            <p className="mt-4 max-w-md text-[15px] leading-relaxed text-white/65">
              From a quick capture to a shipped sprint. Kanban boards move themselves, teammates stay in sync in real time,
              and nothing slips without a trail.
            </p>
            <ul className="mt-6 grid gap-3 text-sm text-white/85">
              <li className="flex items-center gap-3"><Check /> Drag-and-drop Kanban with live, cross-device sync</li>
              <li className="flex items-center gap-3"><Check /> Assign teammates, checklists, comments &amp; @mentions</li>
              <li className="flex items-center gap-3"><Check /> Deadline reminders, reports and a full audit trail</li>
            </ul>
          </div>

          <BoardMock />
        </div>

        {/* Footer stat trio */}
        <div className="relative z-10">
          <div className="grid max-w-lg grid-cols-3 gap-6 border-t border-white/10 pt-6">
            <Stat title="Real-time" sub="Live board sync" />
            <Stat title="Cross-platform" sub="Web · Mobile · Extension" />
            <Stat title="Audit-logged" sub="Every change tracked" />
          </div>
          <p className="mt-6 text-xs text-white/35">© {new Date().getFullYear()} MICO360-Softwares · MICO360 Tasks</p>
        </div>
      </aside>

      {/* ── Form card ───────────────────────────────────────────────────────── */}
      <main className="flex min-h-screen items-center justify-center px-4 py-10 sm:px-10">
        <div className="w-full max-w-md">
          <div className="rounded-[1.75rem] border border-line bg-surface p-6 shadow-lift sm:p-9">
            {/* The logo in this theme's colours (the dark-lettered one vanished on the dark card). */}
            <div className="mb-6 flex lg:hidden">
              <BrandLogo className="h-11" alt="MICO360 Tasks" />
            </div>

            {passwordStep ? (
              <>
                <h1 className="font-display text-[1.7rem] font-extrabold tracking-tight text-ink">Choose your own password</h1>
                <p className="mt-1 text-sm text-ink-2">
                  You signed in with a temporary password. Choose your own now — you’ll use it from here on, on the website, the app and the extension.
                </p>
                <div className="mt-6">
                  <ChoosePasswordStep key={passwordStep.ticket} onSubmit={choosePassword} onBack={leavePasswordStep} />
                </div>
              </>
            ) : challenge ? (
              <>
                <h1 className="font-display text-[1.7rem] font-extrabold tracking-tight text-ink">Check your email</h1>
                <p className="mt-1 text-sm text-ink-2">
                  Enter the 6-digit code we sent to <bdi className="font-semibold text-ink">{challenge.sentTo}</bdi> to confirm it’s your email address.
                </p>
                <div className="mt-6">
                  <EmailCheckStep key={challenge.token} challenge={challenge} onVerify={verifyChallenge} onResend={resendChallenge} onBack={leaveChallenge} />
                </div>
              </>
            ) : (
            <>
            <h1 className="font-display text-[1.7rem] font-extrabold tracking-tight text-ink">Welcome back</h1>
            <p className="mt-1 text-sm text-ink-2">Sign in to continue to MICO360 Tasks.</p>

            <div className="mt-6">
              <LoginForm
                onSubmit={handleLogin}
                onRequestCode={otpOn ? handleRequestCode : undefined}
                onVerifyCode={otpOn ? handleVerifyCode : undefined}
                error={error}
                errorCode={errorCode}
                lockedForSeconds={lockedForSeconds}
                info={info}
                loading={loading}
                codeSent={codeSent}
                resume={resumed}
                waitUntil={waitUntil}
                onModeChange={clearMessages}
                forgotTo={canReset ? '/forgot' : undefined}
                canResetByEmail={!emailOff}
              />
            </div>
            </>
            )}

            <p className="mt-6 border-t border-line pt-5 text-center text-[13px] text-ink-2">
              Staff accounts are created by your administrator — need access?{' '}
              <a href="mailto:info@mico360.com" className="font-semibold text-brand hover:underline">Contact your admin.</a>
            </p>
          </div>

          {/* The quiet links. The store badges went on 13 Nov (owner, P1): the website installs as an
              app, and the Android APK is a plain link here and on About. */}
          <div className="mt-6 flex flex-col items-center gap-3">
            <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-xs text-ink-3">
              {canReset ? (
                <>
                  <Link to="/forgot" className="tap hover:text-brand">Forgot password?</Link>
                  <span aria-hidden="true">·</span>
                </>
              ) : null}
              <Link to="/privacy" className="tap hover:text-brand">Privacy</Link>
              <span aria-hidden="true">·</span>
              <Link to="/terms" className="tap hover:text-brand">Terms</Link>
              {androidAvailable ? (
                <>
                  <span aria-hidden="true">·</span>
                  <a
                    href={androidLink.href}
                    {...(androidLink.hosted ? { download: 'MICO360-Tasks.apk' } : { target: '_blank', rel: 'noopener noreferrer' })}
                    title={androidLink.hosted ? 'The MICO360 Tasks app for Android phones (an .apk file to install)' : 'The MICO360 Tasks app for Android phones'}
                    className="tap hover:text-brand"
                  >
                    Download for Android
                  </a>
                </>
              ) : null}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

function Check() {
  return (
    <span aria-hidden="true" className="inline-flex h-5 w-5 flex-none items-center justify-center rounded-md bg-brand-3/25 text-brand-3">
      <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
        <path d="M5 12.5l4 4 10-11" />
      </svg>
    </span>
  );
}

function Stat({ title, sub }: { title: string; sub: string }) {
  return (
    <div>
      <div className="text-sm font-bold text-white">{title}</div>
      <div className="mt-0.5 text-[11px] leading-tight text-white/45">{sub}</div>
    </div>
  );
}

/** A small decorative Kanban preview for the hero. */
function BoardMock() {
  const cols: { name: string; tint: string; cards: { t: string; tag?: string }[] }[] = [
    { name: 'To do', tint: 'bg-white/10', cards: [{ t: 'Draft Q3 roadmap', tag: 'HIGH' }, { t: 'Vendor onboarding' }] },
    { name: 'In progress', tint: 'bg-brand-3/30', cards: [{ t: 'Board realtime sync' }, { t: 'Push reminders', tag: 'DUE' }] },
    { name: 'Done', tint: 'bg-[#1f7a5a]/40', cards: [{ t: 'Login redesign' }] },
  ];
  return (
    <div aria-hidden="true" className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 shadow-lift backdrop-blur">
      <div className="mb-3 flex items-center gap-2">
        <span className="h-2.5 w-2.5 rounded-full bg-[#e05a4a]" />
        <span className="h-2.5 w-2.5 rounded-full bg-[#e0a23a]" />
        <span className="h-2.5 w-2.5 rounded-full bg-[#3aa06a]" />
        <span className="ml-2 text-[11px] font-semibold text-white/50">MICO — Sprint board</span>
      </div>
      <div className="grid grid-cols-3 gap-3">
        {cols.map((col) => (
          <div key={col.name} className="rounded-xl bg-black/20 p-2">
            <div className="mb-2 flex items-center gap-1.5 px-1">
              <span className={`h-2 w-2 rounded-full ${col.tint}`} />
              <span className="text-[10px] font-semibold uppercase tracking-wide text-white/50">{col.name}</span>
            </div>
            <div className="grid gap-2">
              {col.cards.map((card) => (
                <div key={card.t} className="rounded-lg bg-white/[0.07] p-2">
                  <div className="text-[11px] font-medium leading-snug text-white/85">{card.t}</div>
                  {card.tag ? (
                    <span className="mt-1.5 inline-block rounded bg-brand-3/25 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-brand-3">
                      {card.tag}
                    </span>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
