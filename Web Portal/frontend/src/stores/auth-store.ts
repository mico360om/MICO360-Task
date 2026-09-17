import { create } from 'zustand';

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

interface AuthState {
  user: AuthUser | null;
  accessToken: string | null;
  refreshToken: string | null;
  isAuthenticated: boolean;
  setSession: (session: Session) => void;
  logout: () => void;
  isAdmin: () => boolean;
}

const KEYS = { access: 'mico360.accessToken', refresh: 'mico360.refreshToken', user: 'mico360.user' } as const;

function loadPersisted(): { user: AuthUser | null; accessToken: string | null; refreshToken: string | null } {
  try {
    const accessToken = localStorage.getItem(KEYS.access);
    const refreshToken = localStorage.getItem(KEYS.refresh);
    const userRaw = localStorage.getItem(KEYS.user);
    return { accessToken, refreshToken, user: userRaw ? (JSON.parse(userRaw) as AuthUser) : null };
  } catch {
    return { accessToken: null, refreshToken: null, user: null };
  }
}

const initial = loadPersisted();

export const useAuthStore = create<AuthState>((set, get) => ({
  user: initial.user,
  accessToken: initial.accessToken,
  refreshToken: initial.refreshToken,
  isAuthenticated: Boolean(initial.accessToken),

  setSession: ({ user, accessToken, refreshToken }) => {
    try {
      localStorage.setItem(KEYS.access, accessToken);
      localStorage.setItem(KEYS.refresh, refreshToken);
      localStorage.setItem(KEYS.user, JSON.stringify(user));
    } catch {
      /* storage may be unavailable; keep in-memory session */
    }
    set({ user, accessToken, refreshToken, isAuthenticated: true });
  },

  logout: () => {
    // Best-effort server-side revocation of the refresh token (fire-and-forget). The local
    // session is cleared regardless of the network result, and we never block logout on it.
    try {
      const rt = get().refreshToken;
      if (rt && typeof fetch === 'function') {
        const base = import.meta.env.VITE_API_URL ?? 'http://localhost:4000/api/v1';
        void fetch(`${base}/auth/logout`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken: rt }),
          keepalive: true,
        }).catch(() => {});
      }
    } catch {
      /* ignore — logout must always clear the local session */
    }
    try {
      localStorage.removeItem(KEYS.access);
      localStorage.removeItem(KEYS.refresh);
      localStorage.removeItem(KEYS.user);
    } catch {
      /* ignore */
    }
    set({ user: null, accessToken: null, refreshToken: null, isAuthenticated: false });
  },

  isAdmin: () => (get().user?.roles ?? []).includes('ADMIN'),
}));
