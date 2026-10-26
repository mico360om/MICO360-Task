import { lazy, Suspense, type ComponentType } from 'react';
import { Routes, Route, Navigate, useLocation, useSearchParams } from 'react-router-dom';
import { ProtectedRoute, returnPathFrom } from './features/auth/ProtectedRoute';
import { AdminRoute } from './features/auth/AdminRoute';
import { AppShell } from './components/AppShell';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';
import { useAuthStore } from './stores/auth-store';
import { usePageMeta } from './lib/page-meta';

// Eager: the auth flow + the landing dashboard (first paint on a slow device should not wait
// on a second chunk). Everything else is code-split so a low-resource client only downloads
// and parses the JavaScript for the screen it actually opens.
const lazyPage = <T extends string>(load: () => Promise<Record<T, ComponentType>>, name: T) =>
  lazy(() => load().then((m) => ({ default: m[name] })));

const ForgotPasswordPage = lazyPage(() => import('./pages/ForgotPasswordPage'), 'ForgotPasswordPage');
const ResetPasswordPage = lazyPage(() => import('./pages/ResetPasswordPage'), 'ResetPasswordPage');
const PrivacyPage = lazyPage(() => import('./pages/LegalPages'), 'PrivacyPage');
const TermsPage = lazyPage(() => import('./pages/LegalPages'), 'TermsPage');
const BoardPage = lazyPage(() => import('./pages/BoardPage'), 'BoardPage');
const ProjectsPage = lazyPage(() => import('./pages/ProjectsPage'), 'ProjectsPage');
const ProjectDetailPage = lazyPage(() => import('./pages/ProjectDetailPage'), 'ProjectDetailPage');
const NotificationsPage = lazyPage(() => import('./pages/NotificationsPage'), 'NotificationsPage');
const ReportsPage = lazyPage(() => import('./pages/ReportsPage'), 'ReportsPage');
const UsersPage = lazyPage(() => import('./pages/UsersPage'), 'UsersPage');
const SettingsPage = lazyPage(() => import('./pages/SettingsPage'), 'SettingsPage');
const MyTasksPage = lazyPage(() => import('./pages/MyTasksPage'), 'MyTasksPage');
const AuditPage = lazyPage(() => import('./pages/AuditPage'), 'AuditPage');
const SystemSettingsPage = lazyPage(() => import('./pages/SystemSettingsPage'), 'SystemSettingsPage');
const AiSettingsPage = lazyPage(() => import('./pages/AiSettingsPage'), 'AiSettingsPage');
const ActivityPage = lazyPage(() => import('./pages/ActivityPage'), 'ActivityPage');
const CalendarPage = lazyPage(() => import('./pages/CalendarPage'), 'CalendarPage');
const TimelinePage = lazyPage(() => import('./pages/TimelinePage'), 'TimelinePage');
const WorkloadPage = lazyPage(() => import('./pages/WorkloadPage'), 'WorkloadPage');
const MeetingsPage = lazyPage(() => import('./pages/MeetingsPage'), 'MeetingsPage');
const MeetingDetailPage = lazyPage(() => import('./pages/MeetingDetailPage'), 'MeetingDetailPage');
const MyActionItemsPage = lazyPage(() => import('./pages/MyActionItemsPage'), 'MyActionItemsPage');
// Takes props (see ChatRoute), so it is loaded with its own type rather than through lazyPage.
const ChatPage = lazy(() => import('./pages/ChatPage').then((m) => ({ default: m.ChatPage })));
const ProfilePage = lazyPage(() => import('./pages/ProfilePage'), 'ProfilePage');
const MicoAiPage = lazyPage(() => import('./pages/MicoAiPage'), 'MicoAiPage');
// A client's read-only page for one shared project (no staff sign-in, no app shell).
const ClientViewPage = lazyPage(() => import('./pages/ClientViewPage'), 'ClientViewPage');
const AboutPage = lazyPage(() => import('./pages/AboutPage'), 'AboutPage');

/** Lightweight fallback while a route chunk loads — no layout shift, respects reduced motion. */
function RouteFallback() {
  return (
    <div className="grid min-h-[40vh] place-items-center text-sm text-ink-3" role="status" aria-live="polite">
      <span className="animate-pulse motion-reduce:animate-none">Loading…</span>
    </div>
  );
}

/** /login: once signed in, continue to the page that was originally asked for (deep links survive sign-in). */
function LoginRoute() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const location = useLocation();
  return isAuthenticated ? <Navigate to={returnPathFrom(location.state)} replace /> : <LoginPage />;
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

export function App() {
  // Tab title per page, and noindex on everything that isn't a public page.
  usePageMeta();
  return (
    <Suspense fallback={<RouteFallback />}>
      <Routes>
        <Route path="/login" element={<LoginRoute />} />
        <Route path="/forgot" element={<ForgotPasswordPage />} />
        <Route path="/reset" element={<ResetPasswordPage />} />
        {/* Public: linked from sign-in and the phone app (store listing needs a privacy policy address). */}
        <Route path="/privacy" element={<PrivacyPage />} />
        <Route path="/terms" element={<TermsPage />} />
        {/* A shared client follows one project: outside the staff sign-in and the app shell. */}
        <Route path="/client/:token" element={<ClientViewPage />} />
        <Route element={<ProtectedRoute />}>
          <Route element={<AppShell />}>
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/board" element={<BoardPage />} />
            <Route path="/projects" element={<ProjectsPage />} />
            <Route path="/projects/:id" element={<ProjectDetailPage />} />
            <Route path="/my-tasks" element={<MyTasksPage />} />
            <Route path="/calendar" element={<CalendarPage />} />
            <Route path="/timeline" element={<TimelinePage />} />
            <Route path="/workload" element={<WorkloadPage />} />
            <Route path="/meetings" element={<MeetingsPage />} />
            <Route path="/meetings/:id" element={<MeetingDetailPage />} />
            <Route path="/my-action-items" element={<MyActionItemsPage />} />
            <Route path="/chat" element={<ChatRoute />} />
            <Route path="/mico-ai" element={<MicoAiPage />} />
            <Route path="/activity" element={<ActivityPage />} />
            <Route path="/notifications" element={<NotificationsPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/profile" element={<ProfilePage />} />
            <Route path="/about" element={<AboutPage />} />
            <Route element={<AdminRoute />}>
              <Route path="/reports" element={<ReportsPage />} />
              <Route path="/admin/settings" element={<SystemSettingsPage />} />
              <Route path="/admin/ai" element={<AiSettingsPage />} />
              <Route path="/admin/audit" element={<AuditPage />} />
              <Route path="/admin/users" element={<UsersPage />} />
            </Route>
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </Suspense>
  );
}
