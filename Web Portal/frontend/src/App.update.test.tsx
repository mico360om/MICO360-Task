import { describe, it, expect, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from './App';
import { useAuthStore } from './stores/auth-store';

// 1.23.2 — once a newer build is deployed, the next move to another page is a full page load there.
const navigate = vi.fn((_url: string) => false);
vi.mock('./lib/update-recovery', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./lib/update-recovery')>()),
  pageUpdateWatcher: () => ({ navigate }),
}));

describe('App — moving to another page after an update', () => {
  it('asks the update watcher at each move to another page (not at the first page)', async () => {
    useAuthStore.getState().setSession({ user: { id: 'u1', email: 'a@b.c', username: 'ada', roles: ['ADMIN'] }, accessToken: 'at', refreshToken: 'rt' });
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter initialEntries={['/dashboard']}>
          <App />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(screen.getByRole('heading', { name: /welcome back/i })).toBeInTheDocument();
    expect(navigate).not.toHaveBeenCalled();
    await userEvent.click(within(screen.getByRole('navigation', { name: /main/i })).getByRole('link', { name: /projects/i }));
    await vi.waitFor(() => expect(navigate).toHaveBeenCalledWith('/projects'));
    expect(navigate).toHaveBeenCalledTimes(1);
  });
});
