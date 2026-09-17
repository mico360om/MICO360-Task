import type { ExpoConfig, ConfigContext } from 'expo/config';
// The Expo config loader can only `require` JSON here (not a sibling .ts), so the flavor table
// is shared as JSON with the app runtime (src/lib/app-env.ts reads the same file).
import flavors from './src/lib/flavors.json';

type AppEnv = 'development' | 'preview' | 'production';
const APP_ENVS: readonly string[] = ['development', 'preview', 'production'];
const resolveAppEnv = (raw?: string): AppEnv => {
  const v = (raw ?? '').trim().toLowerCase();
  return APP_ENVS.includes(v) ? (v as AppEnv) : 'development';
};

/**
 * Dynamic Expo config. The build flavor is chosen by the `APP_ENV` variable (set per profile
 * in `eas.json`) and layered on top of the static `app.json` base. `EXPO_PUBLIC_API_URL`
 * overrides the API endpoint for pointing a build at a specific backend (e.g. a LAN dev box).
 *
 *   APP_ENV=development npx expo start   # MICO360 Tasks (Dev)     · com.mico360.tasks.dev
 *   APP_ENV=preview     eas build …      # MICO360 Tasks (Preview) · com.mico360.tasks.preview
 *   APP_ENV=production  eas build …      # MICO360 Tasks           · com.mico360.tasks
 */
export default ({ config }: ConfigContext): ExpoConfig => {
  const appEnv = resolveAppEnv(process.env.APP_ENV);
  const f = flavors.flavors[appEnv];
  const apiOverride = (process.env.EXPO_PUBLIC_API_URL ?? '').trim();
  const apiBaseUrl = (apiOverride || f.apiBaseUrl).replace(/\/+$/, '');
  return {
    ...config,
    name: `${flavors.baseName}${f.nameSuffix}`,
    slug: config.slug ?? 'mico360-tasks',
    android: {
      ...config.android,
      package: `${flavors.basePackage}${f.pkgSuffix}`,
    },
    extra: {
      ...config.extra,
      appEnv,
      apiBaseUrl,
      // Crash reporting DSN (A9.3). Ops sets EXPO_PUBLIC_SENTRY_DSN in the EAS build profile; when
      // absent the app reports nothing (see buildReporter in App.tsx).
      sentryDsn: (process.env.EXPO_PUBLIC_SENTRY_DSN ?? '').trim() || undefined,
    },
  };
};
