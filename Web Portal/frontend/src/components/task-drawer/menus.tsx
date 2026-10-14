import { useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * A small popup menu's open state: Escape closes it (and only it — not the drawer around it) and
 * returns focus to its button; a click anywhere else closes it too. Native listeners: the drawer's
 * own Escape handler is a native listener on an element around this one.
 */
export function useMenu() {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const el = wrap.current;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      setOpen(false);
      trigger.current?.focus();
    };
    const onDown = (e: MouseEvent) => {
      if (el && !el.contains(e.target as Node)) setOpen(false);
    };
    el?.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => {
      el?.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
    };
  }, [open]);
  return { open, setOpen, wrap, trigger };
}

const ICON = { width: 14, height: 14, fill: 'none', stroke: 'currentColor', strokeWidth: 1.9, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
export const DownloadIcon = () => (
  <svg viewBox="0 0 24 24" {...ICON} aria-hidden="true">
    <path d="M12 3v12M7 10l5 5 5-5M5 21h14" />
  </svg>
);
export const EyeIcon = ({ filled }: { filled?: boolean }) => (
  <svg viewBox="0 0 24 24" {...ICON} fill={filled ? 'currentColor' : 'none'} aria-hidden="true">
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
    <circle cx="12" cy="12" r="3" fill={filled ? 'rgb(var(--c-surface))' : 'none'} />
  </svg>
);

const menuItemClass = 'flex w-full items-center gap-2 px-3 py-2 text-start text-sm text-ink hover:bg-ground focus-visible:bg-ground sm:py-1.5 sm:text-xs';
const headerButtonClass =
  'inline-flex h-9 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium transition-colors sm:h-8';

/** "Export" in the header: download the task as Excel or PDF. */
export function ExportMenu({ onExport, className = '' }: { onExport: (format: 'xlsx' | 'pdf') => Promise<void>; className?: string }) {
  const { open, setOpen, wrap, trigger } = useMenu();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  async function run(format: 'xlsx' | 'pdf') {
    setOpen(false);
    setBusy(true);
    setFailed(false);
    try {
      await onExport(format);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className={`relative ${className}`} ref={wrap}>
      <button
        ref={trigger}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={busy}
        title={failed ? 'Couldn’t export the task. Try again.' : 'Download this task as Excel or PDF'}
        className={`${headerButtonClass} ${failed ? 'border-danger/40 text-danger' : 'border-line text-ink-2 hover:border-brand hover:text-brand'}`}
      >
        <DownloadIcon />
        {busy ? 'Exporting…' : failed ? 'Export failed' : 'Export'}
      </button>
      {open ? (
        <div role="menu" className="absolute right-0 top-full z-30 mt-1 w-44 overflow-hidden rounded-lg border border-line bg-surface py-1 shadow-lift">
          <button role="menuitem" type="button" onClick={() => void run('xlsx')} className={menuItemClass}>
            Excel (.xlsx)
          </button>
          <button role="menuitem" type="button" onClick={() => void run('pdf')} className={menuItemClass}>
            PDF
          </button>
        </div>
      ) : null}
    </div>
  );
}

/** "Watch" in the header: follow the task's updates. */
export function WatchButton({ watching, count, onToggle, className = '' }: { watching: boolean; count?: number; onToggle: () => void; className?: string }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={watching}
      title={watching ? 'Stop watching this task' : 'Watch this task for updates'}
      className={`${headerButtonClass} ${watching ? 'border-brand/40 bg-brand/10 text-brand' : 'border-line text-ink-2 hover:border-brand hover:text-brand'} ${className}`}
    >
      <EyeIcon filled={watching} />
      {watching ? 'Watching' : 'Watch'}
      {count ? <span className="tabular-nums">{count}</span> : null}
    </button>
  );
}

/** "⋯ More actions": the header's secondary actions in one menu (the only way to them on small screens). */
export function MoreActionsMenu({
  watching,
  onToggleWatch,
  onExport,
  className = '',
}: {
  watching?: boolean;
  onToggleWatch?: () => void;
  onExport?: (format: 'xlsx' | 'pdf') => Promise<void>;
  className?: string;
}) {
  const { open, setOpen, wrap, trigger } = useMenu();
  if (!onToggleWatch && !onExport) return null;
  const item = (label: string, act: () => void, icon: ReactNode) => (
    <button
      role="menuitem"
      type="button"
      onClick={() => {
        setOpen(false);
        act();
      }}
      className={menuItemClass}
    >
      {icon}
      {label}
    </button>
  );
  return (
    <div className={`relative ${className}`} ref={wrap}>
      <button
        ref={trigger}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="More actions"
        title="More actions"
        className="grid h-9 w-9 place-items-center rounded-lg border border-line text-ink-2 transition-colors hover:border-brand hover:text-brand"
      >
        <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
          <circle cx="5" cy="12" r="1.8" />
          <circle cx="12" cy="12" r="1.8" />
          <circle cx="19" cy="12" r="1.8" />
        </svg>
      </button>
      {open ? (
        <div role="menu" aria-label="More actions" className="absolute right-0 top-full z-30 mt-1 w-52 overflow-hidden rounded-lg border border-line bg-surface py-1 shadow-lift">
          {onToggleWatch ? item(watching ? 'Stop watching' : 'Watch this task', onToggleWatch, <EyeIcon filled={watching} />) : null}
          {onExport ? item('Export as Excel', () => void onExport('xlsx').catch(() => {}), <DownloadIcon />) : null}
          {onExport ? item('Export as PDF', () => void onExport('pdf').catch(() => {}), <DownloadIcon />) : null}
        </div>
      ) : null}
    </div>
  );
}
