import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { render, screen, waitFor } from '@testing-library/react';
import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { FirstStepsActions, useNoProjectsYet } from './FirstSteps';
import { useAuthStore } from '../stores/auth-store';

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}
const signIn = (roles: string[]) =>
  useAuthStore.getState().setSession({ user: { id: 'u1', email: 'a@b.c', username: 'admin', roles }, accessToken: 'at', refreshToken: 'rt' });

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  useAuthStore.getState().logout();
});

describe('FirstStepsActions', () => {
  it('an administrator is pointed to the two first steps: create a project, then add the team', () => {
    signIn(['ADMIN']);
    render(<FirstStepsActions />, { wrapper });
    expect(screen.getByRole('link', { name: 'Create a project' })).toHaveAttribute('href', '/projects');
    expect(screen.getByRole('link', { name: 'Add your team' })).toHaveAttribute('href', '/admin/users');
  });

  it('anyone else can create a project, but adding people is an administrator’s job', () => {
    signIn([]);
    render(<FirstStepsActions />, { wrapper });
    expect(screen.getByRole('link', { name: 'Create a project' })).toHaveAttribute('href', '/projects');
    expect(screen.queryByRole('link', { name: 'Add your team' })).not.toBeInTheDocument();
  });

  it('the links are finger-sized on a touch screen', () => {
    signIn(['ADMIN']);
    render(<FirstStepsActions />, { wrapper });
    for (const link of screen.getAllByRole('link')) expect(link.className).toMatch(/\[@media\(pointer:coarse\)\]:!?min-h-11/);
  });
});

describe('useNoProjectsYet', () => {
  beforeEach(() => signIn(['ADMIN']));

  it('is true once the server says there are no projects', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ data: [] })));
    const { result } = renderHook(() => useNoProjectsYet(), { wrapper });
    expect(result.current).toBe(false); // not while loading
    await waitFor(() => expect(result.current).toBe(true));
  });

  it('is false when there are projects, and when the list could not be loaded (an outage is not a first day)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ data: [{ id: 'p1' }] })));
    const some = renderHook(() => useNoProjectsYet(), { wrapper });
    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));
    expect(some.result.current).toBe(false);

    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { code: 'X', message: 'down' } }), { status: 500 })));
    const down = renderHook(() => useNoProjectsYet(), { wrapper });
    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));
    expect(down.result.current).toBe(false);
  });
});
