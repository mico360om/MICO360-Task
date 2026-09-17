import Constants from 'expo-constants';
import { createApiClient } from '../lib/api-client';
import { createSessionStore } from '../lib/session-store';
import { resolveRuntimeConfig } from '../lib/config';
import type { AppEnv } from '../lib/app-env';
import { resourcesApi } from '../lib/resources';
import { createReadCache } from '../lib/read-cache';
import { createSyncQueue, type QueuedMutation } from '../lib/sync-queue';
import { performMutation } from '../lib/perform-mutation';
import { createSyncController } from '../lib/sync-controller';
import { createPushRegistrar } from '../lib/push-registrar';
import { createBiometricGate } from '../lib/biometric-gate';
import { createBiometricLogin } from '../lib/biometric-login';
import { authApi } from '../lib/auth';
import { ApiError } from '../lib/api-client';
import { secureStore } from '../adapters/secure-store';
import { asyncStore } from '../adapters/async-storage';
import { getPushToken } from '../adapters/push';
import { isBiometricAvailable, authenticateBiometric } from '../adapters/biometric';
import type { Session } from '../lib/types';

export interface Services {
  baseUrl: string;
  /** The active build flavor (development | preview | production). */
  appEnv: AppEnv;
  session: ReturnType<typeof createSessionStore>;
  api: ReturnType<typeof createApiClient>;
  auth: ReturnType<typeof authApi>;
  resources: ReturnType<typeof resourcesApi>;
  cache: ReturnType<typeof createReadCache>;
  queue: ReturnType<typeof createSyncQueue>;
  sync: ReturnType<typeof createSyncController>;
  push: ReturnType<typeof createPushRegistrar>;
  biometric: ReturnType<typeof createBiometricGate>;
  biometricLogin: ReturnType<typeof createBiometricLogin>;
}

/**
 * Composition root for the mobile app: wires the framework-agnostic logic core
 * (src/lib/*) to the native adapters (SecureStore, AsyncStorage, push, biometric).
 */
export function createServices(): Services {
  const { apiBaseUrl: baseUrl, appEnv } = resolveRuntimeConfig(
    Constants.expoConfig?.extra as { apiBaseUrl?: unknown; appEnv?: unknown } | undefined,
  );

  const session = createSessionStore({ store: secureStore });

  // Silent token refresh: exchange the refresh token for a fresh session on a 401.
  async function refreshTokens(): Promise<boolean> {
    const current = session.getSession();
    if (!current?.refreshToken) return false;
    try {
      const res = await fetch(`${baseUrl}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: current.refreshToken }),
      });
      if (!res.ok) return false;
      const json = (await res.json()) as { data: Session };
      await session.setSession(json.data);
      // The server single-uses refresh tokens, so a silent refresh revokes the token biometric
      // login remembered. Re-arm it with the rotated token or biometric sign-in silently dies.
      if (await biometricLogin.isArmed()) {
        const remembered = await biometricLogin.getCredential();
        await biometricLogin.arm(json.data.refreshToken, remembered?.label);
      }
      return true;
    } catch {
      return false;
    }
  }

  const api = createApiClient({
    baseUrl,
    getToken: () => session.getToken(),
    refreshTokens,
    onUnauthorized: () => session.logout(), // refresh failed → back to login
  });
  const resources = resourcesApi(api);
  const cache = createReadCache({ store: asyncStore });

  const queue = createSyncQueue({
    store: asyncStore,
    perform: (m: QueuedMutation) => performMutation(resources, m),
    shouldDrop: (error) => error instanceof ApiError && error.status >= 400 && error.status < 500 && error.status !== 408 && error.status !== 429,
  });

  const push = createPushRegistrar({
    getPushToken,
    registerToken: (token, platform) => resources.deviceTokens.register(token, platform),
    unregisterToken: (token) => resources.deviceTokens.unregister(token),
    store: asyncStore,
  });

  const sync = createSyncController({ queue });

  // The "biometric lock enabled" flag must live in the keystore too — in plain AsyncStorage anyone
  // with filesystem access could delete it and walk straight past the lock into a live session.
  const biometric = createBiometricGate({
    isAvailable: isBiometricAvailable,
    authenticate: authenticateBiometric,
    store: secureStore,
  });
  // The remembered refresh token for biometric login lives in the secure keystore.
  const biometricLogin = createBiometricLogin({ store: secureStore });

  return { baseUrl, appEnv, session, api, auth: authApi(api), resources, cache, queue, sync, push, biometric, biometricLogin };
}
