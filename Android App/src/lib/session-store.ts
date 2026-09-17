import type { KeyValueStore } from './storage';
import type { Session } from './types';

const SESSION_KEY = 'mico360.session';

/**
 * Framework-agnostic auth session manager (A1). Persists the session to a secure
 * key/value store and notifies subscribers on change; a thin React hook wraps it.
 */
export function createSessionStore({ store }: { store: KeyValueStore }) {
  let session: Session | null = null;
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((l) => l());

  async function load(): Promise<Session | null> {
    try {
      const raw = await store.getItem(SESSION_KEY);
      session = raw ? (JSON.parse(raw) as Session) : null;
    } catch {
      session = null;
    }
    emit();
    return session;
  }

  async function setSession(next: Session): Promise<void> {
    session = next;
    try {
      await store.setItem(SESSION_KEY, JSON.stringify(next));
    } catch {
      /* storage unavailable — keep the session in memory for this run */
    }
    emit();
  }

  async function logout(): Promise<void> {
    session = null;
    try {
      await store.deleteItem(SESSION_KEY);
    } catch {
      /* ignore */
    }
    emit();
  }

  return {
    load,
    setSession,
    logout,
    getSession: () => session,
    getToken: () => session?.accessToken ?? null,
    isAuthenticated: () => session !== null,
    isAdmin: () => (session?.user.roles ?? []).includes('ADMIN'),
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export type SessionStore = ReturnType<typeof createSessionStore>;
