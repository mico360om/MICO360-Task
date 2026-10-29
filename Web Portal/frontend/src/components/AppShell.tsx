import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Outlet, useLocation, useSearchParams } from 'react-router-dom';
import { Sidebar, SidebarBody } from './Sidebar';
import { useManagementLink } from '../lib/useManagementLink';
import { ChatSoundNotifier } from './ChatSoundNotifier';
import { GlobalSearch } from './GlobalSearch';
import { TaskDrawerContainer } from './TaskDrawerContainer';
import { SystemClock } from './SystemClock';
import { NotificationsBell } from './NotificationsBell';
import { NewTaskButton } from './NewTaskButton';
import { CurrentProjectProvider } from './CurrentProject';
import { SyncStatus } from './SyncStatus';
import { ProfileMenu } from './ProfileMenu';
import { flushOfflineQueue } from '../lib/offline-replay';
import { useInspectionOutboxSync } from '../lib/inspection-sync';
import { invalidateTaskQueries } from '../lib/task-cache';
import { useAuthStore } from '../stores/auth-store';
import { useDialog } from '../hooks/useDialog';
import { ShortcutProvider } from './shortcuts/ShortcutProvider';
import { AppFooter } from './AppFooter';
import { useChatBadge } from '../lib/useChatBadge';
import { menuButtonLabel } from '../lib/chat-badge';
import { pageFrameClass, pageLayout } from '../lib/page-layout';

/**
 * The phone's navigation menu: a dialog over the page. Focus moves into it and stays there, Escape
 * and the Close button dismiss it, and focus then returns to the menu button. (It used to be a
 * plain panel: Escape did nothing and Tab went to the page hidden behind it.)
 */
function MobileMenu({ isAdmin, canLead, chatUnread, onClose }: { isAdmin: boolean; canLead: boolean; chatUnread: number; onClose: () => void }) {
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
        {/* Centred on the logo row (56px, like the top bar). */}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close menu"
          className="absolute end-2 top-2.5 z-10 grid h-9 w-9 place-items-center rounded-lg text-ink-2 transition-colors hover:bg-ground hover:text-ink [@media(pointer:coarse)]:top-1.5 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11"
        >
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
        <nav aria-label="Main" className="flex min-h-0 flex-1 flex-col">
          <SidebarBody isAdmin={isAdmin} canLead={canLead} chatUnread={chatUnread} onNavigate={onClose} />
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
  // Unread chat messages, live: on the sidebar's Chat icon and, on a phone, the menu button.
  const chatUnread = useChatBadge();
  // How wide this page is (capped at 1680px unless it is built around a wide grid — the list is in
  // lib/page-layout.ts) and whether it sizes itself to the window. The top bar, the page and the
  // footer share one frame, so their edges line up on any screen.
  const { wide, fitsWindow } = pageLayout(location.pathname);
  const frame = pageFrameClass(wide);
  // The Management page's link: administrators and the people who run a project (until the server
  // answers, what it said last time — the link no longer pops in and shifts the menu).
  const canLead = useManagementLink();
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

  // Inspections carried out without signal: their answers, signatures and follow-ups go once back online.
  useInspectionOutboxSync();

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
    {/* The project the open page shows: "New task" starts in it. */}
    <CurrentProjectProvider>
    <div className="flex min-h-screen">
      <ChatSoundNotifier />
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-brand focus:px-3 focus:py-2 focus:text-sm focus:text-white"
      >
        Skip to content
      </a>

      <Sidebar isAdmin={isAdmin()} canLead={canLead} chatUnread={chatUnread} />

      {/* Mobile drawer */}
      {drawerOpen ? <MobileMenu isAdmin={isAdmin()} canLead={canLead} chatUnread={chatUnread} onClose={() => setDrawerOpen(false)} /> : null}

      <div className="flex min-w-0 flex-1 flex-col">
        {/* 56px tall, like the sidebar's logo row beside it: their bottom lines meet as one. Its
            contents sit in the page's frame (same edges as the page and the footer). On a touch
            screen its buttons are 44px (a finger's size); on a phone the gaps are a little tighter
            so the search box keeps room for a word at 320px. */}
        <header data-app-header className="keyboard-unstick glass sticky top-0 z-30 h-14 flex-none border-b border-line">
          <div className={`${frame} flex h-full items-center justify-between gap-2 sm:gap-3`}>
            <div className="flex min-w-0 flex-1 items-center gap-1.5 sm:gap-2">
              <button
                onClick={() => setDrawerOpen(true)}
                className="relative grid h-9 w-9 flex-none place-items-center rounded-lg border border-line text-ink transition-colors hover:bg-ground md:hidden [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11"
                aria-label={menuButtonLabel(chatUnread)}
              >
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                  <path d="M4 7h16M4 12h16M4 17h16" />
                </svg>
                {/* The sidebar, and Chat's count, are folded away behind this button on a phone. */}
                {chatUnread > 0 ? <span data-chat-dot aria-hidden="true" className="absolute -end-1 -top-1 h-2.5 w-2.5 rounded-full bg-brand ring-2 ring-surface" /> : null}
              </button>
              {/* Beside the slim tablet menu there is room for the clock again (it was hidden at 768–1023). */}
              <span className="hidden sm:block">
                <SystemClock />
              </span>
              <GlobalSearch />
            </div>
            <div className="flex flex-none items-center gap-1.5 sm:gap-2">
              <SyncStatus />
              {/* The header's N is the fallback: a page with its own "New …" takes the key. */}
              <NewTaskButton size="sm" compact shortcutPriority={0} className="[@media(pointer:coarse)]:!min-h-11 [@media(pointer:coarse)]:!min-w-11" />
              <span className="hidden h-6 w-px bg-line sm:block" aria-hidden="true" />
              <NotificationsBell />
              <ProfileMenu />
            </div>
          </div>
        </header>

        {/* At least a window tall (less the top bar), so the footer starts below the fold and
            isn't shoved down as the page's content arrives (a layout shift on every page that
            loads). Pages sized to the window themselves leave room for the footer instead. */}
        <main
          id="main-content"
          data-page-width={wide ? 'full' : 'capped'}
          className={`flex-1 overflow-x-hidden bg-transparent py-4 lg:py-5 ${fitsWindow ? '' : 'min-h-[calc(100vh-3.5rem)] supports-[height:100dvh]:min-h-[calc(100dvh-3.5rem)]'}`}
        >
          {/* Content spans 95% of the main area (2.5% gutters each side), at most 1680px wide
              unless the page is built around a wide grid (lib/page-layout.ts).
              Opacity-only page transition — must NOT retain a transform, or it becomes a containing
              block that offsets every position:fixed overlay (task drawer, modals) on the page. */}
          <div key={location.pathname} className={`${frame} animate-fade-in`}>
            <Outlet />
          </div>
        </main>
        {/* The version and when it was last updated, on every page (below the page, never over it). */}
        <AppFooter frameClass={frame} />
      </div>

      {/* Global task drawer — opened from search/command palette or any ?task= link */}
      {openTaskId ? <TaskDrawerContainer taskId={openTaskId} onClose={closeTask} /> : null}
    </div>
    </CurrentProjectProvider>
    </ShortcutProvider>
  );
}
