import Constants from 'expo-constants';
import { QueryClient } from '@tanstack/react-query';
import { createApiClient, classifyRefreshStatus, ApiError, DEFAULT_TIMEOUT_MS, type RefreshOutcome } from '../lib/api-client';
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
import { createSignOut } from '../lib/sign-out';
import { createExporter } from '../lib/exporter';
import { authApi } from '../lib/auth';
import { secureStore, biometricSecureStore } from '../adapters/secure-store';
import { asyncStore } from '../adapters/async-storage';
import { getPushToken } from '../adapters/push';
import { exportFiles } from '../adapters/files';
import { isBiometricAvailable, authenticateBiometric } from '../adapters/biometric';
import type { Session } from '../lib/types';

export interface Services {
  baseUrl: string;
  /** This build's own server (used when no other server was chosen on the sign-in screen). */
  defaultBaseUrl: string;
  /** The active build flavor (development | preview | production). */
  appEnv: AppEnv;
  queryClient: QueryClient;
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
  /** The one sign-out routine every path must use (XP-01). */
  signOut: ReturnType<typeof createSignOut>['signOut'];
  /** Report / task exports (.xlsx, .pdf, .csv): download with the session, then the share sheet. */
  exporter: ReturnType<typeof createExporter>;
  /** The signed-in user's id (or null). */
  currentUserId: () => string | null;
}

/**
 * Composition root for the mobile app: wires the framework-agnostic logic core
 * (src/lib/*) to the native adapters (SecureStore, AsyncStorage, push, biometric).
 */
export function createServices(opts: { apiBaseUrl?: string | null } = {}): Services {
  const { apiBaseUrl: defaultBaseUrl, appEnv } = resolveRuntimeConfig(
    Constants.expoConfig?.extra as { apiBaseUrl?: unknown; appEnv?: unknown } | undefined,
  );
  // A server chosen on the sign-in screen (e.g. a self-hosted office server) wins over the build's.
  const baseUrl = opts.apiBaseUrl || defaultBaseUrl;

  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        // Retry once for a dropped connection or a 5xx; a 4xx answer will not change on retry.
        retry: (failureCount, error) => failureCount < 1 && !(error instanceof ApiError && error.status < 500),
      },
    },
  });

  const session = createSessionStore({ store: secureStore });
  const currentUserId = () => session.getSession()?.user.id ?? null;

  // Declared before use by refreshTokens/onUnauthorized; assigned below.
  // eslint-disable-next-line prefer-const
  let signOutApi: ReturnType<typeof createSignOut>;

  /**
   * Silent token refresh after a 401 (XP-04). Only a real 401/400 from /auth/refresh ends the
   * session; being offline, a timeout, a 5xx or a 429 is transient and keeps the user signed in.
   */
  async function refreshTokens(): Promise<RefreshOutcome> {
    const current = session.getSession();
    if (!current?.refreshToken || signOutApi.isSigningOut()) return 'invalid';

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(`${baseUrl}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: current.refreshToken }),
        signal: controller.signal,
      });
    } catch {
      return 'transient';
    } finally {
      clearTimeout(timer);
    }

    const outcome = classifyRefreshStatus(res.status);
    if (outcome !== 'ok') return outcome;
    let next: Session;
    try {
      next = ((await res.json()) as { data: Session }).data;
    } catch {
      return 'transient';
    }

    // The user signed out (or the session changed) while we waited: never resurrect it, and
    // revoke the token we were just given since nobody will ever use it.
    if (signOutApi.isSigningOut() || session.getSession()?.refreshToken !== current.refreshToken) {
      void fetch(`${baseUrl}/auth/logout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: next.refreshToken }),
      }).catch(() => {});
      return session.getSession() ? 'ok' : 'invalid';
    }
    await session.setSession(next);
    return 'ok';
  }

  let triggerSync: () => void = () => {};

  const api = createApiClient({
    baseUrl,
    getToken: () => session.getToken(),
    refreshTokens,
    // Not awaited: sign-out itself makes API calls and must not wait on the request that triggered it.
    onUnauthorized: () => {
      void signOutApi.signOut('expired');
    },
    // Any answer from the server means we are online — replay queued offline changes (XP-06).
    onReachable: () => triggerSync(),
  });
  const auth = authApi(api);
  const resources = resourcesApi(api);
  const cache = createReadCache({ store: asyncStore, getUserId: currentUserId });

  const queue = createSyncQueue({
    store: asyncStore,
    perform: (m: QueuedMutation) => performMutation(resources, m),
  });

  const sync = createSyncController({
    queue,
    getUserId: currentUserId,
    // Replayed changes are now on the server: refresh whatever is on screen.
    onFlushed: () => {
      void queryClient.invalidateQueries();
    },
  });
  triggerSync = () => {
    if (!sync.isFlushing() && queue.pendingFor(currentUserId()).length > 0) void sync.trigger();
  };

  const push = createPushRegistrar({
    getPushToken,
    registerToken: (token, platform) => resources.deviceTokens.register(token, platform),
    unregisterToken: (token) => resources.deviceTokens.unregister(token),
    store: asyncStore,
  });

  // The "biometric lock enabled" flag must live in the keystore too — in plain AsyncStorage anyone
  // with filesystem access could delete it and walk straight past the lock into a live session.
  const biometric = createBiometricGate({
    isAvailable: isBiometricAvailable,
    authenticate: () => authenticateBiometric(),
    store: secureStore,
  });
  // The remembered refresh token lives behind a biometric-bound keystore key (MOB-01).
  const biometricLogin = createBiometricLogin({ secretStore: biometricSecureStore, markerStore: secureStore });

  signOutApi = createSignOut({
    getSession: () => session.getSession(),
    revokeRefreshToken: (refreshToken) => auth.logout(refreshToken),
    unregisterPush: () => push.unregister(),
    disarmBiometricLogin: () => biometricLogin.disarm(),
    clearSession: () => session.logout(),
    clearQueryCache: () => queryClient.clear(),
    clearReadCache: () => cache.clear(),
    clearQueuedChanges: (userId) => queue.clearForUser(userId),
  });

  const exporter = createExporter({
    baseUrl,
    getToken: () => session.getToken(),
    refreshSession: () => api.refreshSession(),
    onUnauthorized: () => {
      void signOutApi.signOut('expired');
    },
    files: exportFiles,
  });

  return {
    baseUrl,
    defaultBaseUrl,
    appEnv,
    queryClient,
    session,
    api,
    auth,
    resources,
    cache,
    queue,
    sync,
    push,
    biometric,
    biometricLogin,
    signOut: signOutApi.signOut,
    exporter,
    currentUserId,
  };
}
