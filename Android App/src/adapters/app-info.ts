import Constants from 'expo-constants';
import type { AppInfo } from '../lib/app-version';

/** This build's version and Android build number, as baked into the app at build time. */
export function appInfo(): AppInfo {
  const config = Constants.expoConfig;
  return { version: config?.version ?? '0.0.0', build: config?.android?.versionCode ?? 0 };
}
