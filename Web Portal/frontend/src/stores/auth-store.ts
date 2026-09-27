import { create } from 'zustand';
import { clearUserStorage } from '../lib/user-storage';
import { localStorageQueueStore, removeOwnerItems } from '../lib/offline-queue';

export interface AuthUser {
  id: string;
  email: string;
  username: string;
  roles: string[];
  avatarUrl?: string | null;
}

export interface Session {
  user: AuthUser;
  accessToken: string;
  refreshToken: string;
}

/**
 * Why a session ends. `user` = the person clicked Log out (revoke on the server, drop their unsynced
 * offline changes). `expired` = the refresh token was rejected (keep their queued changes; only they
 * can replay them). `remote` = another tab ended the session (it already did the server work).
 */
export type LogoutReason = 'user' | 'expired' | 'remote';

export interface SetSessionOptions {
  /** Persist across browser restarts ("Keep me signed in"). Defaults to the current session's choice. */
  remember?: boolean;
}

interface AuthState {
  user: AuthUser | null;
  accessToken: string | null;
  refreshToken: string | null;
  isAuthenticated: boolean;
  /** True when the session lives in localStorage (survives a browser restart); false = this tab/window only. */
  remember: boolean;
  /** How the last session ended (null while signed in / never signed in) — an explicit log out forgets the page. */
  endedBy: LogoutReason | null;
  setSession: (session: Session, opts?: SetSessionOptions) => void;
  /**
   * End the session. Also safe as a click handler (`onClick={logout}`): any non-reason argument
   * (the click event) counts as an explicit `'user'` sign-out.
   */
  logout: (reason?: LogoutReason | object) => void;
  isAdmin: () => boolean;
}

const KEYS = { access: 'mico360.accessToken', refresh: 'mico360.refreshToken', user: 'mico360.user' } as const;
const CHANNEL_NAME = 'mico360-auth';
const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:4000/api/v1';

type StoredSession = {
  accessToken: string;
  refreshToken: string | null;
  user: AuthUser | null;
  remember: boolean;
};

function storageFor(remember: boolean): Storage | null {
  try {
    return remember ? localStorage : sessionStorage;
  } catch {
    return null;
  }
}

function readFrom(remember: boolean): StoredSession | null {
  const s = storageFor(remember);
  if (!s) return null;
  try {
    const accessToken = s.getItem(KEYS.access);
    if (!accessToken) return null;
    const userRaw = s.getItem(KEYS.user);
    return { accessToken, refreshToken: s.getItem(KEYS.refresh), user: userRaw ? (JSON.parse(userRaw) as AuthUser) : null, remember };
  } catch {
    return null;
  }
}

/**
 * The newest session persisted by any tab: a remembered one in localStorage (shared by all tabs)
 * or, failing that, this tab's sessionStorage copy. Pass `remember` to read only that kind. Read
 * before refreshing so a tab never spends a refresh token another tab has already rotated.
 */
export function readStoredSession(remember?: boolean): StoredSession | null {
  if (remember !== undefined) return readFrom(remember);
  return readFrom(true) ?? readFrom(false);
}

function removeFrom(s: Storage | null): void {
  if (!s) return;
  try {
    // Access first: other tabs react to the access key, so it changes first on removal…
    s.removeItem(KEYS.access);
    s.removeItem(KEYS.refresh);
    s.removeItem(KEYS.user);
  } catch {
    /* ignore */
  }
}

function writeTo(target: Storage | null, session: Session): void {
  try {
    if (target) {
      target.setItem(KEYS.refresh, session.refreshToken);
      target.setItem(KEYS.user, JSON.stringify(session.user));
      // …and last on write, so a tab reacting to it already sees the matching refresh token + user.
      target.setItem(KEYS.access, session.accessToken);
    }
  } catch {
    /* storage may be unavailable; keep the in-memory session */
  }
}

function persist(session: Session, remember: boolean): void {
  writeTo(storageFor(remember), session);
  // "Keep me signed in" unticked must never leave tokens in localStorage (and vice versa, stale copies go).
  removeFrom(storageFor(!remember));
}

// ── Cross-tab channel (BroadcastChannel where available; localStorage `storage` events cover the rest) ──
type AuthMessage =
  | { type: 'session'; session: Session; remember: boolean }
  | { type: 'logout'; userId: string | null }
  // A newly opened tab asks whether another tab holds a window-only ("not remembered") session…
  | { type: 'request-session' }
  // …and such a tab shares it, so a link opened in a new tab doesn't demand a fresh sign-in.
  | { type: 'share-session'; session: Session };

/** When this tab last asked other tabs for their window-only session (a reply is only accepted shortly after). */
let requestedSessionAt = 0;
const SHARE_WINDOW_MS = 3000;

let channel: BroadcastChannel | null = null;
function getChannel(): BroadcastChannel | null {
  if (channel) return channel;
  try {
    if (typeof BroadcastChannel !== 'undefined') channel = new BroadcastChannel(CHANNEL_NAME);
  } catch {
    channel = null;
  }
  return channel;
}
function broadcast(msg: AuthMessage): void {
  try {
    getChannel()?.postMessage(msg);
  } catch {
    /* best effort */
  }
}

const initial = readStoredSession();

