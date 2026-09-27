import React, { createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { View, ActivityIndicator, StyleSheet, AppState } from 'react-native';
import { QueryClientProvider } from '@tanstack/react-query';
import { createServices, type Services } from './services';
import { useColors } from './theme';
import { asyncStore } from '../adapters/async-storage';
import { loadServerOverride, saveServerOverride } from '../lib/server-address';
import type { Session } from '../lib/types';
import type { QueuedMutation } from '../lib/sync-queue';

const ServicesContext = createContext<Services | null>(null);

interface ServerChoice {
  /** The API base in use. */
  baseUrl: string;
  /** This build's own server. */
  defaultBaseUrl: string;
  /** Switch to another server (an API base from parseServerAddress), or back to the default with null. Signed-out only. */
  setServer: (apiBase: string | null) => Promise<void>;
}

const ServerContext = createContext<ServerChoice | null>(null);

/** While the signed-in user has changes waiting, retry the sync this often (no NetInfo available). */
const PENDING_SYNC_INTERVAL_MS = 15_000;

export function AppProvider({ children }: { children: React.ReactNode }) {
  // undefined while the remembered server is being read; null = this build's default server.
  const [server, setServerState] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    let active = true;
    void loadServerOverride(asyncStore).then((apiBase) => {
      if (active) setServerState(apiBase);
    });
    return () => {
      active = false;
    };
  }, []);

  if (server === undefined) return <Splash />;
  // Keyed by server: switching servers builds a fresh set of services (API client, caches, queue).
  return (
    <ServicesRoot key={server ?? 'default'} server={server} onServerChange={setServerState}>
      {children}
    </ServicesRoot>
  );
}

function Splash() {
  const colors = useColors();
  return (
    <View style={[styles.splash, { backgroundColor: colors.ground }]}>
      <ActivityIndicator color={colors.brand} size="large" />
    </View>
  );
}

function ServicesRoot({
  server,
  onServerChange,
  children,
}: {
  server: string | null;
  onServerChange: (apiBase: string | null) => void;
  children: React.ReactNode;
}) {
  const services = useMemo(() => createServices({ apiBaseUrl: server }), [server]);
  const [ready, setReady] = useState(false);
  const serverChoice = useMemo<ServerChoice>(
    () => ({
      baseUrl: services.baseUrl,
      defaultBaseUrl: services.defaultBaseUrl,
      setServer: async (apiBase) => {
        const next = apiBase && apiBase !== services.defaultBaseUrl ? apiBase : null;
        await saveServerOverride(asyncStore, next);
        onServerChange(next);
      },
    }),
    [services, onServerChange],
  );

  useEffect(() => {
    let active = true;
    (async () => {
      await services.session.load();
      await services.queue.load();
      void services.biometricLogin.purgeLegacy();
      if (active) setReady(true);
      void services.sync.trigger(); // replay the signed-in user's queued offline changes on launch
    })();
    return () => {
      active = false;
    };
  }, [services]);

  // Flush the offline queue whenever the app returns to the foreground (A8).
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void services.sync.trigger();
    });
    return () => sub.remove();
  }, [services]);

  // Flush after sign-in (their own earlier offline changes), and keep retrying on a short interval
  // while anything is waiting — there is no connectivity listener, so this doubles as "flush when
  // the connection comes back" (XP-06).
  const userId = useSyncExternalStore(services.session.subscribe, services.currentUserId, services.currentUserId);
  const queueSnapshot = useSyncExternalStore(services.queue.subscribe, services.queue.snapshot, services.queue.snapshot);
  const hasPending = !!userId && queueSnapshot.some((m) => m.userId === userId && m.status === 'pending');
  useEffect(() => {
    if (!userId) return;
    void services.sync.trigger();
  }, [services, userId]);
  useEffect(() => {
    if (!hasPending) return;
    const timer = setInterval(() => {
      if (AppState.currentState === 'active') void services.sync.trigger();
    }, PENDING_SYNC_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [services, hasPending]);

  if (!ready) return <Splash />;

  return (
    <QueryClientProvider client={services.queryClient}>
      <ServerContext.Provider value={serverChoice}>
        <ServicesContext.Provider value={services}>{children}</ServicesContext.Provider>
      </ServerContext.Provider>
    </QueryClientProvider>
  );
}

/** The server in use and a way to change it (sign-in screen). */
export function useServer(): ServerChoice {
  const ctx = useContext(ServerContext);
  if (!ctx) throw new Error('useServer must be used within <AppProvider>');
  return ctx;
}

export function useServices(): Services {
  const ctx = useContext(ServicesContext);
  if (!ctx) throw new Error('useServices must be used within <AppProvider>');
  return ctx;
}

/** Subscribe to the current auth session; re-renders on login/logout (and token refresh). */
export function useSession(): Session | null {
  const { session } = useServices();
  return useSyncExternalStore(session.subscribe, session.getSession, session.getSession);
}

/** The signed-in user's id — stable across silent token refreshes (unlike the session object). */
export function useUserId(): string | null {
  const { session, currentUserId } = useServices();
  return useSyncExternalStore(session.subscribe, currentUserId, currentUserId);
}

/** The signed-in user's queued offline changes (pending + failed), live. */
export function useMyQueuedChanges(): { pending: QueuedMutation[]; failed: QueuedMutation[] } {
  const { queue } = useServices();
  const userId = useUserId();
  const snapshot = useSyncExternalStore(queue.subscribe, queue.snapshot, queue.snapshot);
  return useMemo(() => {
    const mine = userId ? snapshot.filter((m) => m.userId === userId) : [];
    return { pending: mine.filter((m) => m.status === 'pending'), failed: mine.filter((m) => m.status === 'failed') };
  }, [snapshot, userId]);
}

const styles = StyleSheet.create({
  splash: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
