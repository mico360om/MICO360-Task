import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { render, screen } from '@testing-library/react';
import { ProtectedRoute, returnPathFrom } from './ProtectedRoute';
import { useAuthStore } from '../../stores/auth-store';

function LoginProbe() {
  const location = useLocation();
  return <div>Login page · return to {returnPathFrom(location.state)}</div>;
}

function renderAt(path = '/app') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/login" element={<LoginProbe />} />
        <Route element={<ProtectedRoute />}>
          <Route path="/app" element={<div>Secret dashboard</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  useAuthStore.getState().logout('remote');
  useAuthStore.setState({ endedBy: null });
});

describe('ProtectedRoute', () => {
  it('redirects unauthenticated users to /login', () => {
    renderAt('/app');
    expect(screen.getByText(/Login page/)).toBeInTheDocument();
    expect(screen.queryByText('Secret dashboard')).not.toBeInTheDocument();
  });

  it('renders protected content when authenticated', () => {
    useAuthStore.getState().setSession({
      user: { id: 'u1', email: 'a@b.c', username: 'ada', roles: ['ADMIN'] },
      accessToken: 'at',
      refreshToken: 'rt',
    });
    renderAt('/app');
    expect(screen.getByText('Secret dashboard')).toBeInTheDocument();
  });

  it('keeps the requested page (a deep link) as the return path through sign-in', () => {
    renderAt('/app?task=t9');
    expect(screen.getByText('Login page · return to /app?task=t9')).toBeInTheDocument();
  });

  it('forgets the page after an explicit log out', () => {
    useAuthStore.getState().setSession({ user: { id: 'u1', email: 'a@b.c', username: 'ada', roles: [] }, accessToken: 'at', refreshToken: 'rt' });
    useAuthStore.getState().logout('user');
    renderAt('/app');
    expect(screen.getByText('Login page · return to /dashboard')).toBeInTheDocument();
  });
});

describe('returnPathFrom', () => {
  it('only honours same-app paths', () => {
    expect(returnPathFrom({ from: { pathname: '/projects/p1', search: '?task=t1', hash: '' } })).toBe('/projects/p1?task=t1');
    expect(returnPathFrom({ from: { pathname: '//evil.example', search: '', hash: '' } })).toBe('/dashboard');
    expect(returnPathFrom({ from: { pathname: '/login', search: '', hash: '' } })).toBe('/dashboard');
    expect(returnPathFrom(null)).toBe('/dashboard');
  });
});
