import { useEffect } from 'react';
import { useIsMutating, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { create } from 'zustand';
import { apiClient } from '../api/client';
import { PREFERENCES_SCOPE, preferencesApi, type DatePreferences } from '../api/preferences';
import { useAuthStore } from '../stores/auth-store';
import { DATE_PREFS_KEY } from './useDatePrefs';
import { readUserValue, writeUserValue } from './user-storage';
import { DENSITY_PREF } from './density-tokens';

/**
 * Rows: Compact · Comfortable · Detailed (1.23.0; Detailed 1.23.8). Each person's own choice (Settings →
 * Appearance, and the quick "Rows" button on tables and lists), saved on their account so it follows them
 * to every computer. Comfortable is today's look, for everyone until they pick another.
 *
 * Detailed (1.23.8) adds to each card and row the description's first line, the checklist count, the tags,
 * the project and everyone on it, and never cuts a title (it wraps). It adds information and never shrinks
 * a target, so it applies on phones and touch screens too (`detailed:` variant: the attribute alone); the
 * pieces that show more read `useDensity() === 'detailed'`.
 *
 * One mechanism: `<html data-density="comfortable|compact">`, and the Tailwind variant `compact:`
 * (tailwind.config.js), which applies only with that attribute AND from the md width (768px) with a
 * mouse or trackpad — so phones and touch screens always keep the comfortable sizes and their 44px
 * targets, whatever the setting. Only lists, tables and boards use the variant (rows, cards, the
 * gaps between them); page headers, forms and dialogs never do.
 *
 * The steps compact takes — the shared pieces use these, nothing invents its own:
 * - row and card padding about a third less: py-3 → py-2, py-2.5 → py-1.5, py-2 → py-1, py-1.5 → py-1,
 *   p-3.5 → p-2.5, p-3 → p-2, p-2.5 → p-2; the gaps between rows and cards one step less
 *   (gap-3 → gap-2, gap-2.5 → gap-1.5, gap-2 → gap-1);
 * - a row's text one step smaller: 14px → 13px (`DENSE_TEXT`), never below 12px (12px stays 12px);
 * - faces in rows 24px → 20px (`<Avatar dense>`, `DENSE_FACE`), overlapping less so no initial is hidden
 *   (`DENSE_STACK`), the number chip without its own padding (`<TaskKey dense="compact">` in rows);
 * - small controls inside a row (tick boxes' targets, ⋯ / Open buttons) 32px → 28px — mouse only.
 * Never: cut text, horizontal page scroll, or a smaller target on a touch screen.
 */

export type Density = 'comfortable' | 'compact' | 'detailed';

export { COMPACT_MEDIA, DENSE_FACE, DENSE_STACK, DENSE_TEXT, DENSITY_PREF } from './density-tokens';

export function isDensity(v: unknown): v is Density {
  return v === 'comfortable' || v === 'compact' || v === 'detailed';
}

/** Stamp the choice on the page (always a concrete word, so the CSS and the tests can read it). */
export function applyDensity(d: Density): void {
  try {
    document.documentElement.setAttribute('data-density', d);
  } catch {
    /* no document (server) — nothing to stamp */
  }
}

/** This person's last choice on this device (comfortable when there is none, or nobody is signed in). */
export function storedDensity(userId: string | null | undefined): Density {
  const v = readUserValue(userId, DENSITY_PREF);
  return v === 'compact' || v === 'detailed' ? v : 'comfortable';
}

/** Remember it on this device for the next page load (comfortable leaves nothing behind). */
export function rememberDensity(userId: string | null | undefined, d: Density): void {
  writeUserValue(userId, DENSITY_PREF, d === 'comfortable' ? null : d);
}

interface DensityState {
  /** What the page shows now. */
  density: Density;
  set: (d: Density) => void;
}

/** The density in force — the one source the page, Settings and the quick buttons read. */
export const useDensityStore = create<DensityState>((set) => ({
  density: 'comfortable',
  set: (d) => {
    applyDensity(d);
    set({ density: d });
  },
}));

let followingSessions = false;

/**
 * At start, before the first paint: the signed-in person's last choice on this device, so a page in
 * compact doesn't load comfortable and then jump. Then whenever a different person signs in (theirs)
 * or the session ends (comfortable). The account's own choice follows from `useDensitySync`.
 */
export function initDensity(): void {
  const fromDevice = () => {
    const s = useAuthStore.getState();
    useDensityStore.getState().set(s.isAuthenticated ? storedDensity(s.user?.id) : 'comfortable');
  };
  fromDevice();
  if (followingSessions) return;
  followingSessions = true;
  useAuthStore.subscribe((s, prev) => {
    const changed = (s.user?.id ?? null) !== (prev.user?.id ?? null) || s.isAuthenticated !== prev.isAuthenticated;
    if (changed) fromDevice();
  });
}

const MUTATION_KEY = ['density'] as const;

/** The person's settings (the same answer as the date settings and "Show my projects only"). */
function usePreferences() {
  const signedIn = useAuthStore((s) => s.isAuthenticated);
  return useQuery({ queryKey: DATE_PREFS_KEY, queryFn: () => preferencesApi(apiClient).get(), staleTime: 5 * 60_000, enabled: signedIn });
}

/** The density in force (Settings and the quick buttons show it; the page already wears it). */
export function useDensity(): Density {
  return useDensityStore((s) => s.density);
}

/**
 * Once per page (the app shell): the account's choice, when it arrives, is put on the page and
 * remembered on this device. While a change is being saved, the answer read before it is ignored.
 */
export function useDensitySync(): void {
  const { data } = usePreferences();
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const saving = useIsMutating({ mutationKey: MUTATION_KEY }) > 0;
  const fromAccount = (data as DatePreferences | undefined)?.density;
  useEffect(() => {
    if (saving || !isDensity(fromAccount)) return;
    useDensityStore.getState().set(fromAccount);
    rememberDensity(userId, fromAccount);
  }, [fromAccount, userId, saving]);
}

/**
 * Change it (Settings → Appearance, a quick button): shown at once and remembered here, then saved on
 * the account. A refused save puts the old choice back everywhere (`failed`: the caller says so).
 */
export function useSetDensity() {
  const qc = useQueryClient();
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const m = useMutation({
    mutationKey: MUTATION_KEY,
    // After any other change to these settings, in order (a double click: the last click wins).
    scope: PREFERENCES_SCOPE,
    mutationFn: ({ to }: { to: Density; before: Density }) => preferencesApi(apiClient).set({ density: to }),
    onMutate: async ({ to }) => {
      await qc.cancelQueries({ queryKey: DATE_PREFS_KEY });
      const cached = qc.getQueryData<DatePreferences>(DATE_PREFS_KEY);
      if (cached) qc.setQueryData<DatePreferences>(DATE_PREFS_KEY, { ...cached, density: to });
      return { cached };
    },
    onError: (_err, { before }, ctx) => {
      if (ctx?.cached) qc.setQueryData(DATE_PREFS_KEY, ctx.cached);
      useDensityStore.getState().set(before);
      rememberDensity(userId, before);
    },
    onSuccess: (prefs) => {
      qc.setQueryData(DATE_PREFS_KEY, prefs);
    },
    // Read the account again either way (a first read cancelled by the change is read now too).
    onSettled: () => qc.invalidateQueries({ queryKey: DATE_PREFS_KEY }),
  });
  return {
    change: (to: Density) => {
      const before = useDensityStore.getState().density;
      if (to === before && !m.isError) return;
      useDensityStore.getState().set(to);
      rememberDensity(userId, to);
      m.mutate({ to, before });
    },
    saving: m.isPending,
    failed: m.isError,
  };
}
