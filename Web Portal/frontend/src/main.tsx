import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import { initTheme } from './lib/theme';
import { shouldRetryQuery } from './lib/queryRetry';
import './index.css';

initTheme(); // apply the persisted light/dark/system choice before first paint

// Query defaults tuned for low-resource devices: a short stale window collapses the
// duplicate refetches that fire when components remount, and dropping the
// refetch-on-window-focus stampede avoids a burst of network + re-render work every time
// the user tabs back. Mutations still invalidate explicitly, so data stays fresh where it
// matters. 4xx responses are never retried — auth/permission errors surface immediately.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: shouldRetryQuery,
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: false,
    },
  },
});

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
