import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MyProjectsSettings, MY_PROJECTS_WORDS } from './MyProjectsSettings';
import { useAuthStore } from '../../stores/auth-store';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
let prefs: Record<string, unknown>;
let saved: unknown[];
let failSave: boolean;
let listReads: number;

beforeEach(() => {
  prefs = { timeZone: null, weekStart: null, myProjectsOnly: false };
  saved = [];
  failSave = false;
  listReads = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/users/me/preferences') && init?.method === 'PUT') {
        if (failSave) return json({ error: { code: 'INTERNAL', message: 'Something went wrong.' } }, 500);
        const body = JSON.parse(String(init.body));
        saved.push(body);
        prefs = { ...prefs, ...body };
        return json({ data: prefs });
      }
      if (url.endsWith('/users/me/preferences')) return json({ data: prefs });
      if (url.endsWith('/projects')) {
        listReads++;
        return json({ data: [] });
      }
      return json({ data: null });
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  useAuthStore.setState({ user: null, accessToken: null, refreshToken: null, isAuthenticated: false });
});

const signIn = (roles: string[]) => useAuthStore.getState().setSession({ user: { id: 'me', email: 'me@x', username: 'me', roles }, accessToken: 'at', refreshToken: 'rt' });

/** A list on screen next to the card, so the test can see it read again after a change. */
function AList() {
  useQuery({ queryKey: ['projects'], queryFn: () => fetch('/api/v1/projects').then((r) => r.json()) });
  return null;
}

const renderIt = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MyProjectsSettings />
      <AList />
    </QueryClientProvider>,
  );

describe('Settings → Projects: “Show my projects only” (1.22)', () => {
  it('is offered to an administrator, off by default, with its plain hint', async () => {
    signIn(['ADMIN']);
    renderIt();
    const toggle = await screen.findByRole('switch', { name: 'Show my projects only' });
    expect(screen.getByRole('heading', { name: 'Projects' })).toBeInTheDocument();
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    expect(toggle).toHaveAccessibleDescription(MY_PROJECTS_WORDS.hint);
    expect(screen.getByText('Lists everywhere show only the projects you own, manage or are on the team of. You can still open any project by its link.')).toBeInTheDocument();
  });

  it('saves on the server and reads every list again', async () => {
    signIn(['ADMIN']);
    renderIt();
    const toggle = await screen.findByRole('switch', { name: 'Show my projects only' });
    await waitFor(() => expect(listReads).toBe(1));
    await userEvent.setup().click(toggle);
    await waitFor(() => expect(saved).toEqual([{ myProjectsOnly: true }]));
    await waitFor(() => expect(toggle).toHaveAttribute('aria-checked', 'true'));
    await waitFor(() => expect(listReads).toBe(2)); // the cached list was dropped and read again
  });

  it('shows the saved choice, and says so when a change could not be saved', async () => {
    signIn(['ADMIN']);
    prefs = { ...prefs, myProjectsOnly: true };
    failSave = true;
    renderIt();
    const toggle = await screen.findByRole('switch', { name: 'Show my projects only' });
    await waitFor(() => expect(toggle).toHaveAttribute('aria-checked', 'true'));
    await userEvent.setup().click(toggle);
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t save that change. Please try again.');
    expect(toggle).toHaveAttribute('aria-checked', 'true');
  });

  it('is not shown to an employee', async () => {
    signIn(['EMPLOYEE']);
    renderIt();
    await waitFor(() => expect(listReads).toBe(1));
    expect(screen.queryByRole('switch', { name: 'Show my projects only' })).not.toBeInTheDocument();
  });
});
