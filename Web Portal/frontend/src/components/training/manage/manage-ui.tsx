import { useEffect, useState, type ReactNode } from 'react';
import { ApiError } from '../../../lib/api-client';
import { dayKeyIn, dayText } from '../../../lib/day-words';
import { TOUCH_SQUARE } from '../../../lib/touch';
import { Badge, type BadgeTone } from '../../ui/Badge';
import type { Audience, CertificateStatus, CourseStatus, Difficulty, LessonKind, QuestionKind, RoleKey, TargetKind } from '../../../api/training';
import { tc } from './manage-queries';

// ── Words ────────────────────────────────────────────────────────────────────────────────────────────

export const DIFFICULTY_LABELS: Readonly<Record<Difficulty, string>> = { BEGINNER: 'Beginner', INTERMEDIATE: 'Intermediate', ADVANCED: 'Advanced' };
export const AUDIENCE_LABELS: Readonly<Record<Audience, string>> = { STAFF: 'Staff', CLIENTS: 'Clients' };
export const COURSE_STATUS_LABELS: Readonly<Record<CourseStatus, string>> = { DRAFT: 'Draft', PUBLISHED: 'Published', ARCHIVED: 'Archived' };
export const LESSON_KIND_LABELS: Readonly<Record<LessonKind, string>> = { VIDEO: 'Video', GUIDE: 'Step-by-step guide', DOCUMENT: 'Document', QUIZ: 'Quiz' };
export const QUESTION_KIND_LABELS: Readonly<Record<QuestionKind, string>> = { SINGLE: 'Single choice', MULTIPLE: 'Multiple choice', TRUE_FALSE: 'True or false', ORDER: 'Put in order' };
export const ROLE_LABELS: Readonly<Record<RoleKey, string>> = {
  admins: 'Administrators',
  employees: 'Employees',
  'project-runners': 'People who run a project',
  'training-managers': 'Training managers',
};
export const TARGET_KIND_LABELS: Readonly<Record<TargetKind, string>> = { USER: 'Person', GROUP: 'Group', DEPARTMENT: 'Department', COMPANY: 'Company', PROJECT: 'Project' };
export const CERTIFICATE_STATUS_LABELS: Readonly<Record<CertificateStatus, string>> = { VALID: 'Valid', EXPIRED: 'Expired', REVOKED: 'Revoked' };

/** "1 lesson", "3 lessons". */
export const count = (n: number, one: string, many = `${one}s`): string => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;

/** "45 min", "1 h 30 min". */
export function minutesText(m: number): string {
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest ? `${h} h ${rest} min` : `${h} h`;
}

/** A percentage, or "—" when there is none. */
export const pct = (n: number | null | undefined): string => (n === null || n === undefined ? '—' : `${Math.round(n)}%`);

/** 'YYYY-MM-DD' of today (the device's day). */
export const todayKey = (): string => dayKeyIn(new Date());

/** A day ('YYYY-MM-DD…') as "3 Nov" in this year, else "3 Nov 2026". */
export function dayWords(key: string | null | undefined): string {
  if (!key) return '';
  return dayText(key, { year: key.slice(0, 4) !== todayKey().slice(0, 4) });
}

/** An instant's day (in the site's time zone) as "3 Nov" in this year, else "3 Nov 2026". */
export function instantWords(at: string | null | undefined, timeZone?: string): string {
  if (!at) return '';
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return '';
  return dayWords(dayKeyIn(d, timeZone));
}

