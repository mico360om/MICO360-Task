import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { useProjectsWith, useProjectsWithAll } from './useProjectsWith';
import { useAuthStore } from '../stores/auth-store';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const project = (id: string, name: string) => ({ id, code: id.toUpperCase(), name, status: 'ACTIVE', color: '#000', icon: null, imageUrl: null });
let asked: string[] = [];

beforeEach(() => {
  asked = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string) => {
      const url = String(input);
      asked.push(url.replace(/^.*\/api\/v1/, ''));
      if (url.endsWith('/projects')) return json({ data: [project('p1', 'Mine')] });
      if (url.endsWith('/projects/p9')) return json({ data: project('p9', 'Far Away Works') });
      if (url.endsWith('/projects/p8')) return json({ data: project('p8', 'Harbour Road') });
      return json({ error: { code: 'NOT_FOUND', message: 'Project not found.' } }, 404);
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  useAuthStore.setState({ user: null, accessToken: null, refreshToken: null, isAuthenticated: false });
});

const signIn = (roles: string[]) => useAuthStore.getState().setSession({ user: { id: 'u1', email: 'a@b.c', username: 'a', roles }, accessToken: 'at', refreshToken: 'rt' });
function Names({ id }: { id: string | null }) {
  const { projects, listQ } = useProjectsWith(id);
  return <p data-testid="names">{listQ.isSuccess ? projects.map((p) => p.name).join(', ') : '…'}</p>;
}
const renderIt = (id: string | null) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <Names id={id} />
    </QueryClientProvider>,
  );

describe('useProjectsWith (1.22: a project opened by its link, off an administrator’s own list)', () => {
  it('adds the page’s project for an administrator when the list leaves it out', async () => {
    signIn(['ADMIN']);
    renderIt('p9');
    await waitFor(() => expect(screen.getByTestId('names')).toHaveTextContent('Mine, Far Away Works'));
  });

  it('asks nothing more when the project is on the list, or for an employee', async () => {
    signIn(['ADMIN']);
    const { unmount } = renderIt('p1');
    await waitFor(() => expect(screen.getByTestId('names')).toHaveTextContent('Mine'));
    unmount();
    signIn(['EMPLOYEE']);
    renderIt('p9');
    await waitFor(() => expect(screen.getByTestId('names')).toHaveTextContent('Mine'));
    expect(asked.filter((u) => u.startsWith('/projects/'))).toEqual([]);
  });
});

function AllNames({ ids }: { ids: string[] }) {
  const { projects, listQ } = useProjectsWithAll(ids);
  return <p data-testid="all-names">{listQ.isSuccess ? projects.map((p) => p.name).join(', ') : '…'}</p>;
}
const renderAll = (ids: string[]) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <AllNames ids={ids} />
    </QueryClientProvider>,
  );

describe('useProjectsWithAll (1.22 review: an administrator’s own tasks from projects off their list)', () => {
  it('adds every listed task’s project the list leaves out, once each, for an administrator', async () => {
    signIn(['ADMIN']);
    renderAll(['p1', 'p9', 'p8', 'p9']);
    await waitFor(() => expect(screen.getByTestId('all-names')).toHaveTextContent('Mine, Far Away Works, Harbour Road'));
    expect(asked.filter((u) => u.startsWith('/projects/')).sort()).toEqual(['/projects/p8', '/projects/p9']);
  });

  it('asks nothing more for an employee, or when every project is on the list', async () => {
    signIn(['EMPLOYEE']);
    const { unmount } = renderAll(['p1', 'p9']);
    await waitFor(() => expect(screen.getByTestId('all-names')).toHaveTextContent('Mine'));
    unmount();
    signIn(['ADMIN']);
    renderAll(['p1']);
    await waitFor(() => expect(screen.getByTestId('all-names')).toHaveTextContent('Mine'));
    expect(asked.filter((u) => u.startsWith('/projects/'))).toEqual([]);
  });

  it('leaves out a project that can’t be opened (gone, or another company) instead of failing', async () => {
    signIn(['ADMIN']);
    renderAll(['p1', 'gone']);
    await waitFor(() => expect(asked).toContain('/projects/gone'));
    await waitFor(() => expect(screen.getByTestId('all-names')).toHaveTextContent(/^Mine$/));
  });
});
