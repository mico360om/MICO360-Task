import { useState } from 'react';

/** The user's theme preference. 'system' follows the OS via prefers-color-scheme. */
export type ThemeChoice = 'light' | 'dark' | 'system';

const KEY = 'mico360.theme';

/** Read the persisted choice (defaults to 'system'). Safe if storage is unavailable. */
export function getStoredTheme(): ThemeChoice {
  try {
    const t = localStorage.getItem(KEY);
    return t === 'light' || t === 'dark' ? t : 'system';
  } catch {
    return 'system';
  }
}

/** The OS preference right now. */
export function resolveSystem(): 'light' | 'dark' {
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

/**
 * Apply a choice to the document. We always stamp a concrete data-theme ('light' | 'dark') —
 * resolving 'system' to the OS preference — so both the CSS-variable palette and Tailwind's
 * `dark:` utilities (e.g. the white-logo swap) respond consistently, in system mode too.
 */
export function applyTheme(choice: ThemeChoice): void {
  const effective = choice === 'system' ? resolveSystem() : choice;
  document.documentElement.setAttribute('data-theme', effective);
}

/** Persist + apply a choice. */
export function setTheme(choice: ThemeChoice): void {
  try {
    if (choice === 'system') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, choice);
  } catch {
    /* ignore — still apply in-memory */
  }
  applyTheme(choice);
}

let systemListenerAttached = false;

/** Apply the stored theme on app start, and keep 'system' in sync with live OS changes. */
export function initTheme(): void {
  applyTheme(getStoredTheme());
  if (!systemListenerAttached) {
    systemListenerAttached = true;
    try {
      window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
        if (getStoredTheme() === 'system') applyTheme('system');
      });
    } catch {
      /* matchMedia unavailable — ignore */
    }
  }
}

/** React state for a theme toggle: current choice + a setter that persists + applies it. */
export function useThemeChoice(): [ThemeChoice, (c: ThemeChoice) => void] {
  const [choice, setChoice] = useState<ThemeChoice>(() => getStoredTheme());
  return [
    choice,
    (c: ThemeChoice) => {
      setTheme(c);
      setChoice(c);
    },
  ];
}
