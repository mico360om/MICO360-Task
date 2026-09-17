import React from 'react';
import Constants from 'expo-constants';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AppProvider } from './src/core/providers';
import { ThemeProvider } from './src/core/theme';
import { RootNavigator } from './src/navigation/RootNavigator';
import { ErrorBoundary } from './src/components/ErrorBoundary';
import { LockGate } from './src/components/LockGate';
import { createConsoleReporter, pickCrashReporter } from './src/lib/error-reporter';
import { resolveRuntimeConfig } from './src/lib/config';
import { initSentry } from './src/adapters/sentry';
import { asyncStore } from './src/adapters/async-storage';

// Crash/analytics sink (A9.3): a production build with EXPO_PUBLIC_SENTRY_DSN reports to Sentry;
// dev logs to the console; a production build without a DSN stays silent until ops configures one.
function buildReporter() {
  const isDev = typeof __DEV__ !== 'undefined' && __DEV__;
  const extra = Constants.expoConfig?.extra as { sentryDsn?: unknown; appEnv?: unknown; apiBaseUrl?: unknown } | undefined;
  const dsn = typeof extra?.sentryDsn === 'string' ? extra.sentryDsn : undefined;
  const { appEnv } = resolveRuntimeConfig(extra);
  const sentry = !isDev && dsn ? initSentry(dsn, { environment: appEnv }) : null;
  return pickCrashReporter({ isDev, dsn, sentry, console: createConsoleReporter() });
}

const reporter = buildReporter();

export default function App() {
  return (
    <ErrorBoundary reporter={reporter}>
      <SafeAreaProvider>
        <ThemeProvider store={asyncStore}>
          <AppProvider>
            <LockGate>
              <RootNavigator />
            </LockGate>
          </AppProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </ErrorBoundary>
  );
}
