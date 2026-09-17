import { lazy, Suspense, type ComponentType } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { ProtectedRoute } from './features/auth/ProtectedRoute';
import { AdminRoute } from './features/auth/AdminRoute';
import { AppShell } from './components/AppShell';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';
import { useAuthStore } from './stores/auth-store';

// Eager: the auth flow + the landing dashboard (first paint on a slow device should not wait
// on a second chunk). Everything else is code-split so a low-resource client only downloads
// and parses the JavaScript for the screen it actually opens.
const lazyPage = <T extends string>(load: () => Promise<Record<T, ComponentType>>, name: T) =>
  lazy(() => load().then((m) => ({ default: m[name] })));

const ForgotPasswordPage = lazyPage(() => import('./pages/ForgotPasswordPage'), 'ForgotPasswordPage');
const ResetPasswordPage = lazyPage(() => import('./pages/ResetPasswordPage'), 'ResetPasswordPage');
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
const MeetingsPage = lazyPage(() => import('./pages/MeetingsPage'), 'MeetingsPage');
const MeetingDetailPage = lazyPage(() => import('./pages/MeetingDetailPage'), 'MeetingDetailPage');
const MyActionItemsPage = lazyPage(() => import('./pages/MyActionItemsPage'), 'MyActionItemsPage');
const ChatPage = lazyPage(() => import('./pages/ChatPage'), 'ChatPage');
const ProfilePage = lazyPage(() => import('./pages/ProfilePage'), 'ProfilePage');

/** Lightweight fallback while a route chunk loads — no layout shift, respects reduced motion. */
function RouteFallback() {
  return (
    <div className="grid min-h-[40vh] place-items-center text-sm text-ink-3" role="status" aria-live="polite">
      <span className="animate-pulse motion-reduce:animate-none">Loading…</span>
    </div>
  );
}

export function App() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  return (
    <Suspense fallback={<RouteFallback />}>
      <Routes>
        <Route path="/login" element={isAuthenticated ? <Navigate to="/dashboard" replace /> : <LoginPage />} />
        <Route path="/forgot" element={<ForgotPasswordPage />} />
        <Route path="/reset" element={<ResetPasswordPage />} />
        <Route element={<ProtectedRoute />}>
          <Route element={<AppShell />}>
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/board" element={<BoardPage />} />
            <Route path="/projects" element={<ProjectsPage />} />
            <Route path="/projects/:id" element={<ProjectDetailPage />} />
            <Route path="/my-tasks" element={<MyTasksPage />} />
            <Route path="/calendar" element={<CalendarPage />} />
            <Route path="/meetings" element={<MeetingsPage />} />
            <Route path="/meetings/:id" element={<MeetingDetailPage />} />
            <Route path="/my-action-items" element={<MyActionItemsPage />} />
            <Route path="/chat" element={<ChatPage />} />
            <Route path="/activity" element={<ActivityPage />} />
            <Route path="/notifications" element={<NotificationsPage />} />
            <Route path="/reports" element={<ReportsPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/profile" element={<ProfilePage />} />
            <Route element={<AdminRoute />}>
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
