import { useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../api/client';
import { useAuthStore } from '../stores/auth-store';
import { useManagerViewStore } from '../stores/manager-view-store';

export { MANAGER_VIEW_CODE, isManagerViewRefusal, noteManagerViewRefusal, useManagerViewStore } from '../stores/manager-view-store';

/**
 * Manager View (owner, 10 Nov 2026): an administrator's own switch in the Account menu, saved on their
 * account. While it is on the Admin menu is gone (User Management, Clients, Companies, AI Management,
 * System Settings, Error Log, Audit Logs), its pages' addresses show "Manager View is on — turn it off to
 * open this page" with Turn off, and a project's settings show only where they run the project — the server
 * refuses the rest (403 MANAGER_VIEW) for the website, the app and the extension alike. Everything else stays
 * an administrator's: every project's work, Reports, Management, their own settings.
 *
 * The switch is read once per sign-in (GET /users/me/manager-view) and remembered on this device for the
 * next visit (so the Admin menu doesn't flash), and any 403 MANAGER_VIEW (it was turned on elsewhere) turns
 * it on here too.
 */

export const MANAGER_VIEW_WORDS = {
  label: 'Manager View',
  hint: 'Hides settings and admin pages',
  badge: 'Manager View',
  badgeTitle: 'Manager View is on: settings and admin pages are hidden. Turn it off in your account menu.',
  blockedTitle: 'Manager View is on',
  blockedText: 'Manager View is on — turn it off to open this page.',
  turnOff: 'Turn off Manager View',
  turningOff: 'Turning off…',
  turnedOn: 'Manager View is on. Settings and admin pages are hidden.',
  turnedOff: 'Manager View is off.',
  failed: 'Couldn’t change Manager View. Please try again.',
} as const;

/** This administrator's Manager View: on, and whether that is known yet. Never on for anyone else. */
export function useManagerView(): { available: boolean; on: boolean; known: boolean } {
  const user = useAuthStore((s) => s.user);
  const admin = !!user && (user.roles ?? []).includes('ADMIN');
  const mine = useManagerViewStore((s) => (user && s.userId === user.id ? s.on : null));
  if (!admin) return { available: false, on: false, known: true };
  return { available: true, on: mine === true, known: mine !== null };
}

/**
 * The "effective administrator": an administrator with Manager View off. Settings and configuration ask
 * this (the Admin menu, project settings, admin-only settings on other pages); the work asks isAdmin().
 * Until the switch is known (the first visit on a device) it counts as off — the server refuses whatever
 * Manager View closes, and its refusal turns it on here at once.
 */
export function useEffectiveAdmin(): boolean {
  const { available, on } = useManagerView();
  return available && !on;
}

/** Read the switch from the server once per signed-in administrator (the app shell calls it). */
export function useManagerViewSync(): void {
  const user = useAuthStore((s) => s.user);
  const admin = !!user && (user.roles ?? []).includes('ADMIN');
  const userId = user?.id ?? null;
  useEffect(() => {
    if (!admin || !userId) return;
    let live = true;
    apiClient
      .get<{ data: { available: boolean; managerView: boolean } }>('/users/me/manager-view')
      .then((r) => {
        if (live) useManagerViewStore.getState().set(userId, r.data.available && r.data.managerView);
      })
      .catch(() => {
        // Unknown (offline, an older server without the switch): off, as before the switch existed —
        // the server still refuses what Manager View closes, and a refusal turns it on here.
        if (live && useManagerViewStore.getState().userId !== userId) useManagerViewStore.getState().set(userId, false);
      });
    return () => {
      live = false;
    };
  }, [admin, userId]);
}

/**
 * Turn it on or off. The server has it at once (no new sign-in); every cached answer is read again, since
 * what may be changed (a project's "may change it") follows it.
 */
export function useSetManagerView() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (on: boolean) => apiClient.put<{ data: { available: boolean; managerView: boolean } }>('/users/me/manager-view', { on }).then((r) => r.data),
    onSuccess: (data) => {
      const me = useAuthStore.getState().user;
      if (me) useManagerViewStore.getState().set(me.id, data.available && data.managerView);
      void qc.invalidateQueries();
    },
  });
}
