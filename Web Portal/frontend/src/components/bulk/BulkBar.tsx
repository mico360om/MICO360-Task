import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { useMediaQuery } from '../../lib/useMediaQuery';
import { useDialog } from '../../hooks/useDialog';
import { BULK_LIMIT_TEXT, BULK_MAX, selectedText } from '../../lib/bulk-selection';
import type { BarAction, BulkBarActionId } from '../../lib/bulk-words';
import { TOUCH_SQUARE, TOUCH_TALL } from '../../lib/touch';
import { ModalPortal } from '../ui/ModalPortal';

/** Shown as their own buttons on a computer; the rest wait under "More actions". */
const MAIN: ReadonlySet<BulkBarActionId> = new Set(['status', 'priority', 'assign', 'dueDate', 'project']);
/** A phone (below the sm width): the compact bar and its sheet. */
const PHONE_QUERY = '(max-width: 39.9375em)';

export interface BulkBarProps {
  count: number;
  /** How many of them the filters (or the day shown) hide. */
  hidden: number;
  actions: BarAction[];
  onAction: (id: BulkBarActionId) => void;
  onClear: () => void;
  /** A change is being worked out or applied. */
  busy?: boolean;
}

const buttonClass =
  'inline-flex items-center gap-1 rounded-lg border border-line bg-surface px-2.5 py-1 text-xs font-semibold text-ink transition-colors hover:border-brand hover:text-brand disabled:opacity-50 aria-disabled:cursor-not-allowed aria-disabled:opacity-50 aria-disabled:hover:border-line aria-disabled:hover:text-ink';

/**
 * The bulk bar (owner, 10 Nov): "12 selected" and what can be done to them, at the foot of the window.
 * On a computer: Status, Priority, Assign, Due date and Project as buttons, the rest under "More
 * actions"; on a phone a compact bar ("12 selected · Actions") opening a sheet with every action as a
 * 44px row. An action that can't be used now is shown unavailable, saying why. The selection's count is
 * said to screen readers by the page (BulkTools), not here.
 */
export function BulkBar({ count, hidden, actions, onAction, onClear, busy = false }: BulkBarProps) {
  const phone = useMediaQuery(PHONE_QUERY);
  const [sheet, setSheet] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);
  const words = selectedText(count, hidden);
  const over = count > BULK_MAX;

  if (phone) {
    return (
      <div role="region" aria-label="Bulk actions" className="pointer-events-auto flex w-full max-w-md items-center gap-2 rounded-2xl border border-line bg-surface/95 py-1.5 pe-1.5 ps-4 shadow-lift backdrop-blur">
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">
          {busy ? <Spinner /> : null}
          {words}
        </span>
        <button
          ref={opener}
          type="button"
          onClick={() => setSheet(true)}
          aria-haspopup="dialog"
          className={`inline-flex h-9 flex-none items-center rounded-xl bg-brand px-4 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand/90 ${TOUCH_TALL}`}
        >
          Actions
        </button>
        {sheet ? (
          <ActionSheet
            count={count}
            over={over}
            actions={actions}
            onClose={() => setSheet(false)}
            onAction={(id) => {
              setSheet(false);
              onAction(id);
            }}
            onClear={() => {
              setSheet(false);
              onClear();
            }}
          />
        ) : null}
      </div>
    );
  }

  const main = actions.filter((a) => MAIN.has(a.id));
  const more = actions.filter((a) => !MAIN.has(a.id));
  return (
    <div role="region" aria-label="Bulk actions" className="pointer-events-auto flex max-w-full flex-wrap items-center gap-2 rounded-2xl border border-line bg-surface/95 px-3 py-2 shadow-lift backdrop-blur">
      <span className="flex items-center gap-2 pe-1 text-sm font-semibold text-ink">
        {busy ? <Spinner /> : null}
        {words}
      </span>
      {over ? <span data-bulk-limit className="text-xs font-medium text-danger">{BULK_LIMIT_TEXT}</span> : null}
      <span className="h-5 w-px bg-line" aria-hidden />
      {main.map((a) => (
        <BarButton key={a.id} action={a} disabled={busy} onAction={onAction} />
      ))}
      {more.length ? <MoreMenu actions={more} disabled={busy} onAction={onAction} /> : null}
      <span className="h-5 w-px bg-line" aria-hidden />
      <button type="button" onClick={onClear} aria-label="Clear selection" className={`rounded-lg px-2 py-1 text-xs font-medium text-ink-2 transition-colors hover:bg-ground hover:text-ink ${TOUCH_TALL}`}>
        Clear
      </button>
    </div>
  );
}

function Spinner() {
  return <span className="me-2 inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-brand/30 border-t-brand align-[-2px]" aria-hidden />;
}

/** One of the bar's own buttons; unavailable: aria-disabled, saying why. */
function BarButton({ action, disabled, onAction }: { action: BarAction; disabled: boolean; onAction: (id: BulkBarActionId) => void }) {
  const whyId = useId();
  return (
    <>
      <button
        type="button"
        onClick={() => {
          if (!action.unavailable && !disabled) onAction(action.id);
        }}
        disabled={disabled}
        aria-disabled={action.unavailable ? 'true' : undefined}
        aria-describedby={action.unavailable ? whyId : undefined}
        title={action.unavailable ?? undefined}
        aria-haspopup="dialog"
        className={`${buttonClass} ${TOUCH_TALL}`}
      >
        {action.label}
      </button>
      {action.unavailable ? (
        <span id={whyId} className="sr-only">
          {action.unavailable}
        </span>
      ) : null}
    </>
  );
}

