import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { render, screen, waitFor } from '@testing-library/react';
import { UsersPage } from './UsersPage';
import { SettingsPage } from './SettingsPage';
import { useAuthStore } from '../stores/auth-store';

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}
function withQuery(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

afterEach(() => {
  vi.restoreAllMocks();
  useAuthStore.getState().logout();
});

describe('UsersPage (admin)', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ data: [{ id: 'u1', email: 'ada@x.co', username: 'ada', firstName: 'Ada', lastName: 'L', status: 'ACTIVE', roles: ['EMPLOYEE'] }] })));
  });
  it('lists users from the API', async () => {
    withQuery(<UsersPage />);
    await waitFor(() => expect(screen.getByText('ada')).toBeInTheDocument());
    expect(screen.getByText('ada@x.co')).toBeInTheDocument();
  });
});

describe('SettingsPage', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ data: { muted: [] } })));
  });
  it('shows the signed-in user’s profile and notification settings', () => {
    useAuthStore.getState().setSession({ user: { id: 'u1', email: 'admin@mico360.test', username: 'admin', roles: ['ADMIN'] }, accessToken: 'at', refreshToken: 'rt' });
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter>
          <SettingsPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(screen.getAllByText('admin').length).toBeGreaterThan(0);
    expect(screen.getByText('admin@mico360.test')).toBeInTheDocument();
    expect(screen.getAllByText('Administrator').length).toBeGreaterThan(0);
    expect(screen.getByText('Notifications')).toBeInTheDocument();
  });
});
