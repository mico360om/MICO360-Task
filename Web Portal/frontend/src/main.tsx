import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { App } from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import { initTheme } from './lib/theme';
import { createAppQueryClient } from './lib/query-client';
import { bindQueryCacheToSession } from './lib/session-lifecycle';
import { initAuthSync } from './stores/auth-store';
import './index.css';

initTheme(); // apply the persisted light/dark/system choice before first paint

const queryClient = createAppQueryClient();

// Signing out (or another person signing in) drops every cached query; tabs share one session.
bindQueryCacheToSession(queryClient);
initAuthSync();

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
