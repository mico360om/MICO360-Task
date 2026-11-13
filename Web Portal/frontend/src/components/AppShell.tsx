import { useEffect, useLayoutEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Outlet, useLocation, useNavigationType, useSearchParams } from 'react-router-dom';
import { Sidebar, SidebarBody } from './Sidebar';
import { useManagementLink } from '../lib/useManagementLink';
import { ChatSoundNotifier } from './ChatSoundNotifier';
import { MeetingReminderPopup } from './MeetingReminderPopup';
import { GlobalSearch } from './GlobalSearch';
import { TaskDrawerContainer } from './TaskDrawerContainer';
import { useTaskStepper } from '../lib/useTaskStepper';
import { useTaskSteps } from '../lib/task-steps';
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
import { MenuDrawer } from './MenuDrawer';
import { ShortcutProvider } from './shortcuts/ShortcutProvider';
import { AppFooter } from './AppFooter';
import { useChatBadge } from '../lib/useChatBadge';
import { menuButtonLabel } from '../lib/chat-badge';
import { pageFrameClass, pageLayout } from '../lib/page-layout';
import { useMyCompanies } from '../hooks/useMyCompanies';
import { CompanyPicker } from './company/CompanyPicker';
import { CompanyNotice } from './company/CompanyNotice';
import { ArchivedProjectNotice } from './projects/ArchivedProjectNotice';
import { DatabaseBusyNotice } from './DatabaseBusyNotice';
import { ArchivedCompanyState } from './company/ArchivedCompanyState';
import { TaskNoticeToast } from './TaskNoticeToast';
import { BinUndoToast } from './recycle-bin/BinUndoToast';
import { ArchiveUndoToast } from './task-archive/ArchiveUndoToast';
import { useDensitySync } from '../lib/density';
import { useAppearanceSync } from '../lib/appearance';
import { useTrainingAccess } from './training/training-queries';
import { StaffTour } from './training/Tour';
import { ManagerViewBadge } from './ManagerViewBadge';
import { useEffectiveAdmin, useManagerViewSync } from '../lib/manager-view';

/** The pages that still open when all of someone's companies are archived. */
const OPEN_WHEN_ARCHIVED = ['/settings', '/profile', '/about'];
const opensWhenArchived = (path: string) => OPEN_WHEN_ARCHIVED.some((p) => path === p || path.startsWith(`${p}/`));

/**
 * The phone's navigation menu: a dialog over the page. Focus moves into it and stays there, Escape
 * and the Close button dismiss it, and focus then returns to the menu button. (It used to be a
 * plain panel: Escape did nothing and Tab went to the page hidden behind it.)
 */
function MobileMenu({ isAdmin, adminMenu, canLead, chatUnread, trainingOverdue, onClose }: { isAdmin: boolean; adminMenu: boolean; canLead: boolean; chatUnread: number; trainingOverdue: number; onClose: () => void }) {
  // 1.23.8: it slides in and out (components/MenuDrawer), as a tablet's unfolded menu does.
  return (
    <MenuDrawer className="md:hidden" onClose={onClose}>
      {(close) => (
        <>
          {/* Centred on the logo row (56px, like the top bar). */}
          <button
            type="button"
            onClick={close}
            aria-label="Close menu"
            className="absolute end-2 top-2.5 z-10 grid h-9 w-9 place-items-center rounded-lg text-ink-2 transition-colors hover:bg-ground hover:text-ink [@media(pointer:coarse)]:top-1.5 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11"
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
          <nav aria-label="Main" className="flex min-h-0 flex-1 flex-col">
            <SidebarBody isAdmin={isAdmin} adminMenu={adminMenu} canLead={canLead} chatUnread={chatUnread} trainingOverdue={trainingOverdue} onNavigate={close} />
          </nav>
          {/* Companies: on the smallest phones the top bar has no room for the picker — it is here. */}
          <CompanyPicker place="menu" />
        </>
      )}
    </MenuDrawer>
  );
}

