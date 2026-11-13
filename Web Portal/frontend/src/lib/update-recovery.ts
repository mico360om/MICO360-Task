import { deployedWebBuild } from '../api/about';
import { CHUNK_FAILURE } from './error-capture';
import { isStaleBundle, RUNNING_BUILD, type WebBuild } from './release';

/**
 * 1.23.2 — after an update, an open page loads the new version by itself instead of showing an error.
 *
 * A page opened before a deploy still runs the old build; the old build's code files (chunks) are gone
 * from the server, so opening a page whose code wasn't loaded yet fails ("Failed to fetch dynamically
 * imported module"). Two things here:
 *  - recover: when a chunk fails to load, read build-info.json (no cache). A newer build is deployed →
 *    reload once, to the same address (a sessionStorage key holds the build it reloaded for, so it can
 *    never loop). The same build, offline, or already reloaded → the error page's plain message with
 *    Reload (and only then is it recorded in the Error log);
 *  - avoid: check build-info.json on window focus and every 10 minutes; once a newer build is found, the
 *    next move to another page is a full page load there instead of a client-side one — never while
 *    someone is typing.
 *  - say (installable website, 13 Nov 2026): a check at the start and when the page is shown again too,
 *    and the update notice (components/UpdateToast) is told once per newer build: "A new version of MICO360 Tasks is ready" — Refresh or Later. An installed app has no
 *    reload button: this is how people there update.
 */

/** The build a page reloaded (or loaded afresh) for: never twice for the same one. */
export const RELOAD_KEY = 'mico360.updateReloadedFor';
/** How often an open page looks for a newer build. */
export const CHECK_EVERY_MS = 10 * 60_000;

const idOf = (b: WebBuild) => `${b.version}|${b.builtAt}`;

export interface RecoveryWorld {
  running: WebBuild;
  /** The build deployed now (build-info.json, no cache), or null when it can't be read. */
  deployed: () => Promise<WebBuild | null>;
  online: () => boolean;
  storage: { get(key: string): string | null; set(key: string, value: string): void };
  reload: () => void;
  /** The builds this page reloaded for already (when storage can't be used); the page's own by default. */
  memory?: Set<string>;
}

/** Was this the site's code failing to load (a chunk of an older build)? */
export function isChunkFailure(err: unknown): boolean {
  const e = err as { message?: unknown } | null;
  return CHUNK_FAILURE.test(e && typeof e.message === 'string' ? e.message : String(err ?? ''));
}

/** Reloaded for this build in this page already (when storage can't be used). */
const pageMemory = new Set<string>();

/**
 * After a chunk failed to load: reload once when a newer build is deployed ('reloading'), else
 * 'failed' — the caller shows the plain message (and the failure is recorded).
 */
export async function recoverFromChunkFailure(w: RecoveryWorld): Promise<'reloading' | 'failed'> {
  if (!w.online()) return 'failed';
  const deployed = await w.deployed().catch(() => null);
  if (!deployed || !isStaleBundle(w.running, deployed)) return 'failed';
  const target = idOf(deployed);
  let done: string | null = null;
  try {
    done = w.storage.get(RELOAD_KEY);
  } catch {
    done = null;
  }
  const memory = w.memory ?? pageMemory;
  if (done === target || memory.has(target)) return 'failed';
  memory.add(target);
  try {
    w.storage.set(RELOAD_KEY, target);
  } catch {
    // A private window: this page's own memory guards it.
  }
  w.reload();
  return 'reloading';
}

const session = {
  get: (k: string) => window.sessionStorage.getItem(k),
  set: (k: string, v: string) => window.sessionStorage.setItem(k, v),
};

/**
 * This page is on its way to the new build (it reloads, or loads the next page afresh). A page's code
 * failing meanwhile is part of leaving: recoverChunk answers 'reloading' — no error page, nothing recorded.
 */
let going = false;
export function markPageGoing(): void {
  going = true;
}

/** The browser's pieces. */
export function browserRecoveryWorld(): RecoveryWorld {
  return {
    running: RUNNING_BUILD,
    deployed: deployedWebBuild,
    online: () => navigator.onLine !== false,
    storage: session,
    reload: () => {
      markPageGoing();
      window.location.reload();
    },
  };
}

let pending: Promise<'reloading' | 'failed'> | null = null;
/** recoverFromChunkFailure in this page, once at a time (a lazy page, a preload and the error page may all ask). */
export function recoverChunk(): Promise<'reloading' | 'failed'> {
  if (going) return Promise.resolve('reloading');
  if (!pending) {
    pending = recoverFromChunkFailure(browserRecoveryWorld()).then((r) => {
      // Reloading: every later ask waits for the page to go; failed: a later failure may look again.
      if (r === 'failed') pending = null;
      return r;
    });
  }
  return pending;
}

/** A promise that never settles: a page that is reloading renders nothing more. */
const never = <T>() => new Promise<T>(() => {});

/**
 * React.lazy's loader, recovering from a chunk of an older build: a newer build → the page reloads to it
 * (nothing is thrown, nothing recorded); otherwise the failure goes on to the error page.
 */
