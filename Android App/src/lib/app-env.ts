import flavors from './flavors.json';

/**
 * Build flavors for the Android app. Three environments — development, preview and
 * production — differ by API endpoint, display name and Android application id so all three
 * can be installed on one device side by side. The flavor is selected at build time by the
 * `APP_ENV` variable (set per profile in `eas.json`); `app.config.ts` turns it into the Expo
 * config. The per-flavor table lives in `flavors.json` so both this module and the Expo config
 * loader (which can only `require` JSON, not sibling `.ts`) read one source of truth.
 *
 * Pure TypeScript (no React Native / Expo imports) so it is unit-testable and safe to import
 * from the app runtime.
 */

export type AppEnv = 'development' | 'preview' | 'production';

export const APP_ENVS = ['development', 'preview', 'production'] as const;

/** Normalize a raw `APP_ENV` string to a known flavor; empty/unknown ⇒ development. */
export function resolveAppEnv(raw?: string | null): AppEnv {
  const v = (raw ?? '').trim().toLowerCase();
  return (APP_ENVS as readonly string[]).includes(v) ? (v as AppEnv) : 'development';
}

export interface FlavorConfig {
  appEnv: AppEnv;
  /** App display name, suffixed for non-prod so flavors are distinguishable on the device. */
  name: string;
  /** Android application id, suffixed for non-prod so flavors install side by side. */
  androidPackage: string;
  /** Default API base URL for this flavor (overridable via EXPO_PUBLIC_API_URL). */
  apiBaseUrl: string;
  /** True only for the production flavor. */
  isProduction: boolean;
}

/** Resolve the full flavor configuration, applying an optional API URL override. */
export function flavorConfig(env: AppEnv, overrides?: { apiUrl?: string | null }): FlavorConfig {
  const f = flavors.flavors[env];
  const override = (overrides?.apiUrl ?? '').trim();
  return {
    appEnv: env,
    name: `${flavors.baseName}${f.nameSuffix}`,
    androidPackage: `${flavors.basePackage}${f.pkgSuffix}`,
    apiBaseUrl: (override || f.apiBaseUrl).replace(/\/+$/, ''),
    isProduction: env === 'production',
  };
}
