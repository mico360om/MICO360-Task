import { it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { appPath, appSource as src } from '../testing/web-source';

/**
 * Device check N12 (31 Oct): a cold start showed ~0.4 s of blank before the skeleton — the phone's
 * own white window (AppCompat's #FAFAFA) under a maroon status bar, then the app's plain ground with a
 * spinner — never the maroon logo splash; and in dark mode a white strip at the bottom for a frame,
 * where the window showed through when the status bar turned see-through and the app moved up under
 * it. Now the window itself is the splash's maroon, the status bar is see-through from the first
 * frame (so nothing moves later), and every wait before the first screen is the logo splash.
 */
const manifest = JSON.parse(readFileSync(appPath('app.json'), 'utf8')) as { expo: { splash: { backgroundColor: string }; android: { backgroundColor?: string } } };

it('the window behind the app is the splash’s maroon, never the phone theme’s white', () => {
  expect(manifest.expo.splash.backgroundColor).toBe('#8B1E1E');
  expect(manifest.expo.android.backgroundColor).toBe(manifest.expo.splash.backgroundColor);
});

it('the status bar is see-through, light on the maroon, before the first frame', () => {
  const app = src('../App.tsx');
  const top = app.slice(0, app.indexOf('export default function App'));
  expect(top).toMatch(/if \(Platform\.OS === 'android'\) \{\s*StatusBar\.setTranslucent\(true\);\s*StatusBar\.setBackgroundColor\('transparent'\);\s*StatusBar\.setBarStyle\('light-content'\);\s*\}/);
  expect(app).toMatch(/import \{ Platform, StatusBar \} from 'react-native';/);
});

it('every wait before the first screen is the logo splash, not a spinner on the ground', () => {
  const providers = src('core/providers.tsx');
  expect(providers).toMatch(/if \(server === undefined\) return <FontSplash \/>;/);
  expect(providers).toMatch(/if \(!ready\) return <FontSplash \/>;/);
  expect(providers).not.toMatch(/ActivityIndicator/);
  expect(providers).not.toMatch(/function Splash\(/);
});

// The lock gate covers the app until a signed-in person's lock setting is read (only at the start:
// lib/lock-view): that wait was the blank ground just before the skeleton — the logo splash now.
it('the lock gate’s start-up cover is the logo splash, its status bar light on the maroon', () => {
  expect(src('components/LockGate.tsx')).toMatch(/\{view === 'cover' \? \(\s*<View style=\{StyleSheet\.absoluteFill\}>\s*<FontSplash \/>\s*<\/View>\s*\) : null\}/);
  const splash = src('components/FontSplash.tsx');
  expect(splash).toMatch(/import \{ StatusBar \} from 'expo-status-bar';/);
  expect(splash).toMatch(/<StatusBar style="light" \/>/);
});
