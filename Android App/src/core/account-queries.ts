import { useMemo } from 'react';
import { AccessibilityInfo } from 'react-native';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useServices } from './providers';
import { CALENDAR_KEY, CALENDAR_MEETINGS_KEY, DATE_PREFERENCES_KEY } from './calendar-queries';
import { asyncStore } from '../adapters/async-storage';
import { withAvatar, withDirectoryUser, type ApiAccountUser } from '../lib/account';
import { createPasswordChange } from '../lib/password-change';
import { reopenNote, zonesDiffer } from '../lib/reopen-note';
import { DATE_ZONES_KEY, datePrefsSavedText, nextDateZones, withDatePatch, type DatePreferences } from '../lib/date-settings';
import { dateZones, setDateZones } from '../lib/due-date';
import { mergePreferences, type NotificationPreferences, type PreferencesUpdate } from '../lib/notification-prefs';
import { itemLanes } from '../lib/item-lanes';
import type { ApiDirectoryUser } from '../lib/types';

/**
 * Your account and settings (6a): the profile photo, the password, the date settings and the
 * daily task emails. Each is saved on the server at once, as on the website (nothing is queued for
 * later); a change that can't be saved is undone on screen and says why.
 */

const PREFS_KEY = ['notifications', 'preferences'];
const DIRECTORY_KEY = ['chat', 'directory'];
/** The item lanes your settings are saved in: each save waits for the one before it. */
const PREFS_LANE = 'settings:notification-preferences';
const DATE_PREFS_LANE = 'settings:date-preferences';

/** The profile photo: upload or remove it; the new one shows at once here, in the menu and in people lists. */
export function useAvatar() {
  const { resources, session } = useServices();
  const qc = useQueryClient();
  const applied = (user: ApiAccountUser) => {
    const held = session.getSession();
    if (held && held.user.id === user.id) void session.setSession(withAvatar(held, user.avatarUrl ?? null));
    qc.setQueryData<ApiDirectoryUser[]>(DIRECTORY_KEY, (list) => withDirectoryUser(list, { id: user.id, avatarUrl: user.avatarUrl ?? null }));
    void qc.invalidateQueries({ queryKey: DIRECTORY_KEY });
  };
  const upload = useMutation({
    mutationFn: (part: { uri: string; name: string; type: string }) => resources.account.uploadAvatar(part),
    onSuccess: applied,
  });
  const remove = useMutation({ mutationFn: () => resources.account.removeAvatar(), onSuccess: applied });
  return { upload, remove };
}

/**
 * Change your own password (lib/password-change). Not a TanStack mutation on purpose: the
 * passwords would be kept in its cache; here they live only in the form and this call.
 */
export function usePasswordChange() {
  const { resources, session, push, biometricLogin, connectivity, passwordGate, isSigningOut } = useServices();
  return useMemo(
    () =>
      createPasswordChange({
        send: (current, next) => resources.account.changePassword(current, next),
        session,
        registerPush: () => push.register(),
        fingerprint: biometricLogin,
        // Known to be offline: nothing is sent (a change sent without an answer may have happened).
        isOnline: () => connectivity.isOnline(),
        // A refresh refused meanwhile waits for the fresh session; a sign-out under way isn't undone.
        gate: passwordGate,
        isSigningOut,
      }),
    [resources, session, push, biometricLogin, connectivity, passwordGate, isSigningOut],
  );
}

/**
 * Save a change to your notification preferences or daily task emails. Only what changed is sent;
 * the screen shows at once what the server will keep (mergePreferences), and goes back if the
 * save fails. Saves go one at a time, in the order they were made.
 */
export function useSavePreferences() {
  const { resources } = useServices();
  const qc = useQueryClient();
  return useMutation({
    // One save after another, in the order they were made (the app's item lanes, as every other write).
    mutationFn: (body: PreferencesUpdate) => itemLanes.run(PREFS_LANE, () => resources.preferences.save(body)),
    onMutate: async (body) => {
      await qc.cancelQueries({ queryKey: PREFS_KEY });
      const previous = qc.getQueryData<NotificationPreferences>(PREFS_KEY);
      qc.setQueryData(PREFS_KEY, mergePreferences(previous, body));
      return { previous };
    },
    onError: (_e, _body, ctx) => {
      if (ctx?.previous) qc.setQueryData(PREFS_KEY, ctx.previous);
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: PREFS_KEY });
    },
  });
}

/** "Send me a test now" for the daily task emails. */
export function useSendDailyEmailTest() {
  const { resources } = useServices();
  return useMutation({ mutationFn: () => resources.preferences.sendDailyEmailTest() });
}

/**
 * Save your week start or own time zone (shared with the website). The calendar follows at once;
 * a new time zone is kept for the next start and every screen opens again in it (as when the
 * website's settings are loaded), and the calendar's days are fetched again.
 */
export function useSaveDatePreferences() {
  const { resources } = useServices();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<DatePreferences>) => itemLanes.run(DATE_PREFS_LANE, () => resources.settings.setDatePreferences(patch)),
    onMutate: async (patch) => {
      await qc.cancelQueries({ queryKey: DATE_PREFERENCES_KEY });
      const previous = qc.getQueryData<DatePreferences>(DATE_PREFERENCES_KEY);
      qc.setQueryData<DatePreferences>(DATE_PREFERENCES_KEY, withDatePatch(previous, patch));
      return { previous };
    },
    onError: (_e, _patch, ctx) => {
      if (ctx?.previous) qc.setQueryData(DATE_PREFERENCES_KEY, ctx.previous);
      else void qc.invalidateQueries({ queryKey: DATE_PREFERENCES_KEY });
    },
    onSuccess: async (saved, _patch, ctx) => {
      const said = datePrefsSavedText(ctx?.previous, saved);
      qc.setQueryData(DATE_PREFERENCES_KEY, saved);
      // Read again through the offline copy, so an offline start has the new settings too.
      void qc.invalidateQueries({ queryKey: DATE_PREFERENCES_KEY });
      for (const queryKey of [CALENDAR_KEY, CALENDAR_MEETINGS_KEY]) void qc.invalidateQueries({ queryKey });
      const next = nextDateZones(dateZones(), { config: null, prefs: saved });
      // A new zone opens every screen again: the reopened Settings returns to Calendar & dates and
      // says what was saved then (said now, it would be cut off — 6a review).
      if (zonesDiffer(dateZones(), next)) reopenNote.leave({ section: 'dates', announce: said });
      else AccessibilityInfo.announceForAccessibility(said);
      await asyncStore.setItem(DATE_ZONES_KEY, JSON.stringify(next)).catch(() => {});
      setDateZones(next);
    },
  });
}
