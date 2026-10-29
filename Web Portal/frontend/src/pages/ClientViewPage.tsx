import { useCallback, useEffect, useId, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import logo from '../assets/logo.png';
import logoW from '../assets/logo-w.png';
import { clientViewApi, type ClientInspection, type ClientInspectionSummary, type ClientView, type ClientViewApi, type ClientViewItem, type ClientViewMinutes } from '../api/client-view';
import { ClientInspectionBody, revisionLine } from '../components/inspections/ClientInspectionBody';
import { ApiError } from '../lib/api-client';
import { downloadBlob } from '../lib/download';
import { usePageName } from '../lib/page-meta';
import { ProjectAvatar } from '../components/ProjectAvatar';
import { Button } from '../components/ui/Button';
import { fieldClass } from '../components/ui/Field';

/**
 * The client page: someone outside the company follows one shared project, read-only, with no
 * MICO360 account. The address carries a private link; the page opens only with a code emailed to
 * the address it was shared with, and the device then stays signed in for 30 days. It shows the
 * project's progress, its timeline, and only the milestones, tasks and approved meeting minutes
 * marked "Show to client" — never people, comments, files or notes. None of the staff app (its
 * navigation, its sign-in, its API client) is part of it.
 */
export function ClientViewPage() {
  const { token = '' } = useParams();
  const api = useMemo(() => clientViewApi(token), [token]);
  return <ClientViewScreen api={api} />;
}

type Stage =
  | { kind: 'loading' }
  | { kind: 'email' }
  | { kind: 'code'; email: string }
  | { kind: 'ready'; view: ClientView }
  | { kind: 'ended' }
  | { kind: 'failed' };

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "2026-10-01" → "1 Oct 2026" (the day as given: never shifted by the device's zone). */
function dayText(key: string | null): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(key ?? '');
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}` : '';
}

const RESEND_WAIT_SECONDS = 60;

export function ClientViewScreen({ api }: { api: ClientViewApi }) {
  const [stage, setStage] = useState<Stage>({ kind: 'loading' });
  usePageName(stage.kind === 'ready' ? stage.view.project.name : null);

  // The page's address is its private link: never send it on as a referrer.
  useEffect(() => {
    const meta = document.createElement('meta');
    meta.name = 'referrer';
    meta.content = 'no-referrer';
    document.head.appendChild(meta);
    return () => meta.remove();
  }, []);

  const load = useCallback(async () => {
    try {
      setStage({ kind: 'ready', view: await api.view() });
    } catch (err) {
      if (err instanceof ApiError && err.code === 'CLIENT_SIGN_IN') setStage({ kind: 'email' });
      else if (err instanceof ApiError && err.code === 'CLIENT_LINK_ENDED') setStage({ kind: 'ended' });
      else setStage({ kind: 'failed' });
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="flex min-h-screen flex-col bg-ground">
      <a href="#client-main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-surface focus:px-3 focus:py-2 focus:text-sm focus:font-semibold focus:text-brand">
        Skip to the page
      </a>
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          {/* The coloured wordmark on light; the white one in dark mode (as the staff app's sidebar and sign-in do). */}
          <img src={logo} alt="MICO360 Tasks" width={409} height={192} className="h-9 w-auto object-contain dark:hidden" />
          <img src={logoW} alt="MICO360 Tasks" width={409} height={192} className="hidden h-9 w-auto object-contain dark:block" />
          <span className="text-xs font-semibold uppercase tracking-wide text-ink-2">Shared project</span>
        </div>
      </header>

      <main id="client-main" tabIndex={-1} className="mx-auto w-full max-w-4xl flex-1 px-4 py-6 outline-none sm:px-6 sm:py-10">
        {stage.kind === 'loading' ? (
          <p role="status" className="py-16 text-center text-sm text-ink-2">Loading…</p>
        ) : stage.kind === 'email' || stage.kind === 'code' ? (
          <SignIn
            api={api}
            email={stage.kind === 'code' ? stage.email : null}
            onCodeSent={(email) => setStage({ kind: 'code', email })}
            onDifferentEmail={() => setStage({ kind: 'email' })}
            onSignedIn={() => void load()}
          />
        ) : stage.kind === 'ended' ? (
          // One message for every ended link: replaced, removed, or the project archived or deleted.
          <Notice title="This link no longer works">
            <p>If you still need access, ask the person who shared the project with you to send a new one.</p>
          </Notice>
        ) : stage.kind === 'failed' ? (
          <Notice title="Couldn’t load this page">
            <p>Check your connection and try again.</p>
            <div className="mt-4">
              <Button type="button" onClick={() => void load()}>Try again</Button>
            </div>
          </Notice>
        ) : (
          <Project
            view={stage.view}
            api={api}
            onSignedOut={() => setStage({ kind: 'email' })}
          />
        )}
      </main>

      <footer className="border-t border-line bg-surface">
        <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-2 px-4 py-4 text-xs text-ink-2 sm:px-6">
          <span>Shared with you through MICO360 Tasks. Read-only.</span>
          <Link to="/privacy" className="font-semibold text-brand underline-offset-2 hover:underline">Privacy policy</Link>
        </div>
      </footer>
    </div>
  );
}

function Notice({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mx-auto max-w-md rounded-2xl border border-line bg-surface p-6 shadow-soft sm:p-8">
      <h1 className="font-display text-xl font-bold text-ink">{title}</h1>
      <div className="mt-2 text-sm leading-relaxed text-ink-2">{children}</div>
    </div>
  );
}

/** Email first, then the code we emailed — worded so it never says whether the address is on the list. */
function SignIn({
  api,
  email,
  onCodeSent,
  onDifferentEmail,
  onSignedIn,
}: {
  api: ClientViewApi;
  email: string | null;
  onCodeSent: (email: string) => void;
  onDifferentEmail: () => void;
  onSignedIn: () => void;
}) {
  const id = useId();
  const [address, setAddress] = useState(email ?? '');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [resendAt, setResendAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const codeRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!resendAt) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [resendAt]);
  useEffect(() => {
    if (email) codeRef.current?.focus();
  }, [email]);
  const waitLeft = resendAt ? Math.max(0, Math.ceil((resendAt - now) / 1000)) : 0;

  const failure = (err: unknown, fallback: string) =>
    err instanceof ApiError && err.message && !/^Request failed/.test(err.message) ? err.message : fallback;

  async function send(e?: FormEvent) {
    e?.preventDefault();
    const typed = address.trim();
    if (!typed) return setProblem('Enter your email address.');
    setBusy(true);
    setProblem(null);
    try {
      await api.requestCode(typed);
      setResendAt(Date.now() + RESEND_WAIT_SECONDS * 1000);
      setNow(Date.now());
      setCode('');
      onCodeSent(typed);
    } catch (err) {
      setProblem(failure(err, 'Couldn’t send a code. Please try again.'));
    } finally {
      setBusy(false);
    }
  }

  async function verify(e: FormEvent) {
    e.preventDefault();
    if (!email) return;
    setBusy(true);
    setProblem(null);
    try {
      await api.verify(email, code.trim());
      onSignedIn();
    } catch (err) {
      setProblem(failure(err, 'Couldn’t check the code. Please try again.'));
      codeRef.current?.focus();
      codeRef.current?.select();
    } finally {
      setBusy(false);
    }
  }

  const alert = problem ? (
    <p id={`${id}-problem`} role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
      {problem}
    </p>
  ) : null;

  return (
    <div className="mx-auto max-w-md rounded-2xl border border-line bg-surface p-6 shadow-soft sm:p-8">
      {!email ? (
        <form onSubmit={(e) => void send(e)} noValidate className="flex flex-col gap-4">
          <div>
            <h1 className="font-display text-xl font-bold text-ink">View a shared project</h1>
            <p className="mt-1 text-sm leading-relaxed text-ink-2">
              Enter the email address this project was shared with. We’ll email you a one-time code to open it.
            </p>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor={`${id}-email`} className="text-sm font-medium text-ink">Email address</label>
            <input
              id={`${id}-email`}
              type="email"
              autoComplete="email"
              inputMode="email"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              aria-invalid={problem ? true : undefined}
              aria-describedby={problem ? `${id}-problem` : undefined}
              className={fieldClass(Boolean(problem), 'w-full')}
            />
          </div>
          {alert}
          <Button type="submit" loading={busy}>Email me a code</Button>
        </form>
      ) : (
        <form onSubmit={(e) => void verify(e)} noValidate className="flex flex-col gap-4">
          <div>
            <h1 className="font-display text-xl font-bold text-ink">Check your email</h1>
            <p className="mt-1 text-sm leading-relaxed text-ink-2">
              If <span className="font-semibold text-ink">{email}</span> can open this page, we’ve emailed it a 6-digit code. The code lasts 10 minutes.
              Check your spam folder too.
            </p>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor={`${id}-code`} className="text-sm font-medium text-ink">6-digit code</label>
            <input
              ref={codeRef}
              id={`${id}-code`}
              inputMode="numeric"
              autoComplete="one-time-code"
              value={code}
              // Digits only, then six: a code pasted with spaces or a line break (as copied from the
              // email) keeps all its digits (a maxLength would cut the paste before the clean-up).
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              aria-invalid={problem ? true : undefined}
              aria-describedby={problem ? `${id}-problem` : undefined}
              className={fieldClass(Boolean(problem), 'w-full font-mono text-lg')}
            />
          </div>
          {alert}
          <Button type="submit" loading={busy} disabled={code.trim().length < 6}>Open the project</Button>
          <div className="flex flex-wrap justify-between gap-2 text-sm">
            <button type="button" onClick={onDifferentEmail} className="min-h-[2.75rem] font-semibold text-brand underline-offset-2 hover:underline">
              Use a different email
            </button>
            <button
              type="button"
              disabled={busy || waitLeft > 0}
              onClick={() => void send()}
              className="min-h-[2.75rem] font-semibold text-brand underline-offset-2 hover:underline disabled:text-ink-2 disabled:no-underline"
            >
              {waitLeft > 0 ? `Send a new code in ${waitLeft} s` : 'Send a new code'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

const STATUS_TONE: Record<string, string> = {
  Done: 'bg-success-soft text-success',
  'In progress': 'bg-info-soft text-info',
  'In review': 'bg-info-soft text-info',
  'On hold': 'bg-warning-soft text-warning',
  'Not started': 'bg-ground text-ink-2',
  Planning: 'bg-info-soft text-info',
  Completed: 'bg-success-soft text-success',
};

function Status({ label }: { label: string }) {
  return <span className={`inline-flex flex-none items-center rounded-md px-2 py-0.5 text-xs font-semibold ${STATUS_TONE[label] ?? 'bg-ground text-ink-2'}`}>{label}</span>;
}

function Section({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="rounded-2xl border border-line bg-surface p-5 shadow-soft sm:p-6">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 id={id} className="font-display text-base font-bold text-ink">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

function Project({ view, api, onSignedOut }: { view: ClientView; api: ClientViewApi; onSignedOut: () => void }) {
  const { project, progress, timeline } = view;
  const [signingOut, setSigningOut] = useState(false);
  const details = [project.code, project.number ? `Project no. ${project.number}` : null, project.clientName].filter(Boolean) as string[];

  const signOut = async () => {
    setSigningOut(true);
    try {
      await api.signOut();
    } catch {
      /* the session ends with its cookie anyway */
    }
    onSignedOut();
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-start gap-4">
        <ProjectAvatar project={project} size="xl" className="shadow-soft max-sm:h-14 max-sm:w-14" />
        <div className="min-w-0 flex-1">
          <h1 dir="auto" className="break-words font-display text-2xl font-bold text-ink sm:text-3xl">{project.name}</h1>
          {details.length ? (
            <p className="mt-1 flex flex-wrap gap-x-2 text-sm text-ink-2">
              {details.map((d, i) => (
                <span key={i} dir="auto">
                  {i > 0 ? <span aria-hidden="true" className="me-2">·</span> : null}
                  {d}
                </span>
              ))}
            </p>
          ) : null}
          <div className="mt-2">
            <Status label={project.statusLabel} />
          </div>
        </div>
      </div>

      <div className="grid gap-5 md:grid-cols-2">
        <Section title="Progress">
          <p className="font-display text-4xl font-bold text-ink">{progress.percentDone}%</p>
          <p className="text-sm text-ink-2">of the project’s work is done</p>
          <div
            role="progressbar"
            aria-label="Project progress"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progress.percentDone}
            className="mt-3 h-2.5 overflow-hidden rounded-full bg-ground"
          >
            <div className="h-full rounded-full bg-brand" style={{ width: `${progress.percentDone}%` }} />
          </div>
        </Section>

        <Section title="Timeline">
          <TimelineBar start={timeline.startDate} target={timeline.targetDate} today={timeline.today} elapsed={timeline.elapsedPercent} />
        </Section>
      </div>

      <Section title="Milestones">
        <Items items={view.milestones} empty="No milestones have been shared yet." milestone />
      </Section>

      <Section title="Tasks">
        <Items items={view.tasks} empty="No tasks have been shared yet." />
      </Section>

      <Section title="Meeting minutes">
        {view.minutes.length === 0 ? (
          <p className="text-sm text-ink-2">No meeting minutes have been shared yet.</p>
        ) : (
          <div className="flex flex-col gap-3">
            {view.minutes.map((m, i) => (
              <Minutes key={m.id} minutes={m} open={i === 0} api={api} />
            ))}
          </div>
        )}
      </Section>

      {/* Only when there are some: most projects have no inspections, and an empty section would ask why. */}
      {view.inspections?.length ? (
        <Section title="Inspection reports">
          <div className="flex flex-col gap-3">
            {view.inspections.map((x, i) => (
              <InspectionReport key={x.id} report={x} open={i === 0} api={api} />
            ))}
          </div>
        </Section>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-surface px-5 py-3 text-sm text-ink-2">
        <span>
          Signed in on this device as <span className="font-semibold text-ink">{view.viewer.email}</span>
        </span>
        <Button type="button" size="sm" variant="secondary" loading={signingOut} onClick={() => void signOut()}>Sign out</Button>
      </div>
    </div>
  );
}

function TimelineBar({ start, target, today, elapsed }: { start: string | null; target: string | null; today: string; elapsed: number | null }) {
  if (start && target && elapsed !== null) {
    // The "Today" label stays inside the bar's width at either end.
    const shift = elapsed < 15 ? '0%' : elapsed > 85 ? '-100%' : '-50%';
    return (
      <div>
        <div className="relative pt-6">
          <span className="absolute top-0 whitespace-nowrap text-xs font-semibold text-ink" style={{ left: `${elapsed}%`, transform: `translateX(${shift})` }}>
            Today · {dayText(today)}
          </span>
          <div className="relative h-2.5 rounded-full bg-ground">
            <div className="h-full rounded-full bg-brand/60" style={{ width: `${elapsed}%` }} />
            <span aria-hidden="true" className="absolute -top-1.5 h-5 w-1 -translate-x-1/2 rounded-full bg-ink" style={{ left: `${elapsed}%` }} />
          </div>
        </div>
        <dl className="mt-3 flex justify-between gap-3 text-sm">
          <div>
            <dt className="text-xs text-ink-2">Start</dt>
            <dd className="font-semibold text-ink">{dayText(start)}</dd>
          </div>
          <div className="text-end">
            <dt className="text-xs text-ink-2">Target</dt>
            <dd className="font-semibold text-ink">{dayText(target)}</dd>
          </div>
        </dl>
      </div>
    );
  }
  return (
    <dl className="text-sm">
      <dt className="text-xs text-ink-2">Target date</dt>
      <dd className="font-semibold text-ink">{target ? dayText(target) : 'Not set yet'}</dd>
      <dt className="mt-2 text-xs text-ink-2">Today</dt>
      <dd className="font-semibold text-ink">{dayText(today)}</dd>
    </dl>
  );
}

function Items({ items, empty, milestone = false }: { items: ClientViewItem[]; empty: string; milestone?: boolean }) {
  if (items.length === 0) return <p className="text-sm text-ink-2">{empty}</p>;
  return (
    <ul className="divide-y divide-line">
      {items.map((t, i) => (
        <li key={i} className="flex items-start gap-3 py-2.5 first:pt-0 last:pb-0">
          {milestone ? (
            <span aria-hidden="true" className="mt-1.5 block h-2.5 w-2.5 flex-none rotate-45 rounded-[2px] bg-brand" />
          ) : (
            <span aria-hidden="true" className="mt-1.5 block h-2.5 w-2.5 flex-none rounded-full border-2 border-ink-3" />
          )}
          <div className="min-w-0 flex-1">
            <p dir="auto" className="break-words text-sm font-medium text-ink">{t.title}</p>
            <p className="text-xs text-ink-2">{t.dueDate ? `Due ${dayText(t.dueDate)}` : 'No due date'}</p>
          </div>
          <Status label={t.status} />
        </li>
      ))}
    </ul>
  );
}

function Minutes({ minutes: m, open, api }: { minutes: ClientViewMinutes; open: boolean; api: ClientViewApi }) {
  const [expanded, setExpanded] = useState(open);
  const panelId = useId();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const c = m.content;
  const list = (title: string, items: string[]) =>
    items.length ? (
      <div>
        <h4 className="text-sm font-semibold text-ink">{title}</h4>
        <ul className="mt-1 list-disc space-y-0.5 ps-5 text-sm text-ink">
          {items.map((t, i) => (
            <li key={i} dir="auto">{t}</li>
          ))}
        </ul>
      </div>
    ) : null;

  const download = async () => {
    setBusy(true);
    setProblem(null);
    try {
      const { blob, fileName } = await api.minutesPdf(m.id);
      downloadBlob(fileName, blob);
    } catch {
      setProblem('Couldn’t download the minutes. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  // A heading holding the button that opens and closes the minutes (the disclosure pattern): the title
  // stays a heading for screen-reader navigation, and the button says whether it is open.
  return (
    <article className="rounded-xl border border-line">
      <h3 className="text-sm">
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={panelId}
          onClick={() => setExpanded((v) => !v)}
          className="flex min-h-[2.75rem] w-full items-center justify-between gap-3 rounded-xl px-4 py-3 text-start outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
        >
          <span className="min-w-0">
            <span dir="auto" className="block break-words font-semibold text-ink">{m.title}</span>
            <span className="block text-xs font-normal text-ink-2">
              {dayText(m.date)}
              {m.approvedOn ? ` · Approved ${dayText(m.approvedOn)}` : ''}
            </span>
          </span>
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={`flex-none text-ink-2 transition-transform ${expanded ? 'rotate-180' : ''}`}>
            <path d="m6 9 6 6 6-6" />
          </svg>
        </button>
      </h3>
      {expanded ? (
        <div id={panelId} className="flex flex-col gap-3 border-t border-line px-4 py-4">
          {c.summary ? <p dir="auto" className="whitespace-pre-line text-sm text-ink">{c.summary}</p> : null}
          {c.discussion.length ? (
            <div>
              <h4 className="text-sm font-semibold text-ink">Discussion</h4>
              <dl className="mt-1 space-y-2">
                {c.discussion.map((d, i) => (
                  <div key={i}>
                    <dt dir="auto" className="text-sm font-medium text-ink">{d.topic}</dt>
                    <dd dir="auto" className="whitespace-pre-line text-sm text-ink-2">{d.text}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ) : null}
          {list('Decisions', c.decisions)}
          {list('Risks & open issues', c.risks)}
          {list('Next steps', c.nextSteps)}
          {problem ? <p role="alert" className="text-sm text-danger">{problem}</p> : null}
          <div>
            <Button type="button" size="sm" variant="secondary" loading={busy} onClick={() => void download()} aria-label={`Download the minutes of ${m.title} (PDF)`}>
              Download PDF
            </Button>
          </div>
        </div>
      ) : null}
    </article>
  );
}

/**
 * A shown inspection report: listed by its title, day and result; opened, its items and signatures
 * are read (only then), and its PDF downloads (the client copy).
 */
function InspectionReport({ report: x, open, api }: { report: ClientInspectionSummary; open: boolean; api: ClientViewApi }) {
  const [expanded, setExpanded] = useState(open);
  const panelId = useId();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [full, setFull] = useState<ClientInspection | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!expanded || full) return;
    let live = true;
    setLoadFailed(false);
    api.inspection(x.id).then(
      (r) => live && setFull(r),
      () => live && setLoadFailed(true),
    );
    return () => {
      live = false;
    };
  }, [expanded, full, api, x.id, attempt]);
  const revision = revisionLine(x);
  const download = async () => {
    setBusy(true);
    setProblem(null);
    try {
      const { blob, fileName } = await api.inspectionPdf(x.id);
      downloadBlob(fileName, blob);
    } catch {
      setProblem('Couldn’t download the report. Please try again.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <article className="rounded-xl border border-line">
      <h3 className="text-sm">
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={panelId}
          onClick={() => setExpanded((v) => !v)}
          className="flex min-h-[2.75rem] w-full items-center justify-between gap-3 rounded-xl px-4 py-3 text-start outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
        >
          <span className="min-w-0">
            <span dir="auto" className="block break-words font-semibold text-ink">{x.title}</span>
            <span className="block text-xs font-normal text-ink-2">
              {dayText(x.date)}
              {x.place ? ` · ${x.place}` : ''} · {x.result}
            </span>
            {revision ? <span className="block text-xs font-normal text-ink-2">{revision}</span> : null}
          </span>
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={`flex-none text-ink-2 transition-transform ${expanded ? 'rotate-180' : ''}`}>
            <path d="m6 9 6 6 6-6" />
          </svg>
        </button>
      </h3>
      {expanded ? (
        <div id={panelId} className="flex flex-col gap-3 border-t border-line px-4 py-4">
          {full ? (
            <ClientInspectionBody inspection={full} showRevision={false} />
          ) : loadFailed ? (
            <p role="alert" className="flex flex-wrap items-center gap-2 text-sm text-danger">
              Couldn’t load this report. Check your connection and try again.
              <Button type="button" size="sm" variant="secondary" onClick={() => setAttempt((n) => n + 1)}>
                Try again
              </Button>
            </p>
          ) : (
            <p className="text-sm text-ink-2" aria-live="polite">
              Loading the report…
            </p>
          )}
          {problem ? <p role="alert" className="text-sm text-danger">{problem}</p> : null}
          <div>
            <Button type="button" size="sm" variant="secondary" loading={busy} onClick={() => void download()} aria-label={`Download the inspection report ${x.title} (PDF)`}>
              Download PDF
            </Button>
          </div>
        </div>
      ) : null}
    </article>
  );
}
