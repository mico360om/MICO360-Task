import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  SHORTCUTS,
  ariaKeyshortcuts,
  detectPlatform,
  isTypingTarget,
  matchShortcut,
  shortcutLabel,
  withShortcut,
  type Platform,
  type ShortcutAction,
} from '../../lib/shortcuts';
import { ShortcutsDialog } from './ShortcutsDialog';

/**
 * The app's keyboard shortcuts (see lib/shortcuts.ts for the keys). One listener for the whole app:
 *
 * - Pages and panels register what N, E, Delete, R… do there with `useShortcut`. A page's own action
 *   beats the header's (priority), and while a dialog is open only that dialog's actions run.
 * - Save (Ctrl+S) and Submit (Ctrl+Enter) need no registering: they submit the form you're in — in
 *   a dialog, the dialog's form — or the page's main form (`<form data-shortcut-save>`). With nothing
 *   to save, Ctrl+S is left to the browser.
 * - / jumps to the page's search box (`data-page-search`), else the main search; R reloads the data
 *   on screen (not under a form dialog, unless it has `data-shortcut-refresh`); Ctrl+/ or ? shows
 *   the list of shortcuts, where single keys can be switched off.
 */

interface Registration {
  id: number;
  action: ShortcutAction;
  run: () => void;
  priority: number;
  scope?: RefObject<HTMLElement | null>;
}

interface ShortcutContextValue {
  platform: Platform;
  singleKeys: boolean;
  setSingleKeys: (on: boolean) => void;
  openHelp: () => void;
  register: (r: Omit<Registration, 'id'>) => () => void;
}

const ShortcutContext = createContext<ShortcutContextValue | null>(null);

const STORE_KEY = 'mico360.shortcuts.singleKeys';
const DIALOGS = '[role="dialog"][aria-modal="true"], [role="alertdialog"][aria-modal="true"]';
/** A page's own action, over the header's default (priority 0). */
const PAGE_PRIORITY = 1;

function readSingleKeys(): boolean {
  try {
    return localStorage.getItem(STORE_KEY) !== 'off';
  } catch {
    return true;
  }
}

/** The dialog the person is in: the open one holding focus, else the last one opened. */
function topDialog(active: Element | null): HTMLElement | null {
  const open = Array.from(document.querySelectorAll<HTMLElement>(DIALOGS));
  if (open.length === 0) return null;
  const holding = open.filter((d) => active && d.contains(active));
  return holding.at(-1) ?? open.at(-1)!;
}

/** The form a Save or Submit applies to: the one focus is in, else the open dialog's form. */
function formFor(active: Element | null, dialog: HTMLElement | null): HTMLFormElement | null {
  const own = active?.closest('form') ?? null;
  if (own && (!dialog || dialog.contains(own))) return own;
  return dialog ? dialog.querySelector('form') : null;
}

/** A page's main form (`<form data-shortcut-save>`), saved with Ctrl+S from anywhere on the page. */
function pageForm(): HTMLFormElement | null {
  return Array.from(document.querySelectorAll<HTMLFormElement>('form[data-shortcut-save]')).find((f) => !f.closest(DIALOGS)) ?? null;
}

/** Submit a form as its own Save button would — unless that button is busy or unavailable. */
function submitForm(form: HTMLFormElement): void {
  const button = form.querySelector<HTMLButtonElement | HTMLInputElement>('button[type="submit"], button:not([type]), input[type="submit"]');
  if (button && (button.disabled || button.getAttribute('aria-disabled') === 'true')) return;
  if (button) form.requestSubmit(button);
  else form.requestSubmit();
}

