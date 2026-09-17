import { Navigate, Outlet } from 'react-router-dom';
import { useAuthStore } from '../../stores/auth-store';

/** Gates a route subtree behind the ADMIN role; sends non-admins back to the dashboard. */
export function AdminRoute() {
  const isAdmin = useAuthStore((s) => s.isAdmin());
  return isAdmin ? <Outlet /> : <Navigate to="/dashboard" replace />;
}
