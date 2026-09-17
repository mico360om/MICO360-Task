import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChatPage } from './ChatPage';
import { useAuthStore } from '../stores/auth-store';

// The realtime hook opens a socket.io connection — stub it so tests don't hang.
vi.mock('socket.io-client', () => ({ io: () => ({ on: () => {}, emit: () => {}, disconnect: () => {} }) }));

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}
function renderWithQuery(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

const message = (over: Partial<Record<string, unknown>> = {}) => ({
  id: 'm1', conversationId: 'c1', userId: 'u1', body: 'hello channel',
  editedAt: null, deletedAt: null, createdAt: new Date().toISOString(), reactions: [], attachments: [], ...over,
});

let posted: { url: string; body: unknown }[] = [];

beforeEach(() => {
  posted = [];
  useAuthStore.getState().setSession({ user: { id: 'me', email: 'me@x', username: 'me', roles: ['EMPLOYEE'] }, accessToken: 'at', refreshToken: 'rt' });
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url);
    const method = init?.method ?? 'GET';
    if (method === 'POST') posted.push({ url: u, body: init?.body ? JSON.parse(String(init.body)) : null });
    if (u.endsWith('/projects') && method === 'GET') return json({ data: [{ id: 'p1', code: 'MOB', name: 'Mobile App', color: '#8B1E1E', status: 'ACTIVE', clientName: null }] });
    if (u.endsWith('/conversations') && method === 'GET') return json({ data: [] });
    if (u.endsWith('/users/directory')) return json({ data: [{ id: 'u1', username: 'ada', firstName: 'Ada', lastName: 'Lovelace' }] });
    if (u.endsWith('/projects/p1/chat')) return json({ data: { conversation: { id: 'c1', kind: 'PROJECT', projectId: 'p1', createdAt: '' }, messages: [message()] } });
    if (u.includes('/conversations/c1/messages') && method === 'GET') return json({ data: [message()] });
    if (u.includes('/conversations/c1/messages') && method === 'POST') return json({ data: message({ id: 'm2', userId: 'me', body: 'my reply' }) });
    if (u.includes('/conversations/c1/read')) return json({ data: null });
    return json({ data: [] });
  }));
});
afterEach(() => vi.restoreAllMocks());

describe('ChatPage', () => {
  it('lists project channels and opens one to show its messages', async () => {
    renderWithQuery(<ChatPage />);
    await waitFor(() => expect(screen.getByText('Mobile App')).toBeInTheDocument());
    await userEvent.click(screen.getByText('Mobile App'));
    await waitFor(() => expect(screen.getByText('hello channel')).toBeInTheDocument());
    // author name resolved from the directory
    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument();
  });

  it('sends a message to the open channel', async () => {
    renderWithQuery(<ChatPage />);
    await waitFor(() => expect(screen.getByText('Mobile App')).toBeInTheDocument());
    await userEvent.click(screen.getByText('Mobile App'));
    await waitFor(() => expect(screen.getByText('hello channel')).toBeInTheDocument());

    const box = screen.getByPlaceholderText(/message/i);
    await userEvent.type(box, 'my reply');
    await userEvent.click(screen.getByRole('button', { name: /^send$/i }));

    await waitFor(() => expect(posted.some((p) => p.url.includes('/conversations/c1/messages'))).toBe(true));
    const sent = posted.find((p) => p.url.includes('/conversations/c1/messages'));
    expect((sent?.body as { body: string }).body).toBe('my reply');
  });
});
