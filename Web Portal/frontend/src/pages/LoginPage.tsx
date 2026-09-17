import { useState } from 'react';
import { Link } from 'react-router-dom';
import { LoginForm } from '../features/auth/LoginForm';
import { createApiClient, ApiError } from '../lib/api-client';
import { useAuthStore, type Session } from '../stores/auth-store';
import logo from '../assets/logo.png';
import logoW from '../assets/logo-w.png';
import { HeroField } from '../components/HeroField';

const api = createApiClient({
  baseUrl: import.meta.env.VITE_API_URL ?? 'http://localhost:4000/api/v1',
  getToken: () => useAuthStore.getState().accessToken,
});

interface AuthResponse {
  data: Session;
}

export function LoginPage() {
  const setSession = useAuthStore((s) => s.setSession);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [codeSent, setCodeSent] = useState(false);

  function fail(e: unknown) {
    if (e instanceof ApiError) {
      setError(e.message);
      setErrorCode(e.code);
    } else {
      setError('Unable to reach the server. Check your connection and try again.');
      setErrorCode(null);
    }
  }

  function clearMessages() {
    setError(null);
    setErrorCode(null);
    setInfo(null);
    setCodeSent(false);
  }

  async function handleLogin(identifier: string, password: string) {
    setLoading(true);
    clearMessages();
    try {
      const res = await api.post<AuthResponse>('/auth/login', { identifier, password });
      setSession(res.data);
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
      await api.post('/auth/otp/request', { identifier });
      setCodeSent(true);
      setInfo('If that account exists, we’ve emailed a one-time code. Enter it below to sign in.');
    } catch (e) {
      fail(e);
    } finally {
      setLoading(false);
    }
  }

  async function handleVerifyCode(identifier: string, code: string) {
    setLoading(true);
    setError(null);
    setErrorCode(null);
    try {
      const res = await api.post<AuthResponse>('/auth/otp/verify', { identifier, code });
      setSession(res.data);
    } catch (e) {
      fail(e);
    } finally {
      setLoading(false);
    }
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
          <img src={logoW} alt="MICO360" className="h-12 w-auto object-contain" />
          <span aria-hidden="true" className="h-8 w-px bg-white/15" />
          <span className="text-[11px] font-semibold uppercase tracking-[0.22em] text-white/50">Task Management</span>
        </div>

        {/* Middle — pitch + feature list + mockup */}
        <div className="relative z-10 grid max-w-xl gap-8">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-white/70">
              <span className="h-1.5 w-1.5 rounded-full bg-brand-3" /> Built for teams
            </span>
            <h1 className="mt-5 font-display text-[2.75rem] font-extrabold leading-[1.05] tracking-tight text-balance">
              Every task,
              <br />
              <span className="bg-gradient-to-r from-brand-3 to-[#e08a6f] bg-clip-text text-transparent">in one board.</span>
            </h1>
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
      <main className="flex min-h-screen items-center justify-center px-6 py-10 sm:px-10">
        <div className="w-full max-w-md">
          <div className="rounded-[1.75rem] border border-line bg-surface p-8 shadow-lift sm:p-9">
            <div className="mb-6 lg:hidden">
              <img src={logo} alt="MICO360 Tasks" className="h-11 w-auto object-contain" />
            </div>

            <h2 className="font-display text-[1.7rem] font-extrabold tracking-tight text-ink">Welcome back</h2>
            <p className="mt-1 text-sm text-ink-2">Sign in to continue to MICO360 Tasks.</p>

            <div className="mt-6">
              <LoginForm
                onSubmit={handleLogin}
                onRequestCode={handleRequestCode}
                onVerifyCode={handleVerifyCode}
                error={error}
                errorCode={errorCode}
                info={info}
                loading={loading}
                codeSent={codeSent}
                onModeChange={clearMessages}
                forgotTo="/forgot"
              />
            </div>

            <p className="mt-6 border-t border-line pt-5 text-center text-[13px] text-ink-2">
              Staff accounts are created by your administrator — need access?{' '}
              <a href="mailto:support@mico360.com" className="font-semibold text-brand hover:underline">Contact your admin.</a>
            </p>
          </div>

          {/* App download badges */}
          <div className="mt-6 flex flex-col items-center gap-3">
            <span className="text-xs font-semibold uppercase tracking-wider text-ink-3">Get the mobile app</span>
            <div className="flex flex-wrap items-center justify-center gap-3">
              <StoreBadge kind="android" />
              <StoreBadge kind="ios" />
            </div>
            <div className="mt-1 flex items-center gap-3 text-xs text-ink-3">
              <Link to="/forgot" className="hover:text-brand">Forgot password?</Link>
              <span aria-hidden="true">·</span>
              <a href="#" className="hover:text-brand">Privacy</a>
              <span aria-hidden="true">·</span>
              <a href="#" className="hover:text-brand">Terms</a>
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

function StoreBadge({ kind }: { kind: 'android' | 'ios' }) {
  const android = kind === 'android';
  return (
    <a
      href="#"
      aria-disabled={!android}
      className={`inline-flex items-center gap-2.5 rounded-xl border px-4 py-2 transition ${
        android
          ? 'border-line bg-ink text-white hover:-translate-y-0.5 hover:shadow-lift'
          : 'cursor-default border-line bg-surface text-ink-3'
      }`}
    >
      <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">
        {android ? (
          <path d="M7.2 6.6l-1-1.7a.4.4 0 01.7-.4l1 1.8a7 7 0 016.2 0l1-1.8a.4.4 0 01.7.4l-1 1.7A6.4 6.4 0 0119 12H5a6.4 6.4 0 012.2-5.4zM9 9.4a.8.8 0 100-1.6.8.8 0 000 1.6zm6 0a.8.8 0 100-1.6.8.8 0 000 1.6zM4.5 13h1.7v6a1.3 1.3 0 01-2.6 0v-6h.9zm14.3 0h.9v6a1.3 1.3 0 01-2.6 0v-6h1.7zM7 13h10v6.2A1.3 1.3 0 0115.7 20H8.3A1.3 1.3 0 017 18.7V13z" />
        ) : (
          <path d="M16.4 12.9c0-2 1.6-3 1.7-3-1-1.4-2.4-1.6-2.9-1.6-1.2-.1-2.4.7-3 .7s-1.6-.7-2.6-.7c-1.3 0-2.6.8-3.3 2-1.4 2.4-.4 6 1 8 .7 1 1.5 2 2.5 2s1.4-.7 2.6-.7 1.5.7 2.6.6c1 0 1.7-1 2.4-2 .5-.7.7-1.4.9-1.5-.1 0-1.9-.7-1.9-2.8zM14.5 6.3c.5-.7.9-1.6.8-2.6-.8 0-1.8.6-2.4 1.3-.5.6-1 1.6-.8 2.5.9.1 1.8-.5 2.4-1.2z" />
        )}
      </svg>
      <span className="text-left leading-tight">
        <span className="block text-[9px] font-medium uppercase tracking-wide opacity-70">{android ? 'Download for' : 'Coming soon on'}</span>
        <span className="block text-sm font-bold">{android ? 'Android (APK)' : 'iOS'}</span>
      </span>
    </a>
  );
}