export const useAuthStore = create<AuthState>((set, get) => ({
  user: initial?.user ?? null,
  accessToken: initial?.accessToken ?? null,
  refreshToken: initial?.refreshToken ?? null,
  isAuthenticated: Boolean(initial?.accessToken),
  remember: initial?.remember ?? true,
  endedBy: null,

  setSession: (session, opts) => {
    const remember = opts?.remember ?? get().remember;
    persist(session, remember);
    set({ user: session.user, accessToken: session.accessToken, refreshToken: session.refreshToken, isAuthenticated: true, remember, endedBy: null });
    broadcast({ type: 'session', session, remember });
  },

  logout: (arg) => {
    const reason: LogoutReason = arg === 'expired' || arg === 'remote' ? arg : 'user';
    const { refreshToken, user, isAuthenticated } = get();
    // Best-effort server-side revocation of the refresh token (fire-and-forget) — only for an explicit
    // sign-out; an expired token is already dead and a remote logout was revoked by the other tab.
    if (reason === 'user' && refreshToken) {
      try {
        if (typeof fetch === 'function') {
          void fetch(`${API_BASE}/auth/logout`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ refreshToken }),
            keepalive: true,
          }).catch(() => {});
        }
      } catch {
        /* ignore — logout must always clear the local session */
      }
    }
    // The shared remembered session goes too — unless this tab was window-only and it belongs to someone else.
    const remembered = readFrom(true);
    if (get().remember || !remembered?.user || !user || remembered.user.id === user.id) removeFrom(storageFor(true));
    removeFrom(storageFor(false));
    // Nothing of this person's may stay behind for the next one on a shared PC.
    clearUserStorage();
    if (reason === 'user' && user) removeOwnerItems(localStorageQueueStore, user.id);
    if (reason !== 'remote' && isAuthenticated) broadcast({ type: 'logout', userId: user?.id ?? null });
    set({ user: null, accessToken: null, refreshToken: null, isAuthenticated: false, endedBy: isAuthenticated ? reason : get().endedBy });
  },

  isAdmin: () => (get().user?.roles ?? []).includes('ADMIN'),
}));

/** Take over a session another tab created or rotated, without writing it back or re-broadcasting. */
function adopt(session: { user: AuthUser | null; accessToken: string; refreshToken: string | null }, remember: boolean): void {
  useAuthStore.setState({
    user: session.user,
    accessToken: session.accessToken,
    refreshToken: session.refreshToken,
    isAuthenticated: true,
    remember,
    endedBy: null,
  });
}

/** Apply a message from another tab. Exported for tests. */
export function handleAuthMessage(msg: AuthMessage): void {
  const state = useAuthStore.getState();
  if (msg.type === 'request-session') {
    if (state.isAuthenticated && !state.remember && state.user && state.accessToken && state.refreshToken) {
      broadcast({ type: 'share-session', session: { user: state.user, accessToken: state.accessToken, refreshToken: state.refreshToken } });
    }
    return;
  }
  if (msg.type === 'share-session') {
    if (state.isAuthenticated || Date.now() - requestedSessionAt > SHARE_WINDOW_MS) return;
    writeTo(storageFor(false), msg.session); // this tab's own window-only copy; localStorage untouched
    adopt(msg.session, false);
    return;
  }
  if (msg.type === 'logout') {
    if (state.isAuthenticated && (!msg.userId || !state.user || state.user.id === msg.userId)) state.logout('remote');
    return;
  }
  // A refreshed/rotated session: only share it with tabs signed in as the same person the same way,
  // so a single-use refresh token copied between tabs keeps working in all of them.
  if (!state.isAuthenticated || state.user?.id !== msg.session.user.id || state.remember !== msg.remember) return;
  if (state.refreshToken === msg.session.refreshToken && state.accessToken === msg.session.accessToken) return;
  // This tab's own sessionStorage copy must follow along (localStorage is already shared).
  if (!msg.remember) writeTo(storageFor(false), msg.session);
  adopt(msg.session, msg.remember);
}

/** React to another tab changing the shared (remembered) session in localStorage. Exported for tests. */
export function handleStorageChange(key: string | null): void {
  if (key !== null && key !== KEYS.access) return;
  const state = useAuthStore.getState();
  // A tab signed in only for this window ignores the shared remembered session.
  if (state.isAuthenticated && !state.remember) return;
  const stored = readFrom(true);
  if (!stored) {
    if (state.isAuthenticated) state.logout('remote');
    return;
  }
  if (stored.accessToken === state.accessToken && stored.refreshToken === state.refreshToken) return;
  adopt(stored, true);
}

/**
 * Keep every open tab on one session: a refresh or sign-in in one tab is adopted by the others, and
 * signing out anywhere signs out everywhere. Call once at start-up; returns an unsubscribe.
 */
export function initAuthSync(): () => void {
  const onStorage = (e: StorageEvent) => {
    try {
      if (e.storageArea && e.storageArea !== localStorage) return;
    } catch {
      return;
    }
    handleStorageChange(e.key);
  };
  window.addEventListener('storage', onStorage);
  const ch = getChannel();
  const onMessage = (e: MessageEvent<AuthMessage>) => {
    if (e.data && typeof e.data === 'object') handleAuthMessage(e.data);
  };
  ch?.addEventListener('message', onMessage);
  // A new tab without its own session: ask the other open tabs for their window-only session.
  if (!useAuthStore.getState().isAuthenticated) {
    requestedSessionAt = Date.now();
    broadcast({ type: 'request-session' });
  }
  return () => {
    window.removeEventListener('storage', onStorage);
    ch?.removeEventListener('message', onMessage);
  };
}
