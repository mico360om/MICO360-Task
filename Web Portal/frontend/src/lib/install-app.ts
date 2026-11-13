import { useSyncExternalStore } from 'react';

/**
 * Installable website (13 Nov 2026): "Install App" where the browser can install the site (Chrome, Edge,
 * Android — its `beforeinstallprompt`), and the "Add to Home Screen" guide on iPhone and iPad (Safari
 * has no such event; an iPad asking for desktop sites says it is a Mac, only its touch screen tells).
 * Nothing is offered once the site runs installed (its own window: display-mode standalone, or iOS's
 * navigator.standalone), after `appinstalled`, or where the browser can't install.
 *
 * The Dashboard card can be put off ("Not now") for 90 days on this device; the account menu's item stays.
 * Storage may be unusable (a private window, blocked site data): every access is guarded and the page
 * works the same without it (Not now then lasts for this page).
 */

/** Device-wide (like the theme): the card is about this device, whoever is signed in. */
export const NOT_NOW_KEY = 'mico360.installApp.notNowAt';
export const NOT_NOW_FOR_MS = 90 * 24 * 60 * 60 * 1000;

/** Chrome's event: the site can be installed; `prompt()` opens the browser's own install window, once. */
export interface BeforeInstallPromptEvent {
  preventDefault: () => void;
  prompt: () => Promise<unknown>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export interface DeviceFacts {
  userAgent: string;
  platform: string;
  maxTouchPoints: number;
}

export interface InstallWorld {
  addEventListener: (type: 'beforeinstallprompt' | 'appinstalled', fn: (e: unknown) => void) => void;
  /** Running in its own window (display-mode standalone, fullscreen, minimal-ui or window controls overlay). */
  displayModeStandalone: () => boolean;
  onDisplayModeChange: (fn: () => void) => void;
  navigator: DeviceFacts & { standalone?: boolean };
  storage: { getItem(key: string): string | null; setItem(key: string, value: string): void } | null;
  now: () => number;
}

/** 'prompt': the browser's own install; 'ios': the Add to Home Screen guide; 'none': nothing to offer. */
export type InstallOffer = 'prompt' | 'ios' | 'none';

export interface InstallSnapshot {
  offer: InstallOffer;
  installed: boolean;
  /** The Dashboard card: offered, and not put off on this device. */
  showCard: boolean;
  /** The account menu's "Install App". */
  showMenu: boolean;
  /** The iPhone/iPad "Add to Home Screen" guide is open (one for the page: it outlives the menu that opened it). */
  guideOpen: boolean;
}

/** iPhone, iPad, iPod — and an iPad in desktop mode (a "Mac" with a touch screen). */
export function isAppleTouchDevice(d: DeviceFacts): boolean {
  if (/\b(iPhone|iPad|iPod)\b/.test(d.userAgent)) return true;
  return d.platform === 'MacIntel' && d.maxTouchPoints > 1;
}

export type InstallResult = 'accepted' | 'dismissed' | 'guide' | 'unavailable';

export function createInstallApp(w: InstallWorld) {
  let promptEvent: BeforeInstallPromptEvent | null = null;
  let installedEvent = false;
  let notNowAt: number | null = null;
  let guideOpen = false;
  let snapshot: InstallSnapshot | null = null;
  const listeners = new Set<() => void>();
  const ios = isAppleTouchDevice(w.navigator);

  const installed = () => installedEvent || w.displayModeStandalone() || w.navigator.standalone === true;

  function compute(): InstallSnapshot {
    const isInstalled = installed();
    const offer: InstallOffer = isInstalled ? 'none' : promptEvent ? 'prompt' : ios ? 'ios' : 'none';
    const putOff = notNowAt !== null && w.now() - notNowAt < NOT_NOW_FOR_MS;
    return { offer, installed: isInstalled, showCard: offer !== 'none' && !putOff, showMenu: offer !== 'none', guideOpen: guideOpen && offer === 'ios' };
  }

  function changed() {
    snapshot = null;
    for (const fn of listeners) fn();
  }

  function readNotNow(): number | null {
    try {
      const raw = w.storage?.getItem(NOT_NOW_KEY) ?? null;
      const at = raw === null ? NaN : Number(raw);
      return Number.isFinite(at) ? at : null;
    } catch {
      return null;
    }
  }

  function notNow() {
    notNowAt = w.now();
    try {
      w.storage?.setItem(NOT_NOW_KEY, String(notNowAt));
    } catch {
      // Remembered for this page only.
    }
    changed();
  }

  return {
    start() {
      notNowAt = readNotNow();
      w.addEventListener('beforeinstallprompt', (e) => {
        const event = e as BeforeInstallPromptEvent;
        // Our own card and menu item offer it: the browser's own bar (Android) is held back.
        event.preventDefault();
        promptEvent = event;
        changed();
      });
      w.addEventListener('appinstalled', () => {
        installedEvent = true;
        promptEvent = null;
        changed();
      });
      w.onDisplayModeChange(changed);
    },
    getSnapshot(): InstallSnapshot {
      return (snapshot ??= compute());
    },
    subscribe(fn: () => void): () => void {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    notNow,
    closeGuide() {
      guideOpen = false;
      changed();
    },
    /** Install App: the browser's install window, or 'guide' (the iPhone/iPad steps open: guideOpen). */
    async install(): Promise<InstallResult> {
      const offer = compute().offer;
      if (offer === 'ios') {
        guideOpen = true;
        changed();
        return 'guide';
      }
      if (offer !== 'prompt' || !promptEvent) return 'unavailable';
      const event = promptEvent;
      // A browser's offer works once.
      promptEvent = null;
      let outcome: 'accepted' | 'dismissed' = 'dismissed';
      try {
        await event.prompt();
        outcome = (await event.userChoice).outcome;
      } catch {
        outcome = 'dismissed';
      }
      if (outcome === 'dismissed') notNow();
      else changed();
      return outcome;
    },
  };
}

export type InstallApp = ReturnType<typeof createInstallApp>;

const DISPLAY_MODES = ['standalone', 'fullscreen', 'minimal-ui', 'window-controls-overlay'].map((m) => `(display-mode: ${m})`);

/** The browser's own world, for main.tsx. */
export function browserInstallWorld(): InstallWorld {
  const queries = typeof window.matchMedia === 'function' ? DISPLAY_MODES.map((q) => window.matchMedia(q)) : [];
  let storage: InstallWorld['storage'] = null;
  try {
    storage = window.localStorage;
  } catch {
    storage = null;
  }
  return {
    addEventListener: (type, fn) => window.addEventListener(type, fn),
    displayModeStandalone: () => queries.some((q) => q.matches),
    onDisplayModeChange: (fn) => {
      for (const q of queries) q.addEventListener?.('change', fn);
    },
    navigator: {
      userAgent: navigator.userAgent,
      platform: navigator.platform ?? '',
      maxTouchPoints: navigator.maxTouchPoints ?? 0,
      standalone: (navigator as Navigator & { standalone?: boolean }).standalone,
    },
    storage,
    now: () => Date.now(),
  };
}

let current: InstallApp | null = null;

/** Started once by main.tsx, before the page renders: the browser's offer can come at any moment. */
export function startInstallApp(world: InstallWorld = browserInstallWorld()): InstallApp {
  if (!current) {
    current = createInstallApp(world);
    current.start();
  }
  return current;
}

/** Tests: forget the page's install state. */
export function resetInstallAppForTests(): void {
  current = null;
}

const NOTHING: InstallSnapshot = { offer: 'none', installed: false, showCard: false, showMenu: false, guideOpen: false };
const noop = () => () => {};

/** The page's install offer for React (nothing at all where main.tsx didn't start it). */
export function useInstallApp(): InstallSnapshot & { install: () => Promise<InstallResult>; notNow: () => void; closeGuide: () => void } {
  const app = current;
  const snap = useSyncExternalStore(app ? app.subscribe : noop, app ? app.getSnapshot : () => NOTHING, () => NOTHING);
  return {
    ...snap,
    install: app ? app.install : async () => 'unavailable',
    notNow: app ? app.notNow : () => {},
    closeGuide: app ? app.closeGuide : () => {},
  };
}
