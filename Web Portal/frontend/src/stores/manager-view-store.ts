import { create } from 'zustand';
import { ApiError } from '../lib/api-client';
import { useAuthStore } from './auth-store';

/**
 * Manager View (owner, 10 Nov 2026): an administrator's switch as this device knows it — read from the
 * server once per sign-in (lib/manager-view: useManagerViewSync), remembered here for the next visit so the
 * Admin menu doesn't flash, and turned on by any 403 MANAGER_VIEW (it was turned on on another device).
 * Kept apart from lib/manager-view so the API client can tell it about a refusal without a circular import.
 */

export const MANAGER_VIEW_CODE = 'MANAGER_VIEW';

const STORAGE = 'mico360.managerView';

interface ManagerViewState {
  /** Whose switch this is (a different person signing in starts unknown). */
  userId: string | null;
  /** On or off; null until known for this person. */
  on: boolean | null;
  set: (userId: string, on: boolean) => void;
  clear: () => void;
}

function remembered(): { userId: string | null; on: boolean | null } {
  try {
    const raw = localStorage.getItem(STORAGE);
    if (!raw) return { userId: null, on: null };
    const v = JSON.parse(raw) as { userId?: unknown; on?: unknown };
    return typeof v.userId === 'string' && typeof v.on === 'boolean' ? { userId: v.userId, on: v.on } : { userId: null, on: null };
  } catch {
    return { userId: null, on: null };
  }
}

export const useManagerViewStore = create<ManagerViewState>((set) => ({
  ...remembered(),
  set: (userId, on) => {
    try {
      localStorage.setItem(STORAGE, JSON.stringify({ userId, on }));
    } catch {
      /* storage unavailable: kept for this visit only */
    }
    set({ userId, on });
  },
  clear: () => {
    try {
      localStorage.removeItem(STORAGE);
    } catch {
      /* storage unavailable */
    }
    set({ userId: null, on: null });
  },
}));

/** The server refused something because Manager View is on (it was turned on elsewhere): it is on here too. */
export function noteManagerViewRefusal(err: ApiError): void {
  if (err.code !== MANAGER_VIEW_CODE) return;
  const me = useAuthStore.getState().user;
  if (me && (me.roles ?? []).includes('ADMIN')) useManagerViewStore.getState().set(me.id, true);
}

export const isManagerViewRefusal = (err: unknown): boolean => err instanceof ApiError && err.code === MANAGER_VIEW_CODE;

