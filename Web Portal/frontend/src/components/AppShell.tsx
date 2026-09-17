import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Outlet, useLocation, useSearchParams } from 'react-router-dom';
import { Sidebar, SidebarBody } from './Sidebar';
import { ChatSoundNotifier } from './ChatSoundNotifier';
import { GlobalSearch } from './GlobalSearch';
import { TaskDrawerContainer } from './TaskDrawerContainer';
import { SystemClock } from './SystemClock';
import { NotificationsBell } from './NotificationsBell';
import { NewTaskButton } from './NewTaskButton';
import { SyncStatus } from './SyncStatus';
import { ProfileMenu } from './ProfileMenu';
import { flushOfflineQueue } from '../lib/offline-replay';
import { useAuthStore } from '../stores/auth-store';

/** Authenticated app layout: role-aware sidebar + glass top header + routed content (T6.1). */
export function AppShell() {
  const isAdmin = useAuthStore((s) => s.isAdmin);
  const location = useLocation();
  const qc = useQueryClient();
  const [drawerOpen, setDrawerOpen] = useState(false);
  // Global task drawer: any page/command can open a task by putting ?task=<id> in the URL.
  const [searchParams, setSearchParams] = useSearchParams();
  const openTaskId = searchParams.get('task');
  const closeTask = () => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete('task');
        return next;
      },
      { replace: true },
    );
  };

  // Offline sync (Epic C): replay any mutations queued while disconnected — on load and when
  // the browser comes back online — then refresh the data they changed.
  useEffect(() => {
    async function flush() {
      if (!navigator.onLine) return;
      const res = await flushOfflineQueue();
      if (res.synced > 0 || res.dropped > 0) void qc.invalidateQueries();
    }
    void flush();
    window.addEventListener('online', flush);
    return () => window.removeEventListener('online', flush);
  }, [qc]);

  return (
    <div className="flex min-h-screen">
      <ChatSoundNotifier />
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-brand focus:px-3 focus:py-2 focus:text-sm focus:text-white"
      >
        Skip to content
      </a>

      <Sidebar isAdmin={isAdmin()} />

      {/* Mobile drawer */}
      {drawerOpen ? (
        <div className="fixed inset-0 z-50 md:hidden">
          <div
            className="absolute inset-0 bg-ink/40 animate-fade-in"
            onClick={() => setDrawerOpen(false)}
            aria-hidden="true"
          />
          <nav
            aria-label="Main"
            className="absolute left-0 top-0 flex h-full w-64 flex-col border-r border-line bg-surface shadow-lift animate-slide-in-right"
          >
            <SidebarBody isAdmin={isAdmin()} onNavigate={() => setDrawerOpen(false)} />
          </nav>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="glass sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-line px-4 py-2.5 sm:px-6">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <button
              onClick={() => setDrawerOpen(true)}
              className="grid h-9 w-9 flex-none place-items-center rounded-lg border border-line text-ink transition-colors hover:bg-ground md:hidden"
              aria-label="Open menu"
            >
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M4 7h16M4 12h16M4 17h16" />
              </svg>
            </button>
            <span className="hidden sm:block">
              <SystemClock />
            </span>
            <GlobalSearch />
          </div>
          <div className="flex flex-none items-center gap-2">
            <SyncStatus />
            <NewTaskButton size="sm" compact />
            <span className="hidden h-6 w-px bg-line sm:block" aria-hidden="true" />
            <NotificationsBell />
            <ProfileMenu />
          </div>
        </header>

        <main id="main-content" className="flex-1 overflow-x-hidden bg-transparent py-4 sm:py-6 lg:py-8">
          {/* Content spans 95% of the main area (2.5% gutters each side) on every page.
              Opacity-only page transition — must NOT retain a transform, or it becomes a containing
              block that offsets every position:fixed overlay (task drawer, modals) on the page. */}
          <div key={location.pathname} className="mx-auto w-[95%] animate-fade-in">
            <Outlet />
          </div>
        </main>
      </div>

      {/* Global task drawer — opened from search/command palette or any ?task= link */}
      {openTaskId ? <TaskDrawerContainer taskId={openTaskId} onClose={closeTask} /> : null}
    </div>
  );
}