const itemClass = 'flex w-full items-start gap-2 px-3 py-2 text-start text-sm text-ink outline-none hover:bg-ground focus-visible:bg-ground sm:py-1.5';

/** "More actions": the other actions as a menu above the bar (arrow keys, Escape back to its button). */
function MoreMenu({ actions, disabled, onAction }: { actions: BarAction[]; disabled: boolean; onAction: (id: BulkBarActionId) => void }) {
  const [place, setPlace] = useState<{ bottom: number; left: number } | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const open = place !== null;
  const close = (refocus = true) => {
    setPlace(null);
    if (refocus) trigger.current?.focus();
  };
  const toggle = () => {
    if (open) return setPlace(null);
    const r = trigger.current?.getBoundingClientRect();
    setPlace({ bottom: Math.max(8, window.innerHeight - (r?.top ?? window.innerHeight) + 6), left: Math.max(8, Math.min(r?.left ?? 8, window.innerWidth - 264)) });
  };
  useEffect(() => {
    if (!open) return;
    menu.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!menu.current?.contains(t) && !trigger.current?.contains(t)) setPlace(null);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const all = Array.from(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
    const at = all.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      all[e.key === 'ArrowDown' ? (at + 1) % all.length : (at - 1 + all.length) % all.length]?.focus();
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      all[e.key === 'Home' ? 0 : all.length - 1]?.focus();
    } else if (e.key === 'Tab') {
      close(false);
    }
  };
  return (
    <>
      <button ref={trigger} type="button" onClick={toggle} disabled={disabled} aria-haspopup="menu" aria-expanded={open} className={`${buttonClass} ${TOUCH_TALL}`}>
        More actions
        <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="m6 15 6-6 6 6" />
        </svg>
      </button>
      {open
        ? createPortal(
            <div
              ref={menu}
              role="menu"
              aria-label="More actions"
              onKeyDown={onKey}
              style={{ bottom: place.bottom, left: place.left }}
              className="fixed z-50 w-64 overflow-hidden rounded-xl border border-line bg-surface py-1 shadow-lift"
            >
              {actions.map((a) =>
                a.unavailable ? (
                  <button key={a.id} role="menuitem" type="button" aria-disabled="true" className={`${itemClass} cursor-default text-ink-3 hover:bg-transparent ${TOUCH_TALL}`}>
                    <span className="min-w-0">
                      <span className="block">{a.label}</span>
                      <span className="mt-0.5 block text-[11px] leading-snug text-ink-3">{a.unavailable}</span>
                    </span>
                  </button>
                ) : (
                  <button
                    key={a.id}
                    role="menuitem"
                    type="button"
                    onClick={() => {
                      close();
                      onAction(a.id);
                    }}
                    className={`${itemClass} ${a.id === 'delete' ? 'text-danger' : ''} ${TOUCH_TALL}`}
                  >
                    {a.label}
                  </button>
                ),
              )}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

/** The phone's sheet: every action as a 44px row (focus kept inside; Escape or Close shuts it). */
function ActionSheet({
  count,
  over,
  actions,
  onClose,
  onAction,
  onClear,
}: {
  count: number;
  over: boolean;
  actions: BarAction[];
  onClose: () => void;
  onAction: (id: BulkBarActionId) => void;
  onClear: () => void;
}) {
  const ref = useDialog(onClose, { initialFocus: 'container' });
  const titleId = useId();
  const row = `flex w-full min-h-11 items-center justify-between gap-3 px-4 py-2 text-start text-base text-ink transition-colors hover:bg-ground focus-visible:bg-ground focus-visible:outline-none`;
  return (
    <ModalPortal>
      <div className="fixed inset-0 z-50 flex items-end">
        <div className="absolute inset-0 bg-scrim animate-fade-in" onClick={onClose} aria-hidden="true" />
        <div
          ref={ref}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          tabIndex={-1}
          className="relative flex max-h-[85dvh] w-full flex-col overflow-hidden rounded-t-2xl border border-line bg-surface pb-[env(safe-area-inset-bottom)] shadow-lift outline-none animate-fade-in"
        >
          <div className="flex flex-none items-center justify-between gap-2 border-b border-line py-1 pe-1 ps-4">
            <h2 id={titleId} className="text-base font-semibold text-ink">
              Actions for {count} task{count === 1 ? '' : 's'}
            </h2>
            <button type="button" onClick={onClose} aria-label="Close" className={`grid h-9 w-9 place-items-center rounded-lg text-ink-2 hover:bg-ground hover:text-ink ${TOUCH_SQUARE}`}>
              ✕
            </button>
          </div>
          {over ? <p data-bulk-limit className="flex-none px-4 pt-2 text-sm font-medium text-danger">{BULK_LIMIT_TEXT}</p> : null}
          <div className="min-h-0 flex-1 overflow-y-auto py-1">
            {actions.map((a) => (
              <button
                key={a.id}
                type="button"
                data-bulk-action={a.id}
                aria-disabled={a.unavailable ? 'true' : undefined}
                onClick={() => {
                  if (!a.unavailable) onAction(a.id);
                }}
                className={`${row} ${a.unavailable ? 'cursor-default text-ink-3 hover:bg-transparent' : a.id === 'delete' ? 'text-danger' : ''}`}
              >
                <span className="min-w-0">
                  <span className="block">{a.label}</span>
                  {a.unavailable ? <span className="mt-0.5 block text-xs leading-snug text-ink-3">{a.unavailable}</span> : null}
                </span>
              </button>
            ))}
            <button type="button" onClick={onClear} className={`${row} border-t border-line text-ink-2`}>
              Clear selection
            </button>
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}
