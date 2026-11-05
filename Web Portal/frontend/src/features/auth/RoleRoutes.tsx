import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuthStore } from '../../stores/auth-store';
import { clientPathFor, PORTAL_HOME, STAFF_HOME } from './client-routes';

/**
 * 1.23 The staff app's pages (and its shell — sidebar, bell, chat, realtime socket, company picker,
 * MICO AI, reminders, search): a client account never sees them. A client is sent to the portal —
 * an invitation email's /meetings/<id> link to that meeting in the portal — before anything of the
 * staff app mounts (so none of its requests or its socket starts).
 */
export function StaffRoute() {
  const isClient = useAuthStore((s) => s.isClient());
  const location = useLocation();
  if (isClient) return <Navigate to={clientPathFor(`${location.pathname}${location.search}`)} replace />;
  return <Outlet />;
}

/** 1.23 The Client portal's pages: client accounts only; staff are sent to their dashboard. */
export function ClientRoute() {
  const isClient = useAuthStore((s) => s.isClient());
  return isClient ? <Outlet /> : <Navigate to={STAFF_HOME} replace />;
}

/** An unknown address: each side's home (signed out, the dashboard asks for sign-in first). */
export function HomeRedirect() {
  const isClient = useAuthStore((s) => s.isAuthenticated && s.isClient());
  return <Navigate to={isClient ? PORTAL_HOME : STAFF_HOME} replace />;
}
