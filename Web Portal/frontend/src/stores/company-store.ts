import { create } from 'zustand';
import { COMPANY_PICK_PREF, pickGoneNotice } from '../lib/companies';
import { readUserValue, writeUserValue } from '../lib/user-storage';
import { useAuthStore } from './auth-store';

/**
 * The company picked in the top bar ("All my companies" = null), for the signed-in person. Saved on
 * this device per person (`mico360.u.<userId>.company.pick`, kept when they sign out) and read again
 * when they sign in. The API client sends it with every request (`X-Company-Id`); changing it resets
 * the cached lists (lib/company-scope.ts).
 */
interface CompanyState {
  pick: string | null;
  /** "You no longer have access to Beta Co. Showing all your companies." until dismissed. */
  notice: string | null;
  /** Company names by id, from the last `/me/companies` — so a company taken away can still be named. */
  names: Record<string, string>;
  /** Whose pick this is (the signed-in person), or null. */
  userId: string | null;
  setPick: (userId: string, pick: string | null) => void;
  /** Read the saved pick of whoever signed in (null: signed out — the saved one stays on the device). */
  loadFor: (userId: string | null) => void;
  setNames: (names: Record<string, string>) => void;
  /**
   * The server refused the pick (or no longer lists it): clear it, saved too, with the notice. Given
   * the pick that was refused, a late answer about an older pick leaves a newer one alone.
   */
  companyGone: (refused?: string | null) => void;
  dismissNotice: () => void;
}

export const useCompanyStore = create<CompanyState>((set, get) => ({
  pick: null,
  notice: null,
  names: {},
  userId: null,
  setPick: (userId, pick) => {
    writeUserValue(userId, COMPANY_PICK_PREF, pick);
    set({ userId, pick });
  },
  loadFor: (userId) => set({ userId, pick: userId ? readUserValue(userId, COMPANY_PICK_PREF) || null : null, notice: null }),
  setNames: (names) => set((s) => (Object.entries(names).every(([id, name]) => s.names[id] === name) ? s : { names: { ...s.names, ...names } })),
  companyGone: (refused) => {
    const { pick, names, userId } = get();
    if (!pick || (refused != null && refused !== pick)) return;
    writeUserValue(userId, COMPANY_PICK_PREF, null);
    set({ pick: null, notice: pickGoneNotice(names[pick] ?? null) });
  },
  dismissNotice: () => set({ notice: null }),
}));

/**
 * Keep the pick with whoever is signed in: read theirs now and whenever another person signs in;
 * nobody's while signed out. Returns an unsubscribe.
 */
export function bindCompanyPickToSession(): () => void {
  const signedIn = (s: { isAuthenticated: boolean; user: { id: string } | null }) => (s.isAuthenticated ? (s.user?.id ?? null) : null);
  useCompanyStore.getState().loadFor(signedIn(useAuthStore.getState()));
  return useAuthStore.subscribe((state, prev) => {
    const now = signedIn(state);
    if (now !== signedIn(prev)) useCompanyStore.getState().loadFor(now);
  });
}
