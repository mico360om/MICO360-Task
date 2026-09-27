import { Navigate, Outlet, useLocation, type Location } from 'react-router-dom';
import { useAuthStore } from '../../stores/auth-store';

/** Router state carried to /login so sign-in can return to the page that was asked for. */
export interface LoginRedirectState {
  from?: Pick<Location, 'pathname' | 'search' | 'hash'>;
}

/**
 * Where to go after signing in: the originally requested in-app page (a deep link from an email, or
 * the page a session expired on), else the dashboard. Only same-app paths are honoured.
 */
export function returnPathFrom(state: unknown): string {
  const from = (state as LoginRedirectState | null)?.from;
  if (!from || typeof from.pathname !== 'string') return '/dashboard';
  const path = `${from.pathname}${from.search ?? ''}${from.hash ?? ''}`;
  if (!path.startsWith('/') || path.startsWith('//') || path.startsWith('/login')) return '/dashboard';
  return path;
}

/** Gates a route subtree behind authentication; redirects to /login (remembering the page) otherwise. */
export function ProtectedRoute() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  // After an explicit "Log out" the next person starts fresh on the dashboard.
  const endedBy = useAuthStore((s) => s.endedBy);
  const location = useLocation();
  if (isAuthenticated) return <Outlet />;
  const state: LoginRedirectState | undefined =
    endedBy === 'user' ? undefined : { from: { pathname: location.pathname, search: location.search, hash: location.hash } };
  return <Navigate to="/login" replace state={state} />;
}