export function ShortcutProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const platform = useMemo(() => detectPlatform(), []);
  const [singleKeys, setSingleKeysState] = useState(readSingleKeys);
  const [helpOpen, setHelpOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const registrations = useRef<Registration[]>([]);
  const nextId = useRef(1);
  const noticeTimer = useRef<ReturnType<typeof setTimeout>>();

  const setSingleKeys = useCallback((on: boolean) => {
    setSingleKeysState(on);
    try {
      if (on) localStorage.removeItem(STORE_KEY);
      else localStorage.setItem(STORE_KEY, 'off');
    } catch {
      // Private window or blocked storage: the choice lasts until the page is reloaded.
    }
  }, []);

  const register = useCallback((r: Omit<Registration, 'id'>) => {
    const entry = { ...r, id: nextId.current++ };
    registrations.current.push(entry);
    return () => {
      registrations.current = registrations.current.filter((x) => x !== entry);
    };
  }, []);

  const say = useCallback((text: string) => {
    setNotice(text);
    clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(null), 2500);
  }, []);
  useEffect(() => () => clearTimeout(noticeTimer.current), []);

  // The latest values for the one listener below, without re-adding it.
  const live = useRef({ singleKeys, helpOpen });
  live.current = { singleKeys, helpOpen };

  useEffect(() => {
    /** The registered action to run: the dialog's own while one is open; the highest priority, newest first. */
    const pick = (action: ShortcutAction, dialog: HTMLElement | null) =>
      registrations.current
        .filter((r) => r.action === action)
        .filter((r) => {
          if (!dialog) return true;
          const el = r.scope?.current;
          return !!el && (dialog === el || dialog.contains(el) || el.contains(dialog));
        })
        .sort((a, b) => b.priority - a.priority || b.id - a.id)[0];

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const active = document.activeElement;
      const action = matchShortcut(e, platform, { typing: isTypingTarget(active), singleKeys: live.current.singleKeys });
      if (!action) return;
      const dialog = topDialog(active);
      const handled = run(action, active, dialog);
      if (handled) e.preventDefault();
    };

    const run = (action: ShortcutAction, active: Element | null, dialog: HTMLElement | null): boolean => {
      switch (action) {
        case 'help':
          setHelpOpen((open) => !open);
          return true;
        case 'save':
        case 'submit': {
          // The form you're in; else the panel's or page's own save; else the page's main form.
          const form = formFor(active, dialog);
          if (form) {
            submitForm(form);
            return true;
          }
          const own = pick(action, dialog);
          if (own) {
            own.run();
            return true;
          }
          const main = dialog ? null : pageForm();
          if (main) {
            submitForm(main);
            return true;
          }
          return false;
        }
        case 'find': {
          if (dialog) return false;
          const box = Array.from(document.querySelectorAll<HTMLInputElement>('[data-page-search]')).find((el) => !el.closest(DIALOGS) && !el.closest('[hidden]'));
          if (box) {
            box.focus();
            box.select?.();
            return true;
          }
          const search = pick('search', null);
          search?.run();
          return !!search;
        }
        case 'refresh': {
          const own = pick('refresh', dialog);
          if (own) {
            own.run();
            return true;
          }
          // Reloading the data under a form someone is filling in could reset what they typed — unless
          // the panel says its data can be reloaded (the task panel: its forms are a comment box and such).
          if (dialog?.querySelector('form') && !dialog.hasAttribute('data-shortcut-refresh')) return false;
          void qc.refetchQueries({ type: 'active' });
          say('Refreshed');
          return true;
        }
        default: {
          // search, new, edit, delete, cancel
          const own = pick(action, action === 'search' ? null : dialog);
          if (!own) return false;
          own.run();
          return true;
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [platform, qc, say]);

  const value = useMemo<ShortcutContextValue>(
    () => ({ platform, singleKeys, setSingleKeys, openHelp: () => setHelpOpen(true), register }),
    [platform, singleKeys, setSingleKeys, register],
  );

  return (
    <ShortcutContext.Provider value={value}>
      {children}
      {helpOpen ? <ShortcutsDialog platform={platform} singleKeys={singleKeys} onSingleKeys={setSingleKeys} onClose={() => setHelpOpen(false)} /> : null}
      <div role="status" aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex justify-center">
        {notice ? <span className="rounded-full bg-ink px-3 py-1.5 text-xs font-semibold text-surface shadow-lift animate-fade-in">{notice}</span> : null}
      </div>
    </ShortcutContext.Provider>
  );
}

/**
 * What a shortcut does on this page or panel. `scope`: the panel it belongs to (a dialog such as
 * the task drawer), so it runs while that panel is open; without it, it runs only when no dialog is.
 * `priority`: 0 for the header's defaults, so a page's own action (the default) wins.
 */
export function useShortcut(
  action: ShortcutAction,
  handler: () => void,
  options: { enabled?: boolean; priority?: number; scope?: RefObject<HTMLElement | null> } = {},
) {
  const ctx = useContext(ShortcutContext);
  const { enabled = true, priority = PAGE_PRIORITY, scope } = options;
  const latest = useRef(handler);
  latest.current = handler;
  useEffect(() => {
    if (!ctx || !enabled) return;
    return ctx.register({ action, run: () => latest.current(), priority, scope });
  }, [ctx, action, enabled, priority, scope]);
}

/** The list of shortcuts, and whether single keys are on — for a menu item or a settings switch. */
export function useShortcutSettings() {
  const ctx = useContext(ShortcutContext);
  return {
    platform: ctx?.platform ?? detectPlatform(),
    singleKeys: ctx?.singleKeys ?? true,
    setSingleKeys: ctx?.setSingleKeys ?? (() => {}),
    openHelp: ctx?.openHelp ?? (() => {}),
  };
}

/**
 * A control's shortcut, as hints: its tooltip (`title`), `aria-keyshortcuts`, and the keys to show.
 * Single-key shortcuts give no hint while they are switched off.
 */
export function useShortcutHint(action: ShortcutAction | undefined) {
  const { platform, singleKeys } = useShortcutSettings();
  if (!action) return null;
  const def = SHORTCUTS.find((s) => s.action === action);
  if (def?.single && !singleKeys) return null;
  return {
    keys: shortcutLabel(action, platform),
    aria: ariaKeyshortcuts(action, platform),
    title: (text: string) => withShortcut(text, action, platform),
  };
}

/**
 * The shortcut's keys as a small key cap, for desktop buttons and menu items (hidden on touch screens).
 * In the text colour of its button, never faded: small text needs the full contrast.
 */
export function ShortcutHint({ action, className = '' }: { action: ShortcutAction; className?: string }) {
  const hint = useShortcutHint(action);
  if (!hint) return null;
  return (
    <kbd
      aria-hidden="true"
      className={`pointer-events-none hidden rounded border border-current/25 px-1 py-px font-sans text-[10px] font-semibold leading-none sm:inline-block [@media(hover:none)]:hidden ${className}`}
    >
      {hint.keys}
    </kbd>
  );
}
