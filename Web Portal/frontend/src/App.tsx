import { lazy, Suspense, useEffect, useRef, type ComponentType } from 'react';
import { Routes, Route, Navigate, useLocation, useSearchParams } from 'react-router-dom';
import { ProtectedRoute, returnPathFrom } from './features/auth/ProtectedRoute';
import { AdminRoute, AdminSettingsRoute } from './features/auth/AdminRoute';
import { ClientRoute, HomeRedirect, StaffRoute } from './features/auth/RoleRoutes';
import { landingPathFor } from './features/auth/client-routes';
import { AppShell } from './components/AppShell';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';
import { useAuthStore } from './stores/auth-store';
import { usePageMeta } from './lib/page-meta';
import { loadWithRecovery, pageUpdateWatcher } from './lib/update-recovery';

// Eager: the auth flow + the landing dashboard (first paint on a slow device should not wait
// on a second chunk). Everything else is code-split so a low-resource client only downloads
// and parses the JavaScript for the screen it actually opens.
// 1.23.2: a page's code from an older build (gone after an update) loads the new build instead of failing.
const lazyPage = <T extends string>(load: () => Promise<Record<T, ComponentType>>, name: T) =>
  lazy(loadWithRecovery(() => load().then((m) => ({ default: m[name] }))));

const ForgotPasswordPage = lazyPage(() => import('./pages/ForgotPasswordPage'), 'ForgotPasswordPage');
const ResetPasswordPage = lazyPage(() => import('./pages/ResetPasswordPage'), 'ResetPasswordPage');
const PrivacyPage = lazyPage(() => import('./pages/LegalPages'), 'PrivacyPage');
const TermsPage = lazyPage(() => import('./pages/LegalPages'), 'TermsPage');
const ClientPrivacyPage = lazyPage(() => import('./pages/LegalPages'), 'ClientPrivacyPage');
const BoardPage = lazyPage(() => import('./pages/BoardPage'), 'BoardPage');
const ProjectsPage = lazyPage(() => import('./pages/ProjectsPage'), 'ProjectsPage');
const ProjectDetailPage = lazyPage(() => import('./pages/ProjectDetailPage'), 'ProjectDetailPage');
const NotificationsPage = lazyPage(() => import('./pages/NotificationsPage'), 'NotificationsPage');
const ReportsPage = lazyPage(() => import('./pages/ReportsPage'), 'ReportsPage');
const UsersPage = lazyPage(() => import('./pages/UsersPage'), 'UsersPage');
const CompaniesPage = lazyPage(() => import('./pages/CompaniesPage'), 'CompaniesPage');
const ClientsPage = lazyPage(() => import('./pages/ClientsPage'), 'ClientsPage');
const SettingsPage = lazyPage(() => import('./pages/SettingsPage'), 'SettingsPage');
const MyTasksPage = lazyPage(() => import('./pages/MyTasksPage'), 'MyTasksPage');
const AuditPage = lazyPage(() => import('./pages/AuditPage'), 'AuditPage');
// 1.22.4: System Settings → Error log (administrators).
const ErrorLogPage = lazyPage(() => import('./pages/ErrorLogPage'), 'ErrorLogPage');
const SystemSettingsPage = lazyPage(() => import('./pages/SystemSettingsPage'), 'SystemSettingsPage');
const AiSettingsPage = lazyPage(() => import('./pages/AiSettingsPage'), 'AiSettingsPage');
const ActivityPage = lazyPage(() => import('./pages/ActivityPage'), 'ActivityPage');
const SearchPage = lazyPage(() => import('./pages/SearchPage'), 'SearchPage');
const CalendarPage = lazyPage(() => import('./pages/CalendarPage'), 'CalendarPage');
const TimelinePage = lazyPage(() => import('./pages/TimelinePage'), 'TimelinePage');
const WorkloadPage = lazyPage(() => import('./pages/WorkloadPage'), 'WorkloadPage');
// Administrators and the people who run a project (it sends anyone else to the dashboard).
const ManagementRoute = lazyPage(() => import('./pages/ManagementPage'), 'ManagementRoute');
const MeetingsPage = lazyPage(() => import('./pages/MeetingsPage'), 'MeetingsPage');
const MeetingDetailPage = lazyPage(() => import('./pages/MeetingDetailPage'), 'MeetingDetailPage');
const MeetingSeriesPage = lazyPage(() => import('./pages/MeetingSeriesPage'), 'MeetingSeriesPage');
const MyActionItemsPage = lazyPage(() => import('./pages/MyActionItemsPage'), 'MyActionItemsPage');
// Takes props (see ChatRoute), so it is loaded with its own type rather than through lazyPage.
const ChatPage = lazy(loadWithRecovery(() => import('./pages/ChatPage').then((m) => ({ default: m.ChatPage }))));
const ProfilePage = lazyPage(() => import('./pages/ProfilePage'), 'ProfilePage');
const MicoAiPage = lazyPage(() => import('./pages/MicoAiPage'), 'MicoAiPage');
const TemplatesPage = lazyPage(() => import('./pages/TemplatesPage'), 'TemplatesPage');
const RecycleBinPage = lazyPage(() => import('./pages/RecycleBinPage'), 'RecycleBinPage');
// A client's read-only page for one shared project (no staff sign-in, no app shell).
const ClientViewPage = lazyPage(() => import('./pages/ClientViewPage'), 'ClientViewPage');
const AboutPage = lazyPage(() => import('./pages/AboutPage'), 'AboutPage');
// Temporary: the forms manager moves to the Templates page's "Inspection forms" tab (not in the menu).
// One inspection: carried out on a phone (it keeps working without signal) or at a desk.
const InspectionPage = lazyPage(() => import('./pages/InspectionPage'), 'InspectionPage');
// 1.23 The Client portal: client accounts only, in its own small shell (none of the staff app mounts).
// One file for all its pages (pages/portal/index.ts), fetched once.
const loadPortal = () => import('./pages/portal');
const PortalShell = lazyPage(loadPortal, 'PortalShell');
const PortalHomePage = lazyPage(loadPortal, 'PortalHomePage');
const PortalProjectLayout = lazyPage(loadPortal, 'PortalProjectLayout');
const PortalProjectIndex = lazyPage(loadPortal, 'PortalProjectIndex');
const PortalProgressTab = lazyPage(loadPortal, 'PortalProgressTab');
const PortalTaskPage = lazyPage(loadPortal, 'PortalTaskPage');
const PortalMeetingsTab = lazyPage(loadPortal, 'PortalMeetingsTab');
const PortalMeetingPage = lazyPage(loadPortal, 'PortalMeetingPage');
const PortalMeetingLink = lazyPage(loadPortal, 'PortalMeetingLink');
const PortalNotificationsPage = lazyPage(loadPortal, 'PortalNotificationsPage');
const PortalSettingsPage = lazyPage(loadPortal, 'PortalSettingsPage');

