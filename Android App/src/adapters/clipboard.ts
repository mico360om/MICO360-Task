import * as ReactNative from 'react-native';

/**
 * Copy text to the phone's clipboard (3b, "Copy text"). React Native 0.74 still ships its own
 * Clipboard module (deprecated in favour of a separate package, which this app doesn't add — no new
 * packages); a build where it is gone says "Couldn't copy" instead of crashing.
 */
export function copyText(text: string): boolean {
  try {
    const clipboard = (ReactNative as unknown as { Clipboard?: { setString?: (t: string) => void } }).Clipboard;
    if (!clipboard || typeof clipboard.setString !== 'function') return false;
    clipboard.setString(text);
    return true;
  } catch {
    return false;
  }
}
