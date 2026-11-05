import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { App } from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import { initTheme } from './lib/theme';
import { initDensity } from './lib/density';
import { createAppQueryClient } from './lib/query-client';
import { bindQueryCacheToSession } from './lib/session-lifecycle';
import { bindQueryCacheToCompanyPick } from './lib/company-scope';
import { initAuthSync, useAuthStore } from './stores/auth-store';
import { bindCompanyPickToSession } from './stores/company-store';
import { installKeyboardAwareness } from './lib/keyboard-aware';
import { browserServiceWorkerWorld, setUpServiceWorker } from './lib/service-worker';
import { installErrorReporting } from './lib/error-reporting';
import { installPreloadRecovery, startUpdateWatcher } from './lib/update-recovery';
import { apiBaseUrl } from './api/client';
import './index.css';

// 1.22.4: first of all, what goes wrong in this browser is sent to System Settings → Error log
// (errors, blocked files and scripts, slow pages). It never throws; the page works the same without it.
installErrorReporting({ baseUrl: apiBaseUrl, getToken: () => useAuthStore.getState().accessToken });
// 1.23.2: after an update, an open page loads the new build by itself (a page's missing code reloads to
// it once; a newer build noticed on focus or every 10 minutes is loaded at the next move to another page).
installPreloadRecovery();
startUpdateWatcher();

initTheme(); // apply the persisted light/dark/system choice before first paint
initDensity(); // and the person's compact / comfortable rows (their last on this device; the account's follows)
installKeyboardAwareness(); // keep the field being typed in (and its buttons) above a phone keyboard

const queryClient = createAppQueryClient();

// Signing out (or another person signing in) drops every cached query; tabs share one session.
bindQueryCacheToSession(queryClient);
initAuthSync();
// The company picked in the top bar: the signed-in person's own (kept on this device); changing it,
// or the server saying their companies changed, resets every list read for the old company.
bindCompanyPickToSession();
bindQueryCacheToCompanyPick(queryClient);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </QueryClientProvider>
    </ErrorBoundary>
  </React.StrictMode>,
);

// Production builds: the service worker (public/sw.js) lets an opened inspection load again without
// signal. Set up once the page has loaded, so it never slows the first paint. Vite's dev server is
// left alone (see lib/service-worker).
if (document.readyState === 'complete') void setUpServiceWorker(browserServiceWorkerWorld());
else window.addEventListener('load', () => void setUpServiceWorker(browserServiceWorkerWorld()), { once: true });
