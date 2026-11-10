import { useId, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { assetUrl } from '../../api/client';
import type { FinalMinutesContent } from '../../api/meetings';
import { NOT_SHARED, type PortalCompany, type PortalResponse } from '../../api/portal';
import { BrandLogo } from '../ui/BrandLogo';
import { buttonClass } from '../ui/Button';
import { dayText } from '../../lib/day-words';
import { usePageName } from '../../lib/page-meta';
import { usePortalPreview } from './portal-context';
import { OVERDUE_CLASS, STATUS_CLASS } from '../../lib/colour-classes';

/**
 * 1.23 Pieces the Client portal's pages share, in the look of the client page (ClientViewPage) the
 * owner approved: white cards on the page ground, plain words, dates like "30 Oct 2026".
 */

/**
 * A touch-sized (44px) control, on every screen: a client may well be on a phone. Important (`!`),
 * as index.css's touch-screen floor for controls (32px) outranks a plain utility.
 */
export const TOUCH = '!min-h-11';

/** Each line (paragraph) of a text takes its own direction and starts on its own side. */
export const OWN_LINES = '[unicode-bidi:plaintext] text-start';

/** "30 Oct 2026" for a 'YYYY-MM-DD' day ('' for none). */
export const day = (key: string | null | undefined) => (key ? dayText(key) : '');

/** "1.2 MB", "340 KB", "512 B": a file's size in words. */
export function sizeWords(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace(/\.0$/, '')} MB`;
}

/**
 * 1.23.7 The tab title names the page (a project, a task, a meeting) — never in a Preview as client, which is
 * shown over an administrator's own page and must leave its title alone.
 */
export function usePortalPageName(name: string | null | undefined): void {
  usePageName(usePortalPreview() ? null : name);
}

/**
 * 1.23.8 one colour scheme: a task's status in the client's words reads like the team's (Not started = To do
 * slate, In progress blue, In review purple, On hold = Blocked red, Done green); a project's and a meeting's
 * words take the nearest (Completed / Held green, Planning / Scheduled blue).
 */
const STATUS_TONE: Record<string, string> = {
  Done: STATUS_CLASS.DONE.chip,
  Completed: STATUS_CLASS.DONE.chip,
  Held: STATUS_CLASS.DONE.chip,
  'In progress': STATUS_CLASS.IN_PROGRESS.chip,
  'In review': STATUS_CLASS.REVIEW.chip,
  Planning: STATUS_CLASS.IN_PROGRESS.chip,
  Scheduled: STATUS_CLASS.IN_PROGRESS.chip,
  Planned: 'bg-ground text-ink-2',
  'On hold': STATUS_CLASS.BLOCKED.chip,
  Cancelled: 'bg-ground text-ink-2 line-through',
  'Not started': STATUS_CLASS.TODO.chip,
};

/** A status in words, coloured by its meaning (the words carry it too). */
export function StatusBadge({ label }: { label: string }) {
  return <span className={`inline-flex flex-none items-center rounded-md px-2 py-0.5 text-xs font-semibold ${STATUS_TONE[label] ?? 'bg-ground text-ink-2'}`}>{label}</span>;
}

export function Chip({ tone = 'neutral', children }: { tone?: 'neutral' | 'danger' | 'success' | 'warning' | 'info' | 'brand' | 'overdue' | 'done'; children: ReactNode }) {
  const tones = {
    neutral: 'bg-ground text-ink-2',
    danger: 'bg-danger-soft text-danger',
    success: 'bg-success-soft text-success',
    warning: 'bg-warning-soft text-warning',
    info: 'bg-info-soft text-info',
    brand: 'bg-brand/10 text-brand',
    // 1.23.8: late work and done work in the one colour scheme.
    overdue: OVERDUE_CLASS.chip,
    done: STATUS_CLASS.DONE.chip,
  } as const;
  return <span className={`inline-flex flex-none items-center rounded-md px-2 py-0.5 text-xs font-semibold ${tones[tone]}`}>{children}</span>;
}

/** The task number (MICO-142), as a small mono chip. */
export function KeyChip({ value }: { value: string }) {
  return <span className="inline-flex flex-none items-center rounded-md border border-line bg-ground px-1.5 py-0.5 font-mono text-[11px] font-semibold text-ink-2">{value}</span>;
}

/** A titled card. */
export function Section({ title, children, aside, as: Heading = 'h2' }: { title: string; children: ReactNode; aside?: ReactNode; as?: 'h2' | 'h3' }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="card card-pad">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <Heading id={id} className="font-display text-base font-bold text-ink">{title}</Heading>
        {aside}
      </div>
      {children}
    </section>
  );
}

/** The project's main company's logo, named for the company; the built-in logo when it has none (or it won't load). */
export function CompanyMark({ company, className = 'h-9' }: { company: PortalCompany | null; className?: string }) {
  const src = company?.logoUrl ? (company.logoUrl.startsWith('/') ? assetUrl(company.logoUrl) : company.logoUrl) : null;
  const [broken, setBroken] = useState<string | null>(null);
  if (!src || broken === src) return <BrandLogo className={className} alt={company?.name ?? 'MICO360'} />;
  return <img src={src} alt={company?.name ?? ''} onError={() => setBroken(src)} className={`${className} w-auto max-w-[10rem] object-contain`} decoding="async" />;
}

/** The share of the work done, as a bar (with its number for a screen reader). */
export function ProgressBar({ percent, label }: { percent: number; label: string }) {
  const value = Math.max(0, Math.min(100, Math.round(percent)));
  return (
    <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={value} className="h-2.5 overflow-hidden rounded-full bg-ground">
      <div className="h-full rounded-full bg-brand" style={{ width: `${value}%` }} />
    </div>
  );
}

/** Start → target, with today on it (as the client page draws it). */
export function TimelineBar({ start, target, today, elapsed }: { start: string | null; target: string | null; today: string; elapsed: number | null }) {
  if (start && target && elapsed !== null) {
    // The "Today" label stays inside the bar's width at either end.
    const shift = elapsed < 15 ? '0%' : elapsed > 85 ? '-100%' : '-50%';
    return (
      <div>
        <div className="relative pt-6">
          <span className="absolute top-0 whitespace-nowrap text-xs font-semibold text-ink" style={{ left: `${elapsed}%`, transform: `translateX(${shift})` }}>
            Today · {day(today)}
          </span>
          <div className="relative h-2.5 rounded-full bg-ground">
            <div className="h-full rounded-full bg-brand/60" style={{ width: `${elapsed}%` }} />
            <span aria-hidden="true" className="absolute -top-1.5 h-5 w-1 -translate-x-1/2 rounded-full bg-ink" style={{ left: `${elapsed}%` }} />
          </div>
        </div>
        <dl className="mt-3 flex justify-between gap-3 text-sm">
          <div>
            <dt className="text-xs text-ink-2">Start</dt>
            <dd className="font-semibold text-ink">{day(start)}</dd>
          </div>
          <div className="text-end">
            <dt className="text-xs text-ink-2">Target</dt>
            <dd className="font-semibold text-ink">{day(target)}</dd>
          </div>
        </dl>
        <p className="mt-2 text-xs text-ink-2">{elapsed}% of the planned time has passed.</p>
      </div>
    );
  }
  return (
    <dl className="grid grid-cols-2 gap-3 text-sm">
      <div>
        <dt className="text-xs text-ink-2">Start</dt>
        <dd className="font-semibold text-ink">{start ? day(start) : 'Not set yet'}</dd>
      </div>
      <div>
        <dt className="text-xs text-ink-2">Target</dt>
        <dd className="font-semibold text-ink">{target ? day(target) : 'Not set yet'}</dd>
      </div>
      <div className="col-span-2">
        <dt className="text-xs text-ink-2">Today</dt>
        <dd className="font-semibold text-ink">{day(today)}</dd>
      </div>
    </dl>
  );
}

/** A friendly card for "you can't see this": never shared, or the access was taken away. */
export function NotShared({ backTo = '/portal', backLabel = 'Back to your projects' }: { backTo?: string; backLabel?: string }) {
  return (
    <div role="alert" className="mx-auto max-w-md rounded-2xl border border-line bg-surface p-6 text-center shadow-soft sm:p-8">
      <h2 className="font-display text-lg font-bold text-ink">{NOT_SHARED}</h2>
      <p className="mt-2 text-sm leading-relaxed text-ink-2">It may have been unshared, or the link is wrong. If you need it, ask the project team.</p>
      <Link to={backTo} className={buttonClass('secondary', 'md', `${TOUCH} mt-4`)}>
        {backLabel}
      </Link>
    </div>
  );
}

/** Waiting for the server, said to a screen reader too. */
export function Loading({ what }: { what: string }) {
  return (
    <p role="status" className="py-12 text-center text-sm text-ink-2">
      <span className="animate-pulse motion-reduce:animate-none">Loading {what}…</span>
    </p>
  );
}

/** A load that failed for another reason (offline, a server error): what failed, and Try again. */
export function LoadFailed({ what, onRetry }: { what: string; onRetry: () => void }) {
  return (
    <div role="alert" className="mx-auto max-w-md rounded-2xl border border-line bg-surface p-6 text-center shadow-soft">
      <p className="font-semibold text-ink">Couldn’t load {what}.</p>
      <p className="mt-1 text-sm text-ink-2">Check your connection and try again.</p>
      <button type="button" onClick={onRetry} className={buttonClass('secondary', 'md', `${TOUCH} mt-4`)}>
        Try again
      </button>
    </div>
  );
}

/** "← Back to …": a link back up, 44px tall. */
export function BackLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link to={to} className={`${TOUCH} inline-flex items-center gap-1.5 text-sm font-semibold text-brand underline-offset-2 hover:underline`}>
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="m15 18-6-6 6-6" />
      </svg>
      {children}
    </Link>
  );
}

/** A meeting invitation's answer, in words. */
export const RESPONSE_WORDS: Record<PortalResponse, string> = {
  PENDING: 'Invited',
  ACCEPTED: 'Going',
  TENTATIVE: 'Maybe',
  DECLINED: 'Not going',
};
export const RESPONSE_TONE: Record<PortalResponse, 'neutral' | 'success' | 'warning' | 'danger' | 'brand'> = {
  PENDING: 'brand',
  ACCEPTED: 'success',
  TENTATIVE: 'warning',
  DECLINED: 'danger',
};

/** The approved minutes' sections (summary, discussion, decisions, risks, next steps). */
export function MinutesBody({ content: c }: { content: FinalMinutesContent }) {
  const list = (title: string, items: string[]) =>
    items.length ? (
      <div>
        <h3 className="text-sm font-semibold text-ink">{title}</h3>
        <ul className="mt-1 list-disc space-y-0.5 ps-5 text-sm text-ink">
          {items.map((t, i) => (
            <li key={i} dir="auto">{t}</li>
          ))}
        </ul>
      </div>
    ) : null;
  const empty = !c.summary && !c.discussion.length && !c.decisions.length && !c.risks.length && !c.nextSteps.length;
  return (
    <div className="flex max-w-[75ch] flex-col gap-3 text-sm">
      {empty ? <p className="text-ink-2">The minutes have no notes.</p> : null}
      {c.summary ? (
        <div>
          <h3 className="text-sm font-semibold text-ink">Summary</h3>
          <p className={`mt-1 whitespace-pre-line text-sm text-ink ${OWN_LINES}`}>{c.summary}</p>
        </div>
      ) : null}
      {c.discussion.length ? (
        <div>
          <h3 className="text-sm font-semibold text-ink">Discussion</h3>
          <dl className="mt-1 space-y-2">
            {c.discussion.map((d, i) => (
              <div key={i}>
                <dt dir="auto" className="text-sm font-medium text-ink">{d.topic}</dt>
                <dd className={`whitespace-pre-line text-sm text-ink-2 ${OWN_LINES}`}>{d.text}</dd>
              </div>
            ))}
          </dl>
        </div>
      ) : null}
      {list('Decisions', c.decisions)}
      {list('Risks & open issues', c.risks)}
      {list('Next steps', c.nextSteps)}
    </div>
  );
}
