import { Alert, Platform, ToastAndroid } from 'react-native';

/**
 * A short notice that shows and stays readable without blocking (Android's own toast; TalkBack
 * reads it) — e.g. "Saved on this phone", or how a form left while it sent ended.
 */
export function notice(text: string): void {
  if (Platform.OS === 'android') ToastAndroid.show(text, ToastAndroid.LONG);
  else Alert.alert(text);
}
