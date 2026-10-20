import * as ScreenCapture from 'expo-screen-capture';

/**
 * While the app lock is on, block screenshots and screen recording, and blank the app's preview in
 * the recent-apps list (Android FLAG_SECURE). Off again when the lock is turned off.
 */
export async function setScreenPrivacy(on: boolean): Promise<void> {
  try {
    if (on) await ScreenCapture.preventScreenCaptureAsync('app-lock');
    else await ScreenCapture.allowScreenCaptureAsync('app-lock');
  } catch {
    // Not available on this device: nothing to do.
  }
}