/** Lightweight fallback while a route chunk loads — no layout shift, respects reduced motion. */
function RouteFallback() {
  return (
    <div className="grid min-h-[40vh] place-items-center text-sm text-ink-3" role="status" aria-live="polite">
      <span className="animate-pulse motion-reduce:animate-none">Loading…</span>
    </div>
  );
}

/**
 * /login: once signed in, continue to the page that was originally asked for (deep links survive
 * sign-in) — on the right side for the account: a client lands on the portal (or the portal page
 * asked for; an invitation's /meetings/<id> link opens that meeting there), staff never on it.
 */
function LoginRoute() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const user = useAuthStore((s) => s.user);
  const location = useLocation();
  return isAuthenticated ? <Navigate to={landingPathFor(user, returnPathFrom(location.state))} replace /> : <LoginPage />;
}

/**
 * /chat, optionally asked to open something: ?dm=<user id> (a person picked in the search) or
 * ?conversation=<id> (a notification). Once it is open the address is tidied back to /chat.
 */
function ChatRoute() {
  const [params, setParams] = useSearchParams();
  return (
    <ChatPage
      startDirectWith={params.get('dm')}
      openConversationId={params.get('conversation')}
      onOpened={() => setParams({}, { replace: true })}
    />
  );
}

/**
 * 1.23.2: once a newer build is deployed (lib/update-recovery checks on focus and every 10 minutes), the
 * next move to another page is a full page load there — the new build, never an old page's missing code.
 */
function useFullLoadAfterUpdate() {
  const location = useLocation();
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    pageUpdateWatcher()?.navigate(`${location.pathname}${location.search}${location.hash}`);
    // Another page only (a filter typed into the address's query is not a move).
  }, [location.pathname]);
}

