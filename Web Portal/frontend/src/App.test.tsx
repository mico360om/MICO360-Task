import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import { App } from './App';
import { useAuthStore } from './stores/auth-store';

function renderApp(path = '/dashboard') {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  useAuthStore.getState().logout();
});

describe('App routing', () => {
  it('redirects to the login page when signed out', () => {
    renderApp('/dashboard');
    expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument();
  });

  it('shows the dashboard inside the shell when signed in', () => {
    useAuthStore.getState().setSession({
      user: { id: 'u1', email: 'a@b.c', username: 'ada', roles: ['ADMIN'] },
      accessToken: 'at',
      refreshToken: 'rt',
    });
    renderApp('/dashboard');
    expect(screen.getByRole('heading', { name: /welcome back/i })).toBeInTheDocument();
    // The shell's sidebar nav renders around the dashboard (the dashboard also links to
    // Projects, so target the nav landmark specifically to stay unambiguous).
    const nav = screen.getByRole('navigation', { name: /main/i });
    expect(within(nav).getByRole('link', { name: /projects/i })).toBeInTheDocument();
  });
});
