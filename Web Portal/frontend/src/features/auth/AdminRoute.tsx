import { Navigate, Outlet } from 'react-router-dom';
import { useAuthStore } from '../../stores/auth-store';
import { useManagerView } from '../../lib/manager-view';
import { ManagerViewBlocked } from '../../components/ManagerViewBlocked';

/** Gates a route subtree behind the ADMIN role; sends non-admins back to the dashboard (Reports). */
export function AdminRoute() {
  const isAdmin = useAuthStore((s) => s.isAdmin());
  return isAdmin ? <Outlet /> : <Navigate to="/dashboard" replace />;
}

/**
 * The Admin menu's pages (User Management, Clients, Companies, AI Management, System Settings, Error Log,
 * Audit Logs): administrators only, and — while Manager View is on — "Manager View is on — turn it off to
 * open this page" with Turn off instead (the server refuses their requests then too).
 */
export function AdminSettingsRoute() {
  const isAdmin = useAuthStore((s) => s.isAdmin());
  const { on } = useManagerView();
  if (!isAdmin) return <Navigate to="/dashboard" replace />;
  return on ? <ManagerViewBlocked /> : <Outlet />;
}
