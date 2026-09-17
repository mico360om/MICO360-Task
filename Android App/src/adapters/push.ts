import * as Notifications from 'expo-notifications';

/**
 * Request notification permission and return the device's native (FCM) push
 * token, or null if permission was denied / unavailable. Fed to the push
 * registrar's `getPushToken` port.
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
    return null;
  }
}
