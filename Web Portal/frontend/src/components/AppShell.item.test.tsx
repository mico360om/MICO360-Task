import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AppShell } from './AppShell';
import { useAuthStore } from '../stores/auth-store';

vi.mock('socket.io-client', () => ({ io: () => ({ on: vi.fn(), emit: vi.fn(), connect: vi.fn(), disconnect: vi.fn() }) }));
// The panel itself is tested on its own: here, only what the shell hands it and how it closes.
vi.mock('./TaskDrawerContainer', () => ({
  TaskDrawerContainer: ({ taskId, focusItemId, onClose }: { taskId: string; focusItemId?: string | null; onClose: () => void }) => (
    <div role="dialog" aria-label={`Task ${taskId}`}>
      <span data-testid="focus-item">{focusItemId ?? 'none'}</span>
      <button type="button" onClick={onClose}>
        Close
      </button>
    </div>
  ),
}));

function Where() {
  const { search } = useLocation();
  return <output data-testid="search">{search}</output>;
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ data: { count: 0 } }), { status: 200, headers: { 'content-type': 'application/json' } })));
  useAuthStore.getState().setSession({ user: { id: 'u1', email: 'a@b.c', username: 'ada', roles: [] }, accessToken: 'at', refreshToken: 'rt' });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('AppShell: a task opened at a checklist item (1.23.3)', () => {
  it('hands …&item=<id> to the task panel, and closing the panel takes it off the address too', async () => {
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={['/dashboard?view=x&task=t1&item=i7']}>
          <Routes>
            <Route element={<AppShell />}>
              <Route
                path="/dashboard"
                element={
                  <>
                    <div>Dashboard content</div>
                    <Where />
                  </>
                }
              />
            </Route>
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(screen.getByTestId('focus-item')).toHaveTextContent('i7');
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog', { name: 'Task t1' })).toBeNull();
    expect(screen.getByTestId('search')).toHaveTextContent('?view=x');
  });
});
