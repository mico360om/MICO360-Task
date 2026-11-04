import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MicrosoftTeamsSettings } from './MicrosoftTeamsSettings';
import { useAuthStore } from '../../stores/auth-store';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

type Call = { url: string; method: string; credentials?: RequestCredentials };
let calls: Call[];
let available: boolean;
let status: Record<string, unknown>;

beforeEach(() => {
  calls = [];
  available = true;
  status = { available: true, connected: false, email: null, name: null, connectedAt: null, problem: null };
  useAuthStore.getState().setSession({ user: { id: 'u1', email: 'k@prolens.om', username: 'khurram', roles: ['EMPLOYEE'] }, accessToken: 'at', refreshToken: 'rt' });
  window.history.replaceState(null, '', '/settings');
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      const method = init?.method ?? 'GET';
      calls.push({ url: u, method, credentials: init?.credentials });
      if (u.endsWith('/config')) return json({ data: { timeZone: 'Asia/Muscat', productName: 'x', companyName: 'y', serverTime: new Date().toISOString(), microsoftTeams: available } });
      if (u.endsWith('/integrations/microsoft/connect')) return json({ data: { url: 'https://login.microsoftonline.com/t1/oauth2/v2.0/authorize?client_id=c&state=s' } });
      if (u.endsWith('/integrations/microsoft') && method === 'DELETE') {
        status = { ...status, connected: false, email: null, name: null };
        return json({ data: { disconnected: true } });
      }
      if (u.endsWith('/integrations/microsoft')) return json({ data: status });
      return json({ data: {} });
    }),
  );
});
afterEach(() => vi.restoreAllMocks());

function renderIt(open = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <MicrosoftTeamsSettings open={open} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { open };
}

describe('Settings → Microsoft Teams', () => {
  it('is hidden when Teams links aren’t set up on this site (and asks nothing about the connection)', async () => {
    available = false;
    renderIt();
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/config'))).toBe(true));
    expect(screen.queryByRole('heading', { name: 'Microsoft Teams' })).toBeNull();
    expect(calls.some((c) => c.url.endsWith('/integrations/microsoft'))).toBe(false);
  });

  it('not connected: Connect Microsoft account asks the server (sending this browser’s cookies), then opens Microsoft’s page', async () => {
    const { open } = renderIt();
    expect(await screen.findByRole('heading', { name: 'Microsoft Teams' })).toBeTruthy();
    await userEvent.click(await screen.findByRole('button', { name: 'Connect Microsoft account' }));
    await waitFor(() => expect(open).toHaveBeenCalledWith('https://login.microsoftonline.com/t1/oauth2/v2.0/authorize?client_id=c&state=s'));
    const call = calls.find((c) => c.url.endsWith('/integrations/microsoft/connect'));
    expect(call?.method).toBe('POST');
    // Its answer sets the flow cookie in this browser (also with the website on another origin).
    expect(call?.credentials).toBe('include');
  });

  it('connected: "Connected as …" and Disconnect (asked first)', async () => {
    status = { ...status, connected: true, email: 'khurram@prolens.example', name: 'Khurram', connectedAt: '2026-11-04T08:00:00.000Z' };
    renderIt();
    expect(await screen.findByText(/Connected as khurram@prolens\.example/)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog.textContent).toMatch(/Teams links already made keep working/);
    await userEvent.click(screen.getByRole('button', { name: 'Disconnect Microsoft' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'DELETE' && c.url.endsWith('/integrations/microsoft'))).toBe(true));
    expect(await screen.findByText(/Microsoft Teams is disconnected/)).toBeTruthy();
  });

  it('a connection that stopped working says why, with Connect again', async () => {
    status = { ...status, connected: false, email: 'khurram@prolens.example', problem: 'Microsoft no longer accepts this connection. Connect Microsoft Teams again.' };
    renderIt();
    expect((await screen.findByRole('alert')).textContent).toMatch(/no longer accepts/);
    expect(screen.getByRole('button', { name: 'Connect again' })).toBeTruthy();
  });

  it.each([
    ['connected', /Microsoft Teams is connected/],
    ['denied', /cancelled on Microsoft’s page/],
    ['failed', /couldn’t be connected/],
  ])('back from Microsoft (?teams=%s): says how it went, then takes it out of the address', async (result, text) => {
    window.history.replaceState(null, '', `/settings?teams=${result}#microsoft-teams`);
    renderIt();
    expect(await screen.findByText(text)).toBeTruthy();
    expect(window.location.search).toBe('');
    expect(window.location.hash).toBe('#microsoft-teams');
  });
});