export function loadWithRecovery<T>(load: () => Promise<T>): () => Promise<T> {
  return () =>
    load().catch(async (err: unknown) => {
      if (isChunkFailure(err) && (await recoverChunk()) === 'reloading') return never<T>();
      throw err;
    });
}

/**
 * Vite's preload failure (any of the site's code or styles, gone after a deploy — a page, the note editor,
 * an export): the recovery starts at once (a newer build → the page reloads to it). The event is never
 * cancelled: Vite would then answer the import with `undefined`, and the page would fail with "Cannot read
 * properties of undefined" instead of a code-loading failure its loader (loadWithRecovery) knows. Installed
 * once by main.tsx.
 */
export function installPreloadRecovery(target: Window = window, recover: () => Promise<unknown> = recoverChunk): void {
  target.addEventListener('vite:preloadError', () => {
    void recover().catch(() => {});
  });
}

export interface WatchWorld {
  running: WebBuild;
  deployed: () => Promise<WebBuild | null>;
  onFocus: (cb: () => void) => () => void;
  /** The page shown again (an installed app brought back, a phone tab reopened). */
  onVisible?: (cb: () => void) => () => void;
  every: (ms: number, cb: () => void) => () => void;
  /** Is someone typing (a text field or editor has focus)? */
  typing: () => boolean;
  /** A full page load of this address. */
  assign: (url: string) => void;
  storage: { get(key: string): string | null; set(key: string, value: string): void };
  memory?: Set<string>;
}

/** Notices a newer build and turns the next move to another page into a full page load there. */
export function createUpdateWatcher(w: WatchWorld) {
  let newer: WebBuild | null = null;
  let stops: (() => void)[] = [];
  const listeners = new Set<() => void>();
  async function check(): Promise<void> {
    // build-info.json only: the service worker (sw.js) is still checked by the browser at page loads, as
    // since 1.17 — never mid-session, so a page's last good copy is never swapped under it (review, 13 Nov).
    const deployed = await w.deployed().catch(() => null);
    if (deployed && isStaleBundle(w.running, deployed) && (!newer || idOf(newer) !== idOf(deployed))) {
      newer = deployed;
      for (const fn of [...listeners]) fn();
    }
  }
  return {
    check,
    start() {
      stops = [w.onFocus(() => void check()), w.every(CHECK_EVERY_MS, () => void check())];
      if (w.onVisible) stops.push(w.onVisible(() => void check()));
      // Once at the start too: a page opened from an older copy says so at once (as the footer did).
      void check();
    },
    /** The newer build found (null while none is known). */
    get newer(): WebBuild | null {
      return newer;
    },
    /** Told each time a (different) newer build is found. */
    subscribe(fn: () => void): () => void {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    stop() {
      for (const s of stops) s();
      stops = [];
    },
    get stale() {
      return newer !== null;
    },
    /** About to show another page at `url`: a full page load instead (true), or carry on (false). */
    navigate(url: string): boolean {
      if (!newer || w.typing()) return false;
      const target = idOf(newer);
      let done: string | null = null;
      try {
        done = w.storage.get(RELOAD_KEY);
      } catch {
        done = null;
      }
      const memory = w.memory ?? pageMemory;
      if (done === target || memory.has(target)) return false;
      memory.add(target);
      try {
        w.storage.set(RELOAD_KEY, target);
      } catch {
        // This page's own memory guards it.
      }
      w.assign(url);
      return true;
    },
  };
}

/** Is a text field, a select or an editor focused (someone is typing)? */
export function someoneTyping(doc: Document = document): boolean {
  const el = doc.activeElement as HTMLElement | null;
  if (!el || el === doc.body) return false;
  if (el.isContentEditable) return true;
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return true;
  if (el instanceof HTMLInputElement) return !['button', 'submit', 'reset', 'checkbox', 'radio', 'range', 'color', 'file', 'image'].includes(el.type);
  return false;
}

let watcher: ReturnType<typeof createUpdateWatcher> | null = null;
/** The page's watcher (main.tsx starts it once; tests and pages without one get null). */
export function pageUpdateWatcher(): ReturnType<typeof createUpdateWatcher> | null {
  return watcher;
}
export function startUpdateWatcher(): void {
  if (watcher || typeof window === 'undefined') return;
  watcher = createUpdateWatcher({
    running: RUNNING_BUILD,
    deployed: deployedWebBuild,
    onFocus: (cb) => {
      window.addEventListener('focus', cb);
      return () => window.removeEventListener('focus', cb);
    },
    every: (ms, cb) => {
      const t = window.setInterval(cb, ms);
      return () => window.clearInterval(t);
    },
    onVisible: (cb) => {
      const onChange = () => {
        if (document.visibilityState === 'visible') cb();
      };
      document.addEventListener('visibilitychange', onChange);
      return () => document.removeEventListener('visibilitychange', onChange);
    },
    typing: () => someoneTyping(),
    assign: (url) => {
      // The page just shown by the router may be failing its code meanwhile: that is part of leaving.
      markPageGoing();
      window.location.assign(url);
    },
    storage: session,
  });
  watcher.start();
}
