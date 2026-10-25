import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { DirectoryUser } from '../../api/users';

/** A titled card section of the meeting page. */
export function Section({
  title,
  count,
  aside,
  children,
  id,
}: {
  title: string;
  count?: ReactNode;
  /** Shown at the end of the title row (a total, a filter, a button). */
  aside?: ReactNode;
  children: ReactNode;
  id?: string;
}) {
  const headingId = id ? `${id}-title` : undefined;
  return (
    <section aria-labelledby={headingId} className="card p-4 sm:p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 id={headingId} className="flex items-baseline gap-2 font-display text-base font-semibold text-ink">
          {title}
          {count !== undefined ? <span className="text-xs font-medium text-ink-3">{count}</span> : null}
        </h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

/** Display name of a directory user (or null when unknown). */
export function userName(dir: DirectoryUser[], id: string | null | undefined): string | null {
  if (!id) return null;
  const u = dir.find((d) => d.id === id);
  return u ? `${u.firstName} ${u.lastName}`.trim() || u.username : null;
}

export function peopleOptions(dir: DirectoryUser[], emptyLabel?: string) {
  const people = dir.map((u) => ({ value: u.id, label: `${u.firstName} ${u.lastName}`.trim() || u.username, hint: `@${u.username}` }));
  return emptyLabel ? [{ value: '', label: emptyLabel }, ...people] : people;
}

/**
 * A ✕ that asks before deleting: the first click turns it into "Delete? [Delete] [Keep]" (focus
 * lands on Keep), so a stray click next to Edit can't remove a note, agenda item or attendee.
 */
export function ConfirmRemoveButton({ label, onConfirm, disabled }: { label: string; onConfirm: () => void; disabled?: boolean }) {
  const [asking, setAsking] = useState(false);
  const keepRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (asking) keepRef.current?.focus();
  }, [asking]);
  if (!asking) {
    return (
      <button
        type="button"
        onClick={() => setAsking(true)}
        disabled={disabled}
        aria-label={label}
        title={label}
        className="grid h-9 w-9 place-items-center rounded-md text-xs text-ink-3 transition-colors hover:bg-danger-soft hover:text-danger disabled:opacity-40 sm:h-8 sm:w-8"
      >
        ✕
      </button>
    );
  }
  return (
    <span
      role="group"
      aria-label={`Confirm: ${label}`}
      className="ml-1 inline-flex items-center gap-1 rounded-md bg-danger-soft px-1.5 py-0.5"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          setAsking(false);
        }
      }}
    >
      <span className="text-xs font-medium text-danger">Delete?</span>
      <button type="button" onClick={() => { setAsking(false); onConfirm(); }} className="min-h-8 rounded bg-danger px-2 text-xs font-semibold text-white hover:brightness-95">
        Delete
      </button>
      <button type="button" ref={keepRef} onClick={() => setAsking(false)} className="min-h-8 rounded px-2 text-xs font-medium text-ink-2 hover:bg-surface">
        Keep
      </button>
    </span>
  );
}

export function LoadError({ what, onRetry }: { what: string; onRetry: () => void }) {
  return (
    <p role="alert" className="text-sm text-danger">
      Couldn’t load {what}.{' '}
      <button type="button" onClick={onRetry} className="font-semibold underline">Retry</button>
    </p>
  );
}

/** A dismissible error banner inside a section. */
export function SectionError({ message, onDismiss }: { message: string | null; onDismiss: () => void }) {
  if (!message) return null;
  return (
    <div role="alert" className="mb-3 flex items-start justify-between gap-2 rounded-lg bg-danger-soft px-3 py-2 text-xs font-medium text-danger">
      <span>{message}</span>
      <button type="button" onClick={onDismiss} aria-label="Dismiss" className="shrink-0 opacity-80 hover:opacity-100">✕</button>
    </div>
  );
}

const ICON = { width: 15, height: 15, fill: 'none', stroke: 'currentColor', strokeWidth: 1.9, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
export const Icon = {
  calendar: <svg viewBox="0 0 24 24" {...ICON} aria-hidden="true"><rect x="3" y="4.5" width="18" height="16" rx="2" /><path d="M3 9.5h18M8 3v3M16 3v3" /></svg>,
  clock: <svg viewBox="0 0 24 24" {...ICON} aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>,
  globe: <svg viewBox="0 0 24 24" {...ICON} aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" /></svg>,
  pin: <svg viewBox="0 0 24 24" {...ICON} aria-hidden="true"><path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z" /><circle cx="12" cy="9.5" r="2.5" /></svg>,
  video: <svg viewBox="0 0 24 24" {...ICON} aria-hidden="true"><rect x="3" y="6" width="13" height="12" rx="2" /><path d="m16 10 5-3v10l-5-3" /></svg>,
  user: <svg viewBox="0 0 24 24" {...ICON} aria-hidden="true"><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></svg>,
  folder: <svg viewBox="0 0 24 24" {...ICON} aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></svg>,
  mail: <svg viewBox="0 0 24 24" {...ICON} aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" /></svg>,
  up: <svg viewBox="0 0 24 24" {...ICON} aria-hidden="true"><path d="m6 15 6-6 6 6" /></svg>,
  down: <svg viewBox="0 0 24 24" {...ICON} aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>,
  edit: <svg viewBox="0 0 24 24" {...ICON} aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16z" /><path d="m13 7 4 4" /></svg>,
  star: (filled: boolean) => (
    <svg viewBox="0 0 24 24" {...ICON} fill={filled ? 'currentColor' : 'none'} aria-hidden="true">
      <path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3 6.4 20.2l1.1-6.2L3 9.6l6.2-.9z" />
    </svg>
  ),
  task: <svg viewBox="0 0 24 24" {...ICON} aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="3" /><path d="m8.5 12 2.5 2.5 4.5-5" /></svg>,
  repeat: <svg viewBox="0 0 24 24" {...ICON} aria-hidden="true"><path d="M17 2l4 4-4 4" /><path d="M3 11V9a3 3 0 0 1 3-3h15" /><path d="M7 22l-4-4 4-4" /><path d="M21 13v2a3 3 0 0 1-3 3H3" /></svg>,
  lock: <svg viewBox="0 0 24 24" {...ICON} aria-hidden="true"><rect x="4.5" y="10.5" width="15" height="10" rx="2" /><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" /></svg>,
  checkCircle: <svg viewBox="0 0 24 24" {...ICON} aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="m8 12.5 2.8 2.8L16.5 9.5" /></svg>,
  chat: <svg viewBox="0 0 24 24" {...ICON} width={26} height={26} strokeWidth={1.7} aria-hidden="true"><path d="M20.5 11.5a8 8 0 0 1-11.7 7.1L3.5 20l1.4-5.1A8 8 0 1 1 20.5 11.5z" /></svg>,
  pause: <svg viewBox="0 0 24 24" {...ICON} width={12} height={12} strokeWidth={2.4} aria-hidden="true"><path d="M9 5v14M15 5v14" /></svg>,
  play: <svg viewBox="0 0 24 24" {...ICON} width={12} height={12} strokeWidth={2.2} aria-hidden="true"><path d="M7 4.5v15l12-7.5z" /></svg>,
};