export function App() {
  // Tab title per page, and noindex on everything that isn't a public page.
  usePageMeta();
  useFullLoadAfterUpdate();
  return (
    <Suspense fallback={<RouteFallback />}>
      <Routes>
        <Route path="/login" element={<LoginRoute />} />
        <Route path="/forgot" element={<ForgotPasswordPage />} />
        <Route path="/reset" element={<ResetPasswordPage />} />
        {/* Public: linked from sign-in and the phone app (store listing needs a privacy policy address). */}
        <Route path="/privacy" element={<PrivacyPage />} />
        <Route path="/terms" element={<TermsPage />} />
        {/* Public too: the clients' privacy notice, linked from the client page (no sign-in of any kind). */}
        <Route path="/privacy/client" element={<ClientPrivacyPage />} />
        {/* A shared client follows one project: outside the staff sign-in and the app shell. */}
        <Route path="/client/:token" element={<ClientViewPage />} />
        <Route element={<ProtectedRoute />}>
          {/* 1.23 The Client portal: a client account sees only these pages, in their own shell. */}
          <Route element={<ClientRoute />}>
            <Route element={<PortalShell />}>
              <Route path="/portal" element={<PortalHomePage />} />
              {/* 1.23.7 The bell's Notifications and the client's notification switches. */}
              <Route path="/portal/notifications" element={<PortalNotificationsPage />} />
              <Route path="/portal/settings" element={<PortalSettingsPage />} />
              {/* An invitation email's meeting (/meetings/<id>, sent here by StaffRoute). */}
              <Route path="/portal/meetings/:meetingId" element={<PortalMeetingLink />} />
              <Route path="/portal/projects/:projectId" element={<PortalProjectLayout />}>
                <Route index element={<PortalProjectIndex />} />
                <Route path="progress" element={<PortalProgressTab />} />
                <Route path="tasks/:taskId" element={<PortalTaskPage />} />
                <Route path="meetings" element={<PortalMeetingsTab />} />
                <Route path="meetings/:meetingId" element={<PortalMeetingPage />} />
                <Route path="*" element={<PortalProjectIndex />} />
              </Route>
              <Route path="/portal/*" element={<Navigate to="/portal" replace />} />
            </Route>
          </Route>
          {/* The staff app: a client account is sent to the portal before any of it mounts. */}
          <Route element={<StaffRoute />}>
          <Route element={<AppShell />}>
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/board" element={<BoardPage />} />
            <Route path="/projects" element={<ProjectsPage />} />
            <Route path="/projects/:id" element={<ProjectDetailPage />} />
            <Route path="/my-tasks" element={<MyTasksPage />} />
            <Route path="/calendar" element={<CalendarPage />} />
            <Route path="/timeline" element={<TimelinePage />} />
            <Route path="/workload" element={<WorkloadPage />} />
            <Route path="/management" element={<ManagementRoute />} />
            <Route path="/meetings" element={<MeetingsPage />} />
            <Route path="/meetings/series/:id" element={<MeetingSeriesPage />} />
            <Route path="/meetings/:id" element={<MeetingDetailPage />} />
            <Route path="/my-action-items" element={<MyActionItemsPage />} />
            <Route path="/templates" element={<TemplatesPage />} />
            {/* Recycle Bin: admins and the people who run a project (the server decides what each one sees). */}
            <Route path="/recycle-bin" element={<RecycleBinPage />} />
            <Route path="/chat" element={<ChatRoute />} />
            <Route path="/mico-ai" element={<MicoAiPage />} />
            <Route path="/activity" element={<ActivityPage />} />
            <Route path="/search" element={<SearchPage />} />
            <Route path="/notifications" element={<NotificationsPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/profile" element={<ProfilePage />} />
            <Route path="/about" element={<AboutPage />} />
            {/* Inspection forms live on the Templates page; the early address still opens them. */}
            <Route path="/inspection-forms" element={<Navigate to="/templates?tab=inspections" replace />} />
            <Route path="/inspections/:id" element={<InspectionPage />} />
            <Route element={<AdminRoute />}>
              <Route path="/reports" element={<ReportsPage />} />
            </Route>
            {/* The Admin menu's pages — closed while Manager View is on (it says so, with Turn off). */}
            <Route element={<AdminSettingsRoute />}>
              <Route path="/admin/settings" element={<SystemSettingsPage />} />
              <Route path="/admin/ai" element={<AiSettingsPage />} />
              <Route path="/admin/audit" element={<AuditPage />} />
              <Route path="/admin/error-log" element={<ErrorLogPage />} />
              <Route path="/admin/users" element={<UsersPage />} />
              <Route path="/admin/companies" element={<CompaniesPage />} />
              <Route path="/admin/clients" element={<ClientsPage />} />
            </Route>
          </Route>
          </Route>
        </Route>
        {/* An unknown address: the dashboard (staff, or sign-in first) — a client's portal home. */}
        <Route path="*" element={<HomeRedirect />} />
      </Routes>
    </Suspense>
  );
}
