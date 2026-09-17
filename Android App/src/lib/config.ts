import { resolveAppEnv, type AppEnv } from './app-env';

/**
 * The API base URL. On an Android emulator, the host machine's localhost is
 * reachable at 10.0.2.2, so that is the dev default; per-flavor values are injected
 * at build time via Expo config `extra.apiBaseUrl` (see `app.config.ts`).
 */
export const DEFAULT_API_BASE = 'http://10.0.2.2:4000/api/v1';

export function resolveApiBaseUrl(extra?: { apiBaseUrl?: unknown } | null): string {
  const v = extra?.apiBaseUrl;
  return typeof v === 'string' && v.trim() ? v.trim().replace(/\/+$/, '') : DEFAULT_API_BASE;
}

/** The build flavor baked into Expo config `extra.appEnv`; defaults to development. */
export function resolveRuntimeAppEnv(extra?: { appEnv?: unknown } | null): AppEnv {
  return resolveAppEnv(typeof extra?.appEnv === 'string' ? extra.appEnv : undefined);
}

export interface RuntimeConfig {
  apiBaseUrl: string;
  appEnv: AppEnv;
  isProduction: boolean;
}

/** Resolve the full runtime config (API endpoint + flavor) from Expo config `extra`. */
export function resolveRuntimeConfig(extra?: { apiBaseUrl?: unknown; appEnv?: unknown } | null): RuntimeConfig {
  const appEnv = resolveRuntimeAppEnv(extra);
  return { apiBaseUrl: resolveApiBaseUrl(extra), appEnv, isProduction: appEnv === 'production' };
}
