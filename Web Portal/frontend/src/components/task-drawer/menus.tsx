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
  'inline-flex h-9 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium transition-colors sm:h-8 [@media(pointer:coarse)]:h-11';

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

export const MoveIcon = () => (
  <svg viewBox="0 0 24 24" {...ICON} aria-hidden="true">
    <path d="M3 7h13M12 3l4 4-4 4M21 17H8M12 13l-4 4 4 4" />
  </svg>
);

export const TemplateIcon = () => (
  <svg viewBox="0 0 24 24" {...ICON} aria-hidden="true">
    <rect x="6" y="3" width="15" height="14" rx="2" />
    <path d="M3 7v11a3 3 0 0 0 3 3h11M13.5 7v6M10.5 10h6" />
  </svg>
);

/**
 * "⋯ More actions": the header's secondary actions in one menu. Watching and exporting have header
 * buttons on wider screens, so the menu is the way to them on small ones; moving the task to another
 * project and saving it as a template live only here, so with either the menu shows on every screen.
 * Unavailable, the move says why. Choosing an item gives focus back to the menu button (a dialog it
 * opens returns focus there).
 */
export function MoreActionsMenu({
  watching,
  onToggleWatch,
  onExport,
  onMoveToProject,
  moveUnavailable,
  onSaveAsTemplate,
  className = '',
}: {
  watching?: boolean;
  onToggleWatch?: () => void;
  onExport?: (format: 'xlsx' | 'pdf') => Promise<void>;
  /** Move the task to another project ("Move to another project…"). */
  onMoveToProject?: () => void;
  /** Why it can't be moved now (the item is shown, unavailable, with this reason). */
  moveUnavailable?: string | null;
  /** Save the task as a task template ("Save as template…": whoever runs its project). */
  onSaveAsTemplate?: () => void;
  className?: string;
}) {
  const { open, setOpen, wrap, trigger } = useMenu();
  if (!onToggleWatch && !onExport && !onMoveToProject && !onSaveAsTemplate) return null;
  // With the move or the template in it, the menu shows everywhere and these repeat header buttons on wider screens.
  const headerToo = onMoveToProject || onSaveAsTemplate ? 'sm:hidden' : '';
  const choose = (act: () => void) => {
    setOpen(false);
    trigger.current?.focus();
    act();
  };
  const item = (label: string, act: () => void, icon: ReactNode, extra = '') => (
    <button role="menuitem" type="button" onClick={() => choose(act)} className={`${menuItemClass} ${extra}`}>
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
        className="grid h-9 w-9 place-items-center rounded-lg border border-line text-ink-2 transition-colors hover:border-brand hover:text-brand [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11"
      >
        <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
          <circle cx="5" cy="12" r="1.8" />
          <circle cx="12" cy="12" r="1.8" />
          <circle cx="19" cy="12" r="1.8" />
        </svg>
      </button>
      {open ? (
        <div role="menu" aria-label="More actions" className="absolute right-0 top-full z-30 mt-1 w-64 overflow-hidden rounded-lg border border-line bg-surface py-1 shadow-lift">
          {onToggleWatch ? item(watching ? 'Stop watching' : 'Watch this task', onToggleWatch, <EyeIcon filled={watching} />, headerToo) : null}
          {onExport ? item('Export as Excel', () => void onExport('xlsx').catch(() => {}), <DownloadIcon />, headerToo) : null}
          {onExport ? item('Export as PDF', () => void onExport('pdf').catch(() => {}), <DownloadIcon />, headerToo) : null}
          {onMoveToProject ? (
            moveUnavailable ? (
              <button role="menuitem" type="button" aria-disabled="true" className={`${menuItemClass} cursor-default items-start text-ink-3 hover:bg-transparent`}>
                <span className="mt-0.5 flex-none">
                  <MoveIcon />
                </span>
                <span className="min-w-0">
                  <span className="block">Move to another project…</span>
                  <span className="mt-0.5 block text-[11px] leading-snug text-ink-3">{moveUnavailable}</span>
                </span>
              </button>
            ) : (
              item('Move to another project…', onMoveToProject, <MoveIcon />)
            )
          ) : null}
          {onSaveAsTemplate ? item('Save as template…', onSaveAsTemplate, <TemplateIcon />) : null}
        </div>
      ) : null}
    </div>
  );
}