/** Authenticated app layout: role-aware sidebar + glass top header + routed content (T6.1). */
export function AppShell() {
  const isAdmin = useAuthStore((s) => s.isAdmin);
  const location = useLocation();
  // A link to another page opens it at its top (sb3 4b): the window kept the last page's scroll, so a
  // short page (My Action Items) opened with its title under the sticky top bar. Not for a place on a
  // page (#…: the page scrolls there itself), a change within the page (filters), or Back and Forward.
  // At once (the site scrolls smoothly otherwise), before the page's own effects — but after its layout
  // effects: a page that scrolls the window when it opens must do so in an effect, not a layout effect.
  const navigationType = useNavigationType();
  useLayoutEffect(() => {
    if (navigationType === 'POP' || location.hash) return;
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    // Only a new page: its path, never its query or hash alone.
  }, [location.pathname]);
  const qc = useQueryClient();
  const [drawerOpen, setDrawerOpen] = useState(false);
  // Unread chat messages, live: on the sidebar's Chat icon and, on a phone, the menu button.
  const chatUnread = useChatBadge();
  // Rows (compact / comfortable / detailed) and, 1.23.8, the folded menu and board column width: the
  // account's choices, put on <html> once they arrive.
  useDensitySync();
  useAppearanceSync();
  // Manager View (owner, 10 Nov): an administrator's switch, read once per sign-in; while on, no Admin menu.
  useManagerViewSync();
  const adminMenu = useEffectiveAdmin();
  // How wide this page is (capped at 1680px unless it is built around a wide grid — the list is in
  // lib/page-layout.ts) and whether it sizes itself to the window. The top bar, the page and the
  // footer share one frame, so their edges line up on any screen.
  const { wide, fitsWindow } = pageLayout(location.pathname);
  const frame = pageFrameClass(wide);
  // The Management page's link: administrators and the people who run a project (until the server
  // answers, what it said last time — the link no longer pops in and shifts the menu).
  const canLead = useManagementLink();
  // Training Center: overdue courses, a red count on the menu's Training (the server's number; none until it answers).
  const overdue = useTrainingAccess().data?.overdue;
  const trainingOverdue = typeof overdue === 'number' ? overdue : 0;
  // Companies: someone whose companies are all archived sees one card instead of the page ("archived
  // means no access"); Settings, Profile and About still open. Administrators never.
  const allArchived = useMyCompanies().data?.allArchived === true;
  const showArchived = allArchived && !opensWhenArchived(location.pathname);
  // Global task drawer: any page/command can open a task by putting ?task=<id> in the URL.
  const [searchParams, setSearchParams] = useSearchParams();
  const openTaskId = searchParams.get('task');
  // Previous / Next through the list the task was opened from (a board, My Tasks, Search, a calendar day).
  const stepper = useTaskStepper(openTaskId);
  const closeTask = () => {
    useTaskSteps.getState().settle();
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete('task');
        // 1.23: the file a search result marked goes with the task (review M8); 1.23.3: the checklist item too.
        next.delete('file');
        next.delete('item');
        // 1.23.6: and the external contact.
        next.delete('contact');
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

      <Sidebar isAdmin={isAdmin()} adminMenu={adminMenu} canLead={canLead} chatUnread={chatUnread} trainingOverdue={trainingOverdue} />

      {/* Mobile drawer */}
      {drawerOpen ? <MobileMenu isAdmin={isAdmin()} adminMenu={adminMenu} canLead={canLead} chatUnread={chatUnread} trainingOverdue={trainingOverdue} onClose={() => setDrawerOpen(false)} /> : null}

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
                data-tour="menu"
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
              {/* Companies: only for people with two or more (else nothing at all). */}
              <CompanyPicker />
            </div>
            <div className="flex flex-none items-center gap-1.5 sm:gap-2">
              <ManagerViewBadge />
              <SyncStatus />
              {/* The header's N is the fallback: a page with its own "New …" takes the key. */}
              <span data-tour="new-task" className="inline-flex">
                <NewTaskButton size="sm" compact shortcutPriority={0} className="[@media(pointer:coarse)]:!min-h-11 [@media(pointer:coarse)]:!min-w-11" />
              </span>
              <span className="hidden h-6 w-px bg-line sm:block" aria-hidden="true" />
              <span data-tour="notifications" className="inline-flex">
                <NotificationsBell />
              </span>
              <ProfileMenu />
            </div>
          </div>
        </header>

        {/* Companies: "You no longer have access to Beta Co…" when the picked company was taken away. */}
        <CompanyNotice frameClass={frame} />
        {/* 1.22: "This project is archived — reopen it first." when the server refused a change. */}
        <ArchivedProjectNotice frameClass={frame} />
        {/* 1.23.1: "The database is busy — please try again in a moment." when the server's database was away. */}
        <DatabaseBusyNotice frameClass={frame} />

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
            {showArchived ? <ArchivedCompanyState /> : <Outlet />}
          </div>
        </main>
        {/* The version and when it was last updated, on every page (below the page, never over it). */}
        <AppFooter frameClass={frame} />
      </div>

      {/* Global task drawer — opened from search/command palette or any ?task= link */}
      {openTaskId ? <TaskDrawerContainer taskId={openTaskId} onClose={closeTask} stepper={stepper} focusItemId={searchParams.get('item')} /> : null}

      {/* A meeting reminder pops up in the corner of every page (after the page in reading order, so
          "Skip to content" stays first); every new notification refreshes the bell. */}
      <MeetingReminderPopup />
      {/* 1.22.3: "Task MICO-143 created · Open" after the task form (or an offline task's sync). */}
      <TaskNoticeToast />
      {/* Training Center: the first-time tour (by itself once for a new account; again from My training). */}
      <StaffTour />
      {/* Recycle Bin: "RIG-12 moved to the Recycle Bin · Undo" for a few seconds after a delete. */}
      <BinUndoToast />
      {/* Task archive: "RIG-12 archived · Undo" after an archive (the panel has closed). */}
      <ArchiveUndoToast />
    </div>
    </CurrentProjectProvider>
    </ShortcutProvider>
  );
}
