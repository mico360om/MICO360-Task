import Constants from 'expo-constants';
import type { QueryClient } from '@tanstack/react-query';
import { createApiClient, readRefreshReply, DEFAULT_TIMEOUT_MS, type RefreshOutcome } from '../lib/api-client';
import { createQueryClient } from '../lib/query-client';
import { createConnectivity, serverReached } from '../lib/connectivity';
import { createSessionStore } from '../lib/session-store';
import { assertAllowedUrl } from '../lib/server-address';
import { refreshWithRetry } from '../lib/refresh-retry';
import { versionHeaders, type AppInfo } from '../lib/app-version';
import { appInfo } from '../adapters/app-info';
import { resolveRuntimeConfig } from '../lib/config';
import type { AppEnv } from '../lib/app-env';
import { resourcesApi } from '../lib/resources';
import { createReadCache } from '../lib/read-cache';
import { createOfflineReads, type OfflineReads } from '../lib/offline-reads';
import { chatThreadCopyKey, offlineCopyCaps } from '../lib/offline-copy';
import { createSyncQueue, type QueuedMutation } from '../lib/sync-queue';
import { performMutation, refreshesAfterReplay } from '../lib/perform-mutation';
import { refresh } from '../lib/refresh';
import { noteReplayed, rebaseQueuedVersion, taskWrites } from '../lib/task-writes';
import { dropOvertaken } from '../lib/write-order';
import { createSyncController } from '../lib/sync-controller';
import { createChatCache, type ChatCache } from '../lib/chat-cache';
import { createPushRegistrar } from '../lib/push-registrar';
import { createBiometricGate } from '../lib/biometric-gate';
import { createBiometricLogin } from '../lib/biometric-login';
import { createSignOut } from '../lib/sign-out';
import { createExporter } from '../lib/exporter';
import { authApi } from '../lib/auth';
import { secureStore, biometricSecureStore } from '../adapters/secure-store';
import { asyncStore } from '../adapters/async-storage';
import { getPushToken, deactivatePush } from '../adapters/push';
import { exportFiles } from '../adapters/files';
import { isBiometricAvailable, authenticateBiometric } from '../adapters/biometric';

export interface Services {
  baseUrl: string;
  /** This build's own server (used when no other server was chosen on the sign-in screen). */
  defaultBaseUrl: string;
  /** The active build flavor (development | preview | production). */
  appEnv: AppEnv;
  /** This build's version and build number (shown in Settings, sent with every request). */
  app: AppInfo;
  queryClient: QueryClient;
  /** Whether the server can be reached, from the app's own requests and sockets. */
  connectivity: ReturnType<typeof createConnectivity>;
  session: ReturnType<typeof createSessionStore>;
  api: ReturnType<typeof createApiClient>;
  auth: ReturnType<typeof authApi>;
  resources: ReturnType<typeof resourcesApi>;
  cache: ReturnType<typeof createReadCache>;
  /** The lists' reads through the offline copy (with the moves still waiting laid over the board). */
  reads: OfflineReads;
  queue: ReturnType<typeof createSyncQueue>;
  sync: ReturnType<typeof createSyncController>;
  /** Chat messages put into a loaded thread in place (sent ones, live ones), 3a. */
  chat: ChatCache;
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

  const connectivity = createConnectivity();

  const session = createSessionStore({ store: secureStore });
  const currentUserId = () => session.getSession()?.user.id ?? null;

  // Declared before use by refreshTokens/onUnauthorized; assigned below.
  // eslint-disable-next-line prefer-const
  let signOutApi: ReturnType<typeof createSignOut>;

