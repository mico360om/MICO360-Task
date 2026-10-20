import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ExpoConfig, ConfigContext } from 'expo/config';
// The Expo config loader can only `require` JSON here (not a sibling .ts), so the flavor table
// is shared as JSON with the app runtime (src/lib/app-env.ts reads the same file).
import flavors from './src/lib/flavors.json';

type AppEnv = 'development' | 'preview' | 'production';
const APP_ENVS: readonly string[] = ['development', 'preview', 'production'];

type Env = Record<string, string | undefined>;

/**
 * True when this config is evaluated for a release artifact: an EAS cloud build, or a
 * production bundle (`expo export` / the release Gradle bundling task run with NODE_ENV=production).
 */
export function isReleaseBuild(env: Env = process.env): boolean {
  return (env.EAS_BUILD ?? '').toLowerCase() === 'true' || env.NODE_ENV === 'production';
}

/**
 * Resolve the build flavor from APP_ENV. Local development may omit it (→ development), but a
 * release build MUST name its flavor: silently falling back to the development flavor would ship
 * an APK that talks to http://10.0.2.2 and can reach no server (MOB-12).
 */
export function resolveBuildAppEnv(env: Env = process.env): AppEnv {
  const raw = (env.APP_ENV ?? '').trim().toLowerCase();
  if (APP_ENVS.includes(raw)) return raw as AppEnv;
  if (isReleaseBuild(env)) {
    throw new Error(
      `APP_ENV must be one of ${APP_ENVS.join(', ')} for a release build (got "${env.APP_ENV ?? ''}"). ` +
        'Set it in the eas.json build profile or the environment.',
    );
  }
  return 'development';
}

/**
 * A build may only point at https, or plain http to an office-network address — passwords and
 * tokens must never cross the internet in clear text. Kept in step with isAllowedUrl in
 * src/lib/server-address.ts (this file can't import a sibling .ts; a test compares the two).
 */
export function isSecureBuildUrl(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol === 'https:') return true;
  if (u.protocol !== 'http:') return false;
  const h = u.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || /^[a-z0-9-]+(\.[a-z0-9-]+)*\.local$/.test(h)) return true;
  if (h.includes(':')) return h === '::1' || /^f[cd][0-9a-f]{0,2}:/.test(h) || /^fe[89ab][0-9a-f]?:/.test(h);
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (!m) return false;
  const a = Number(m[1]);
  const b = Number(m[2]);
  return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
}

/**
 * Firebase config for push (NTF-01). Taken from GOOGLE_SERVICES_JSON (an EAS file secret) or a
 * `google-services.json` next to this file; omitted when neither exists so builds without push
 * still work.
 */
export function resolveGoogleServicesFile(env: Env = process.env, cwd: string = process.cwd()): string | undefined {
  const fromEnv = (env.GOOGLE_SERVICES_JSON ?? '').trim();
  if (fromEnv) return fromEnv;
  return existsSync(resolve(cwd, 'google-services.json')) ? './google-services.json' : undefined;
}

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
  const appEnv = resolveBuildAppEnv(process.env);
  const f = flavors.flavors[appEnv];
  const apiOverride = (process.env.EXPO_PUBLIC_API_URL ?? '').trim();
  const apiBaseUrl = (apiOverride || f.apiBaseUrl).replace(/\/+$/, '');
  if (!isSecureBuildUrl(apiBaseUrl)) {
    throw new Error(`EXPO_PUBLIC_API_URL must use https:// (plain http only for an office-network server): ${apiBaseUrl}`);
  }
  const googleServicesFile = resolveGoogleServicesFile(process.env);
  return {
    ...config,
    name: `${flavors.baseName}${f.nameSuffix}`,
    slug: config.slug ?? 'mico360-tasks',
    android: {
      ...config.android,
      package: `${flavors.basePackage}${f.pkgSuffix}`,
      ...(googleServicesFile ? { googleServicesFile } : {}),
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
