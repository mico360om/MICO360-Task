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
import { invalidateTaskQueries } from '../lib/task-cache';
import { useAuthStore } from '../stores/auth-store';
import { useDialog } from '../hooks/useDialog';
import { ShortcutProvider } from './shortcuts/ShortcutProvider';
import { AppFooter } from './AppFooter';

/**
 * The phone's navigation menu: a dialog over the page. Focus moves into it and stays there, Escape
 * and the Close button dismiss it, and focus then returns to the menu button. (It used to be a
 * plain panel: Escape did nothing and Tab went to the page hidden behind it.)
 */
function MobileMenu({ isAdmin, onClose }: { isAdmin: boolean; onClose: () => void }) {
  const dialogRef = useDialog<HTMLDivElement>(onClose, { initialFocus: 'container' });
  return (
    <div className="fixed inset-0 z-50 md:hidden">
      <div className="absolute inset-0 bg-ink/40 animate-fade-in" onClick={onClose} aria-hidden="true" />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Menu"
        tabIndex={-1}
        className="absolute left-0 top-0 flex h-full w-64 max-w-[85vw] flex-col border-r border-line bg-surface shadow-lift outline-none animate-slide-in-right"
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close menu"
          className="absolute right-2 top-3.5 z-10 grid h-9 w-9 place-items-center rounded-lg text-ink-2 transition-colors hover:bg-ground hover:text-ink"
        >
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
        <nav aria-label="Main" className="flex min-h-0 flex-1 flex-col">
          <SidebarBody isAdmin={isAdmin} onNavigate={onClose} />
        </nav>
      </div>
    </div>
  );
}

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

  // Offline sync (Epic C): replay the signed-in user's queued changes — on load, when the browser
  // comes back online and when the tab is shown again — then refresh the task views they changed.
  // (Only one tab flushes at a time; see flushOfflineQueue.)
  useEffect(() => {
    async function flush() {
      if (!navigator.onLine) return;
      const res = await flushOfflineQueue();
      if (res.synced > 0) void invalidateTaskQueries(qc);
    }
    const onVisible = () => {
      if (document.visibilityState === 'visible') void flush();
    };
    void flush();
    window.addEventListener('online', flush);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('online', flush);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [qc]);

  return (
    <ShortcutProvider>
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
      {drawerOpen ? <MobileMenu isAdmin={isAdmin()} onClose={() => setDrawerOpen(false)} /> : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="keyboard-unstick glass sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-line px-4 py-2.5 sm:px-6">
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
            <span className="hidden sm:block md:hidden lg:block">
              <SystemClock />
            </span>
            <GlobalSearch />
          </div>
          <div className="flex flex-none items-center gap-2">
            <SyncStatus />
            {/* The header's N is the fallback: a page with its own "New …" takes the key. */}
            <NewTaskButton size="sm" compact shortcutPriority={0} />
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
        {/* The version and when it was last updated, on every page (below the page, never over it). */}
        <AppFooter />
      </div>

      {/* Global task drawer — opened from search/command palette or any ?task= link */}
      {openTaskId ? <TaskDrawerContainer taskId={openTaskId} onClose={closeTask} /> : null}
    </div>
    </ShortcutProvider>
  );
}