/** "2.4 MB", "820 KB". */
export function sizeText(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1).replace(/\.0$/, '')} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} bytes`;
}

/**
 * The server's own words for a refused request (a field's message for a failed check), else `fallback`.
 * Never "Request failed (500)".
 */
export function problemText(err: unknown, fallback = 'Please try again.'): string {
  if (err instanceof ApiError) {
    const details = err.details as { fieldErrors?: Record<string, string[] | undefined>; formErrors?: string[] } | undefined;
    const fieldMessage = details?.fieldErrors ? Object.values(details.fieldErrors).find((m) => m?.length)?.[0] : undefined;
    if (err.code === 'VALIDATION' && /^Invalid input\.?$/.test(err.message)) return fieldMessage ?? details?.formErrors?.[0] ?? fallback;
    if (err.message && !/^Request failed/.test(err.message)) return err.message;
    if (err.status === 403) return 'You don’t have permission to do that.';
    return fallback;
  }
  if (err instanceof TypeError) return 'The server couldn’t be reached. Check your connection and try again.';
  return fallback;
}

export const errorCode = (err: unknown): string | null => (err instanceof ApiError ? err.code : null);

// ── Chips ────────────────────────────────────────────────────────────────────────────────────────────

const STATUS_TONE: Record<CourseStatus, BadgeTone> = { DRAFT: 'neutral', PUBLISHED: 'success', ARCHIVED: 'warning' };
export function CourseStatusChip({ status }: { status: CourseStatus }) {
  return <Badge tone={STATUS_TONE[status]} dot>{COURSE_STATUS_LABELS[status]}</Badge>;
}

const CERT_TONE: Record<CertificateStatus, BadgeTone> = { VALID: 'success', EXPIRED: 'warning', REVOKED: 'danger' };
export function CertificateStatusChip({ status }: { status: CertificateStatus }) {
  return <Badge tone={CERT_TONE[status]} dot>{CERTIFICATE_STATUS_LABELS[status]}</Badge>;
}

// ── Pieces ───────────────────────────────────────────────────────────────────────────────────────────

/** A banner under a form or a list: something went wrong (role alert) or went well (role status). */
export function Notice({ tone = 'error', children }: { tone?: 'error' | 'ok' | 'info'; children: ReactNode }) {
  if (tone === 'error') return <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{children}</p>;
  return <p role="status" className={`rounded-lg px-3 py-2 text-sm ${tone === 'ok' ? 'bg-success-soft text-success' : 'bg-info-soft text-info'}`}>{children}</p>;
}

/** A section card with its heading (h2) and, optionally, actions beside it. */
export function SectionCard({ id, title, actions, children, description }: { id: string; title: string; actions?: ReactNode; description?: ReactNode; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="card card-pad min-w-0">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 id={id} className="font-display text-base font-bold text-ink">{title}</h2>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {description ? <div className="mb-3 text-sm text-ink-2">{description}</div> : null}
      {children}
    </section>
  );
}

/** A small square icon button (44px on a touch screen) with its name as tooltip and accessible name. */
export function IconButton({ label, onClick, disabled, children, tone = 'plain', buttonRef }: { label: string; onClick: () => void; disabled?: boolean; children: ReactNode; tone?: 'plain' | 'danger'; buttonRef?: (el: HTMLButtonElement | null) => void }) {
  return (
    <button
      ref={buttonRef}
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className={`grid h-8 w-8 flex-none place-items-center rounded-lg transition-colors disabled:opacity-40 ${tone === 'danger' ? 'text-ink-2 hover:bg-danger-soft hover:text-danger' : 'text-ink-2 hover:bg-ground hover:text-ink'} ${TOUCH_SQUARE}`}
    >
      {children}
    </button>
  );
}

const ICON = { viewBox: '0 0 24 24', width: 16, height: 16, fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true } as const;
export const Glyph = {
  up: <svg {...ICON}><path d="m18 15-6-6-6 6" /></svg>,
  down: <svg {...ICON}><path d="m6 9 6 6 6-6" /></svg>,
  trash: <svg {...ICON}><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" /></svg>,
  plus: <svg {...ICON}><path d="M12 5v14M5 12h14" /></svg>,
  edit: <svg {...ICON}><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" /></svg>,
  close: <svg {...ICON}><path d="M18 6 6 18M6 6l12 12" /></svg>,
  video: <svg {...ICON}><rect x="2" y="5" width="15" height="14" rx="2" /><path d="m17 10 5-3v10l-5-3" /></svg>,
  guide: <svg {...ICON}><path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01" /></svg>,
  document: <svg {...ICON}><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" /><path d="M14 3v6h6" /></svg>,
  quiz: <svg {...ICON}><circle cx="12" cy="12" r="9" /><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01" /></svg>,
  download: <svg {...ICON}><path d="M12 3v12M7 10l5 5 5-5M5 21h14" /></svg>,
  star: <svg {...ICON} fill="currentColor" stroke="none"><path d="m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z" /></svg>,
  starEmpty: <svg {...ICON}><path d="m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z" /></svg>,
  back: <svg {...ICON}><path d="m15 18-6-6 6-6" /></svg>,
};
export const LESSON_GLYPH: Record<LessonKind, ReactNode> = { VIDEO: Glyph.video, GUIDE: Glyph.guide, DOCUMENT: Glyph.document, QUIZ: Glyph.quiz };

/** 1–5 stars, read as "4 of 5 stars". */
export function Stars({ value }: { value: number }) {
  const n = Math.max(0, Math.min(5, Math.round(value)));
  return (
    <span role="img" aria-label={`${n} of 5 stars`} className="inline-flex items-center gap-0.5 text-brand">
      {[1, 2, 3, 4, 5].map((i) => <span key={i}>{i <= n ? Glyph.star : Glyph.starEmpty}</span>)}
    </span>
  );
}

// ── Training files (private: fetched with the session, shown from an object URL) ────────────────────────

/** An object URL for a training file (a picture), revoked when it changes or the component goes. */
export function useTrainingFileUrl(fileId: string | null | undefined): { url: string | null; failed: boolean } {
  const [state, setState] = useState<{ id: string | null; url: string | null; failed: boolean }>({ id: null, url: null, failed: false });
  useEffect(() => {
    if (!fileId) return;
    let alive = true;
    let made: string | null = null;
    tc()
      .file(fileId)
      .then((blob) => {
        if (!alive) return;
        made = typeof URL.createObjectURL === 'function' ? URL.createObjectURL(blob) : null;
        setState({ id: fileId, url: made, failed: !made });
      })
      .catch(() => alive && setState({ id: fileId, url: null, failed: true }));
    return () => {
      alive = false;
      if (made && typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(made);
    };
  }, [fileId]);
  return fileId && state.id === fileId ? { url: state.url, failed: state.failed } : { url: null, failed: false };
}

/** A training picture (a guide step's, a signature) with its alt text. */
export function TrainingPicture({ fileId, alt, className = '' }: { fileId: string; alt: string; className?: string }) {
  const { url, failed } = useTrainingFileUrl(fileId);
  if (failed) return <p className="rounded-lg bg-ground px-3 py-2 text-xs text-ink-2">The picture couldn’t be shown.</p>;
  if (!url) return <div className={`skeleton rounded-lg ${className}`} aria-hidden="true" />;
  return <img src={url} alt={alt} className={`rounded-lg border border-line object-contain ${className}`} />;
}

/** A filter above a list: its small label over the control (never wrapped around it). */
export function FilterField({ label, htmlFor, className = '', children }: { label: string; htmlFor: string; className?: string; children: ReactNode }) {
  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      <label htmlFor={htmlFor} className="text-xs font-medium text-ink-2">{label}</label>
      {children}
    </div>
  );
}
