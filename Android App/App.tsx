import React, { lazy, Suspense } from 'react';
import Constants from 'expo-constants';
import { createConsoleReporter, pickCrashReporter } from './src/lib/error-reporter';
import { resolveRuntimeConfig } from './src/lib/config';
import { initSentry } from './src/adapters/sentry';
import { appInfo } from './src/adapters/app-info';
import { releaseName } from './src/lib/app-version';
import { setBrandFaces } from './src/lib/typography';
import { useBrandFonts } from './src/core/fonts';
import { FontSplash } from './src/components/FontSplash';

// Crash/analytics sink (A9.3): a production build with EXPO_PUBLIC_SENTRY_DSN reports to Sentry;
// dev logs to the console; a production build without a DSN stays silent until ops configures one.
function buildReporter() {
  const isDev = typeof __DEV__ !== 'undefined' && __DEV__;
  const extra = Constants.expoConfig?.extra as { sentryDsn?: unknown; appEnv?: unknown; apiBaseUrl?: unknown } | undefined;
  const dsn = typeof extra?.sentryDsn === 'string' ? extra.sentryDsn : undefined;
  const { appEnv } = resolveRuntimeConfig(extra);
  // Crash reports name the release (version + build), so a report says which APK it came from.
  const sentry = !isDev && dsn ? initSentry(dsn, { environment: appEnv, release: releaseName(appInfo()) }) : null;
  return pickCrashReporter({ isDev, dsn, sentry, console: createConsoleReporter() });
}

const reporter = buildReporter();

// The screens make text styles when their files load, so they load only once the faces are picked.
const AppRoot = lazy(() => import('./src/AppRoot'));

export default function App() {
  // The website's fonts first: the splash's picture shows while they load (at most FONT_WAIT_MS),
  // then the app opens on them — or on the phone's own fonts, still bold where it should be.
  const fonts = useBrandFonts();
  if (fonts === 'wait') return <FontSplash />;
  setBrandFaces(fonts === 'brand');
  return (
    <Suspense fallback={<FontSplash />}>
      <AppRoot reporter={reporter} />
    </Suspense>
  );
}
