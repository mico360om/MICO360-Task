import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { render, screen } from '@testing-library/react';
import { ProtectedRoute } from './ProtectedRoute';
import { useAuthStore } from '../../stores/auth-store';

function renderAt(path = '/app') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/login" element={<div>Login page</div>} />
        <Route element={<ProtectedRoute />}>
          <Route path="/app" element={<div>Secret dashboard</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  useAuthStore.getState().logout();
});

describe('ProtectedRoute', () => {
  it('redirects unauthenticated users to /login', () => {
    renderAt('/app');
    expect(screen.getByText('Login page')).toBeInTheDocument();
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
});
