import { useEffect } from 'react';
import { useIsMutating, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { create } from 'zustand';
import { apiClient } from '../api/client';
import { PREFERENCES_SCOPE, preferencesApi, type DatePreferences } from '../api/preferences';
import { useAuthStore } from '../stores/auth-store';
import { DATE_PREFS_KEY } from './useDatePrefs';
import { readUserValue, writeUserValue } from './user-storage';
import { BOARD_WIDTH_PREF, SIDEBAR_PREF } from './appearance-names';

/**
 * 1.23.8 Two look settings, each person's own and saved on their account (as the row mode is, lib/density):
 *  - the side menu folded to its icon rail on a desktop screen (the « button; tablets always show the rail,
 *    phones the ☰ menu) — `<html data-sidebar="open|collapsed">`, read by the `rail:` variant;
 *  - the Kanban board's column width, Narrow · Normal · Wide — `<html data-board-width>`, which sets the
 *    `--board-col` a column is at least as wide as (index.css); columns still share any room left over.
 * The same pattern as the row mode: the last choice on this device before the first paint (no jump), the
 * account's when it answers, a change shown at once and saved after any other settings change, put back
 * everywhere when the save is refused.
 */

export type BoardColumnWidth = 'narrow' | 'normal' | 'wide';
export const BOARD_COLUMN_WIDTHS: BoardColumnWidth[] = ['narrow', 'normal', 'wide'];

export interface Appearance {
  sidebarCollapsed: boolean;
  boardColumnWidth: BoardColumnWidth;
}

const DEFAULTS: Appearance = { sidebarCollapsed: false, boardColumnWidth: 'normal' };

export const isBoardColumnWidth = (v: unknown): v is BoardColumnWidth => v === 'narrow' || v === 'normal' || v === 'wide';

/** Stamp the look on the page (always concrete words, so the CSS and the tests can read them). */
export function applyAppearance(a: Appearance): void {
  try {
    document.documentElement.setAttribute('data-sidebar', a.sidebarCollapsed ? 'collapsed' : 'open');
    document.documentElement.setAttribute('data-board-width', a.boardColumnWidth);
  } catch {
    /* no document — nothing to stamp */
  }
}

/** This person's last choices on this device (the defaults when there are none, or nobody is signed in). */
export function storedAppearance(userId: string | null | undefined): Appearance {
  const width = readUserValue(userId, BOARD_WIDTH_PREF);
  return { sidebarCollapsed: readUserValue(userId, SIDEBAR_PREF) === 'collapsed', boardColumnWidth: isBoardColumnWidth(width) ? width : 'normal' };
}

/** Remember them on this device for the next page load (the defaults leave nothing behind). */
export function rememberAppearance(userId: string | null | undefined, a: Partial<Appearance>): void {
  if (a.sidebarCollapsed !== undefined) writeUserValue(userId, SIDEBAR_PREF, a.sidebarCollapsed ? 'collapsed' : null);
  if (a.boardColumnWidth !== undefined) writeUserValue(userId, BOARD_WIDTH_PREF, a.boardColumnWidth === 'normal' ? null : a.boardColumnWidth);
}

interface AppearanceState {
  look: Appearance;
  set: (patch: Partial<Appearance>) => void;
}

/** The look in force — the one source the page, Settings and the buttons read. */
export const useAppearanceStore = create<AppearanceState>((set, get) => ({
  look: DEFAULTS,
  set: (patch) => {
    const look = { ...get().look, ...patch };
    applyAppearance(look);
    set({ look });
  },
}));

export const useSidebarCollapsed = (): boolean => useAppearanceStore((s) => s.look.sidebarCollapsed);
export const useBoardColumnWidth = (): BoardColumnWidth => useAppearanceStore((s) => s.look.boardColumnWidth);

let followingSessions = false;

/** At start, before the first paint: the signed-in person's last choices here; again whenever who is signed in changes. */
export function initAppearance(): void {
  const fromDevice = () => {
    const s = useAuthStore.getState();
    useAppearanceStore.getState().set(s.isAuthenticated ? storedAppearance(s.user?.id) : DEFAULTS);
  };
  fromDevice();
  if (followingSessions) return;
  followingSessions = true;
  useAuthStore.subscribe((s, prev) => {
    const changed = (s.user?.id ?? null) !== (prev.user?.id ?? null) || s.isAuthenticated !== prev.isAuthenticated;
    if (changed) fromDevice();
  });
}

const MUTATION_KEY = ['appearance'] as const;

/**
 * Once per page (the app shell): the account's choices, when they arrive, are put on the page and
 * remembered on this device. While a change is being saved, an answer read before it is ignored.
 */
export function useAppearanceSync(): void {
  const signedIn = useAuthStore((s) => s.isAuthenticated);
  const { data } = useQuery({ queryKey: DATE_PREFS_KEY, queryFn: () => preferencesApi(apiClient).get(), staleTime: 5 * 60_000, enabled: signedIn });
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const saving = useIsMutating({ mutationKey: MUTATION_KEY }) > 0;
  const prefs = data as DatePreferences | undefined;
  const collapsed = prefs?.sidebarCollapsed;
  const width = prefs?.boardColumnWidth;
  useEffect(() => {
    if (saving) return;
    const patch: Partial<Appearance> = {};
    if (typeof collapsed === 'boolean') patch.sidebarCollapsed = collapsed;
    if (isBoardColumnWidth(width)) patch.boardColumnWidth = width;
    if (Object.keys(patch).length === 0) return;
    useAppearanceStore.getState().set(patch);
    rememberAppearance(userId, patch);
  }, [collapsed, width, userId, saving]);
}

/**
 * Change one or both (the « button, the board's Column width, Settings → Appearance): shown at once and
 * remembered here, then saved on the account after any other settings change. A refused save puts back
 * what this change changed (`failed`: the caller says so).
 */
export function useSetAppearance() {
  const qc = useQueryClient();
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const m = useMutation({
    mutationKey: MUTATION_KEY,
    scope: PREFERENCES_SCOPE,
    mutationFn: ({ to }: { to: Partial<Appearance>; before: Partial<Appearance> }) => preferencesApi(apiClient).set(to),
    onMutate: async ({ to }) => {
      await qc.cancelQueries({ queryKey: DATE_PREFS_KEY });
      const cached = qc.getQueryData<DatePreferences>(DATE_PREFS_KEY);
      if (cached) qc.setQueryData<DatePreferences>(DATE_PREFS_KEY, { ...cached, ...to });
      return { cached };
    },
    onError: (_err, { before }, ctx) => {
      if (ctx?.cached) qc.setQueryData(DATE_PREFS_KEY, ctx.cached);
      useAppearanceStore.getState().set(before);
      rememberAppearance(userId, before);
    },
    onSuccess: (prefs) => {
      qc.setQueryData(DATE_PREFS_KEY, prefs);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: DATE_PREFS_KEY }),
  });
  return {
    change: (to: Partial<Appearance>) => {
      const now = useAppearanceStore.getState().look;
      const before: Partial<Appearance> = {};
      const changed: Partial<Appearance> = {};
      if (to.sidebarCollapsed !== undefined && (to.sidebarCollapsed !== now.sidebarCollapsed || m.isError)) {
        before.sidebarCollapsed = now.sidebarCollapsed;
        changed.sidebarCollapsed = to.sidebarCollapsed;
      }
      if (to.boardColumnWidth !== undefined && (to.boardColumnWidth !== now.boardColumnWidth || m.isError)) {
        before.boardColumnWidth = now.boardColumnWidth;
        changed.boardColumnWidth = to.boardColumnWidth;
      }
      if (Object.keys(changed).length === 0) return;
      useAppearanceStore.getState().set(changed);
      rememberAppearance(userId, changed);
      m.mutate({ to: changed, before });
    },
    saving: m.isPending,
    failed: m.isError,
  };
}
