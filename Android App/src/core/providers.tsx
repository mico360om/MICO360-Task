import React, { createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { View, ActivityIndicator, StyleSheet, AppState } from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createServices, type Services } from './services';
import { useColors } from './theme';
import type { Session } from '../lib/types';

const ServicesContext = createContext<Services | null>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const colors = useColors();
  const services = useMemo(() => createServices(), []);
  const queryClient = useMemo(
    () => new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 30_000 } } }),
    [],
  );
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      await services.session.load();
      await services.queue.load();
      if (active) setReady(true);
      void services.sync.trigger(); // replay any queued offline mutations on launch
    })();
    return () => {
      active = false;
    };
  }, [services]);

  // Flush the offline mutation queue whenever the app returns to the foreground (A8).
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void services.sync.trigger();
    });
    return () => sub.remove();
  }, [services]);

  if (!ready) {
    return (
      <View style={[styles.splash, { backgroundColor: colors.ground }]}>
        <ActivityIndicator color={colors.brand} size="large" />
      </View>
    );
  }

  return (
    <QueryClientProvider client={queryClient}>
      <ServicesContext.Provider value={services}>{children}</ServicesContext.Provider>
    </QueryClientProvider>
  );
}

export function useServices(): Services {
  const ctx = useContext(ServicesContext);
  if (!ctx) throw new Error('useServices must be used within <AppProvider>');
  return ctx;
}

/** Subscribe to the current auth session; re-renders on login/logout. */
export function useSession(): Session | null {
  const { session } = useServices();
  return useSyncExternalStore(session.subscribe, session.getSession, session.getSession);
}

const styles = StyleSheet.create({
  splash: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
