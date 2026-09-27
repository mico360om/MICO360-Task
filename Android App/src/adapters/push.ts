import { Linking, Platform } from 'react-native';
import * as Notifications from 'expo-notifications';

/** Android channel the backend should target (`android.notification.channel_id`). */
export const PUSH_CHANNEL_ID = 'default';

export type PushPermission = 'granted' | 'denied' | 'undetermined';

let configured = false;

/**
 * One-time notification setup (NTF-01): show pushes that arrive while the app is open, and create
 * the Android channel with high importance so they appear as heads-up notifications.
 */
export function configureNotifications(): void {
  if (configured) return;
  configured = true;
  try {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({ shouldShowAlert: true, shouldPlaySound: true, shouldSetBadge: false }),
    });
    if (Platform.OS === 'android') {
      void Notifications.setNotificationChannelAsync(PUSH_CHANNEL_ID, {
        name: 'MICO360 Tasks',
        importance: Notifications.AndroidImportance.HIGH,
        lightColor: '#8B1E1E',
      }).catch(() => {});
    }
  } catch {
    /* notifications unavailable (e.g. Expo Go on some devices) — the app works without them */
  }
}

/** Current notification permission without prompting. */
export async function getPushPermission(): Promise<{ status: PushPermission; canAskAgain: boolean }> {
  try {
    const p = await Notifications.getPermissionsAsync();
    const status: PushPermission = p.granted ? 'granted' : p.status === 'denied' ? 'denied' : 'undetermined';
    return { status, canAskAgain: p.canAskAgain };
  } catch {
    return { status: 'undetermined', canAskAgain: false };
  }
}

/**
 * Request notification permission (only asks when the OS still allows asking) and return the
 * device's native FCM push token, or null if permission was denied / Firebase is not configured.
 * Fed to the push registrar's `getPushToken` port.
 */
export async function getPushToken(): Promise<string | null> {
  try {
    const settings = await Notifications.getPermissionsAsync();
    let granted = settings.granted;
    if (!granted && settings.canAskAgain) {
      granted = (await Notifications.requestPermissionsAsync()).granted;
    }
    if (!granted) return null;
    const token = await Notifications.getDevicePushTokenAsync();
    return typeof token.data === 'string' ? token.data : null;
  } catch {
    // No google-services.json in the build → FCM cannot issue a token.
    return null;
  }
}

/** Subscribe to FCM token rotation; the listener receives the new token. */
export function addPushTokenListener(listener: (token: string) => void): { remove(): void } {
  try {
    const sub = Notifications.addPushTokenListener((t) => {
      if (typeof t.data === 'string' && t.data) listener(t.data);
    });
    return { remove: () => sub.remove() };
  } catch {
    return { remove: () => {} };
  }
}

/** Open this app's system settings (to turn notifications back on after a denial). */
export function openAppSettings(): void {
  void Linking.openSettings().catch(() => {});
}