  /**
   * Silent token refresh after a 401 (XP-04). Only a real 401/400 from /auth/refresh, or the server's
   * 403 ACCOUNT_INACTIVE (the account was turned off), ends the session; being offline, a timeout, a
   * 5xx, a 429, a firewall's 403 or a reply that isn't a session is transient and keeps the user signed in.
   */
  async function refreshTokens(): Promise<RefreshOutcome> {
    const current = session.getSession();
    if (!current?.refreshToken || signOutApi.isSigningOut()) return 'invalid';

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
    let res: Response;
    try {
      // The refresh token never travels over plain http to the internet (the request fails instead).
      assertAllowedUrl(`${baseUrl}/auth/refresh`);
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

    // A 200 that isn't a real session (a proxy or Wi-Fi page) is never stored: signed in with no
    // user, signing out couldn't drop that person's queued changes.
    const reply = await readRefreshReply(res);
    if (reply.outcome !== 'ok') return reply.outcome;
    const next = reply.session;

    // The user signed out (or the session changed) while we waited: never resurrect it, and
    // revoke the token we were just given since nobody will ever use it.
    if (signOutApi.isSigningOut() || session.getSession()?.refreshToken !== current.refreshToken) {
      // (The refresh above already passed the address check, so this logout may use the same base.)
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

  const app = appInfo();
  const api = createApiClient({
    baseUrl,
    appHeaders: versionHeaders(app),
    getToken: () => session.getToken(),
    // A refresh whose reply was lost is tried once more: the server hands back the same new token.
    refreshTokens: () => refreshWithRetry(refreshTokens),
    // Not awaited: sign-out itself makes API calls and must not wait on the request that triggered it.
    onUnauthorized: () => {
      void signOutApi.signOut('expired');
    },
    // Any answer from the server means we are online — replay queued offline changes (XP-06).
    onReachable: () => serverReached(connectivity, triggerSync),
    onUnreachable: () => connectivity.unreachable(),
  });
  const auth = authApi(api);
  const resources = resourcesApi(api);
  // The offline copy is written after a screen has its data, keeps two weeks of board days and the
  // last 20 conversations opened, and never keeps a copy too long for Android to read back
  // (offline-copy).
  const cache = createReadCache({ store: asyncStore, getUserId: currentUserId, rolling: offlineCopyCaps() });

  const queue = createSyncQueue({
    store: asyncStore,
    // A replayed task edit or move made this phone's own new version: the next edit follows it.
    perform: (m: QueuedMutation) =>
      performMutation(resources, m).then((result) => {
        noteReplayed(taskWrites, m, result);
        // A message kept on this phone reached the server: its saved copy shows in its thread.
        chat.afterSent(m, result);
        return result;
      }),
    // A task edit queued after an earlier one of this phone's moves on to the version that one made.
    rebase: rebaseQueuedVersion,
  });
  // The lists read through the offline copy; one it answered is out of date at once (refreshed when
  // back online or back in the app), and the board shows the moves still waiting (offline-reads).
  const reads = createOfflineReads({ cache, pendingChanges: () => queue.pendingFor(currentUserId()) });
  const queryClient = createQueryClient({ answeredFromCopy: reads.answeredFromCopy });
  // A thread changed in place (a live or sent message) keeps its newest page offline too.
  const chat = createChatCache({ queryClient, keepCopy: (conversationId, newest) => cache.keep(chatThreadCopyKey(conversationId), newest) });

  const sync = createSyncController({
    queue,
    getUserId: currentUserId,
    // Replayed changes are now on the server (and refused ones never will be): refresh what they
    // touched, not every query in the app.
    onFlushed: (result) => {
      // A refused change that a replayed later one replaced goes: its Retry would overwrite it.
      const owner = result.done[0]?.userId;
      if (owner) void dropOvertaken(queue, owner, result.done);
      refresh(queryClient, [...result.done, ...result.failed].flatMap(refreshesAfterReplay));
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
    clearSession: () => session.logout(),
    clearQueryCache: () => queryClient.clear(),
    clearReadCache: () => cache.clear(),
    clearQueuedChanges: (userId) => queue.clearForUser(userId),
    deactivatePush: async () => {
      await deactivatePush();
      await push.forget();
    },
    clearExports: () => exportFiles.clearAll(),
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
    app,
    queryClient,
    connectivity,
    session,
    api,
    auth,
    resources,
    cache,
    reads,
    queue,
    sync,
    chat,
    push,
    biometric,
    biometricLogin,
    signOut: signOutApi.signOut,
    exporter,
    currentUserId,
  };
}
