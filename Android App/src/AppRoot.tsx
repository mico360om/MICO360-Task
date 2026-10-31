import React from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AppProvider } from './core/providers';
import { ThemeProvider } from './core/theme';
import { RootNavigator } from './navigation/RootNavigator';
import { ErrorBoundary } from './components/ErrorBoundary';
import { LockGate } from './components/LockGate';
import { asyncStore } from './adapters/async-storage';
import type { CrashReporter } from './lib/error-reporter';

/**
 * The app itself. App loads this file only after it has picked the fonts (lib/typography's
 * setBrandFaces), because many screens make their text styles when their file loads.
 */
export default function AppRoot({ reporter }: { reporter: CrashReporter }) {
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
