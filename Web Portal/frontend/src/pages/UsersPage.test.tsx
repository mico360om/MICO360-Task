import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { UsersPage } from './UsersPage';
import { useAuthStore } from '../stores/auth-store';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

let calls: { url: string; method: string; body?: Record<string, unknown> }[];

beforeEach(() => {
  calls = [];
  useAuthStore.getState().setSession({ user: { id: 'me', email: 'a@b.c', username: 'admin', roles: ['ADMIN'] }, accessToken: 'at', refreshToken: 'rt' });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      calls.push({ url: String(url), method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (String(url).endsWith('/users') && method === 'POST') return json({ data: { id: 'new' } }, 201);
      if (String(url).includes('/status')) return json({ data: {} });
      return json({ data: [{ id: 'u9', email: 'omar@x.co', username: 'omar', firstName: 'Omar', lastName: 'A', status: 'ACTIVE', roles: ['EMPLOYEE'] }] });
    }),
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  useAuthStore.getState().logout();
});

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <UsersPage />
    </QueryClientProvider>,
  );
}

describe('UsersPage (admin management)', () => {
  it('changes a user’s status via the API', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('omar')).toBeInTheDocument());
    await userEvent.selectOptions(screen.getByLabelText(/status for omar/i), 'SUSPENDED');
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/users/u9/status') && c.body?.status === 'SUSPENDED')).toBe(true));
  });

  it('creates a new user from the modal', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('omar')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: /new user/i }));
    await userEvent.type(screen.getByLabelText(/first name/i), 'Nadia');
    await userEvent.type(screen.getByLabelText(/last name/i), 'Ahmed');
    await userEvent.type(screen.getByLabelText(/username/i), 'nadia');
    await userEvent.type(screen.getByLabelText(/email/i), 'nadia@x.co');
    await userEvent.type(screen.getByLabelText(/temp password/i), 'secret1');
    await userEvent.click(screen.getByRole('button', { name: /create user/i }));
    await waitFor(() =>
      expect(calls.some((c) => c.url.endsWith('/users') && c.method === 'POST' && c.body?.username === 'nadia')).toBe(true),
    );
  });

  it('edits a user’s email and roles from the edit modal', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('omar')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: /^edit$/i }));
    const email = await screen.findByLabelText(/email/i);
    await userEvent.clear(email);
    await userEvent.type(email, 'omar2@x.co');
    await userEvent.click(screen.getByLabelText('Administrator'));
    await userEvent.click(screen.getByRole('button', { name: /save changes/i }));
    await waitFor(() =>
      expect(
        calls.some(
          (c) =>
            c.url.endsWith('/users/u9') &&
            c.method === 'PUT' &&
            c.body?.email === 'omar2@x.co' &&
            Array.isArray(c.body?.roleNames) &&
            (c.body?.roleNames as string[]).includes('ADMIN'),
        ),
      ).toBe(true),
    );
  });

  it('resets a user’s password from the edit modal', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('omar')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: /^edit$/i }));
    await userEvent.type(await screen.findByLabelText(/new password/i), 'FreshPass1!');
    await userEvent.click(screen.getByRole('button', { name: /^reset$/i }));
    await waitFor(() =>
      expect(
        calls.some((c) => c.url.endsWith('/users/u9/password') && c.method === 'POST' && c.body?.password === 'FreshPass1!'),
      ).toBe(true),
    );
  });
});
