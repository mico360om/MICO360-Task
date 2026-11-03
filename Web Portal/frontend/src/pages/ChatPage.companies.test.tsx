import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChatPage } from './ChatPage';
import { useAuthStore } from '../stores/auth-store';

/**
 * Chat with companies (MC2 Task 8): a direct chat with someone I no longer share a company with is
 * readable but read-only (the server's words), the new-message picker lists only colleagues, and the
 * names on messages always show (`authors` fill in people the directory doesn't have).
 */

vi.mock('socket.io-client', () => ({ io: () => ({ on: () => {}, off: () => {}, emit: () => {}, connect: () => {}, disconnect: () => {} }) }));

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const SARA_NOTE = 'You no longer share a company with Sara.';

const message = (over: Record<string, unknown> = {}) => ({
  id: 'm1', conversationId: 'd1', userId: 'sara', body: 'old hello', editedAt: null, deletedAt: null,
  createdAt: new Date(Date.now() - 60_000).toISOString(), reactions: [], attachments: [], replyTo: null, clientId: null, ...over,
});
const dm = (over: Record<string, unknown> = {}) => ({
  conversation: { id: 'd1', kind: 'DIRECT', projectId: null, createdAt: '' },
  participants: [
    { conversationId: 'd1', userId: 'me', lastReadAt: null, lastDeliveredAt: null, addedAt: '' },
    { conversationId: 'd1', userId: 'sara', lastReadAt: null, lastDeliveredAt: null, addedAt: '' },
  ],
  unread: 0,
  lastMessage: null,
  prefs: { favorite: false, archived: false, muted: false },
  readOnly: null,
  ...over,
});

let inbox: unknown[];
let directory: unknown[];
let override: (u: string, method: string, body: unknown) => Response | undefined;
let posted: { url: string; body: unknown }[];

beforeEach(() => {
  localStorage.clear();
  posted = [];
  override = () => undefined;
  inbox = [dm()];
  directory = [
    { id: 'me', username: 'me', firstName: 'Mo', lastName: 'Me', colleague: true },
    { id: 'sara', username: 'sara', firstName: 'Sara', lastName: 'Said', colleague: false },
  ];
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
  useAuthStore.getState().setSession({ user: { id: 'me', email: 'me@x', username: 'me', roles: ['EMPLOYEE'] }, accessToken: 'at', refreshToken: 'rt' });
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url);
    const method = init?.method ?? 'GET';
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
    if (method === 'POST') posted.push({ url: u, body });
    const o = override(u, method, body);
    if (o) return o;
    if (u.endsWith('/projects') && method === 'GET') return json({ data: [{ id: 'p1', code: 'PAB', name: 'Shared project', color: '#8B1E1E', status: 'ACTIVE', clientName: null }] });
    if (u.endsWith('/conversations') && method === 'GET') return json({ data: inbox });
    if (u.endsWith('/users/directory')) return json({ data: directory });
    if (u.includes('/conversations/d1/messages') && method === 'GET') return json({ data: [message()], authors: [{ id: 'sara', name: 'Sara Said', avatarUrl: null }] });
    if (u.includes('/conversations/d1/messages') && method === 'POST') {
      const b = body as { body: string; clientId?: string };
      return json({ data: message({ id: 'srv', userId: 'me', body: b.body, clientId: b.clientId ?? null, createdAt: new Date().toISOString() }) }, 201);
    }
    if (u.endsWith('/projects/p1/chat')) {
      return json({ data: { conversation: { id: 'c1', kind: 'PROJECT', projectId: 'p1', createdAt: '' }, messages: [message({ id: 'm9', conversationId: 'c1', userId: 'old', body: 'from before' })], authors: [{ id: 'old', name: 'Olga Old', avatarUrl: null }] } });
    }
    if (u.includes('/conversations/c1/messages') && method === 'GET') return json({ data: [message({ id: 'm9', conversationId: 'c1', userId: 'old', body: 'from before' })], authors: [{ id: 'old', name: 'Olga Old', avatarUrl: null }] });
    if (u.includes('/read') || u.includes('/delivered')) return new Response(null, { status: 204 });
    return json({ data: [] });
  }));
});
afterEach(() => {
  onlineManager.setOnline(true);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  useAuthStore.setState({ user: null, accessToken: null, refreshToken: null, isAuthenticated: false });
});

function renderChat(props: React.ComponentProps<typeof ChatPage> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ChatPage {...props} />
    </QueryClientProvider>,
  );
}

describe('Chat — companies', () => {
  it('the note shows at once after a refusal, before the inbox is read again', async () => {
    let refused = false;
    override = (u, method) => {
      if (refused && u.endsWith('/conversations') && method === 'GET') return new Promise<Response>(() => {}) as unknown as Response; // still on its way
      if (!(u.includes('/conversations/d1/messages') && method === 'POST')) return undefined;
      refused = true;
      return json({ error: { code: 'DM_READ_ONLY', message: SARA_NOTE } }, 403);
    };
    renderChat({ openConversationId: 'd1' });
    await userEvent.type(await screen.findByRole('textbox', { name: /Message/ }), 'hello{Enter}');
    expect(await screen.findByRole('note')).toHaveTextContent(SARA_NOTE);
    expect(screen.queryByRole('textbox', { name: /Message/ })).toBeNull();
  });


  it('a direct chat with no shared company is read-only, with the server’s words', async () => {
    inbox = [dm({ readOnly: { message: SARA_NOTE } })];
    renderChat({ openConversationId: 'd1' });
    expect(await screen.findByText('old hello')).toBeInTheDocument(); // still readable
    await waitFor(() => expect(screen.getAllByText(SARA_NOTE)).toHaveLength(2)); // header + where the box was
    expect(screen.queryByRole('textbox', { name: /Message/ })).toBeNull();
    expect(screen.getByRole('note')).toHaveTextContent(SARA_NOTE);
  });

  it('a direct chat that is writable has its box as before', async () => {
    renderChat({ openConversationId: 'd1' });
    expect(await screen.findByText('old hello')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: /Message/ })).toBeInTheDocument();
    expect(screen.queryByText(SARA_NOTE)).toBeNull();
  });

  it('starting a chat that comes back read-only shows it read-only at once', async () => {
    override = (u, method) => (u.endsWith('/conversations/direct') && method === 'POST' ? json({ data: { id: 'd1', kind: 'DIRECT', projectId: null, createdAt: '', readOnly: { message: SARA_NOTE } } }) : undefined);
    inbox = [];
    renderChat({ startDirectWith: 'sara' });
    expect(await screen.findByRole('note')).toHaveTextContent(SARA_NOTE);
    expect(screen.queryByRole('textbox', { name: /Message/ })).toBeNull();
  });

  it('the new-message picker lists only colleagues', async () => {
    directory = [
      { id: 'me', username: 'me', firstName: 'Mo', lastName: 'Me', colleague: true },
      { id: 'amy', username: 'amy', firstName: 'Amy', lastName: 'Alphaonly', colleague: true },
      { id: 'ben', username: 'ben', firstName: 'Ben', lastName: 'Betaonly', colleague: false },
      // An older server sends no flag: offered, as before.
      { id: 'cy', username: 'cy', firstName: 'Cy', lastName: 'Old' },
    ];
    renderChat();
    await userEvent.click(await screen.findByRole('button', { name: 'New direct message' }));
    await userEvent.click(screen.getByRole('button', { name: 'Start a direct message' }));
    const list = await screen.findByRole('listbox');
    expect(within(list).getAllByRole('option').map((o) => o.textContent)).toEqual([expect.stringContaining('Amy Alphaonly'), expect.stringContaining('Cy Old')]);
  });

  it('a name always shows: authors fill in people not in the directory', async () => {
    renderChat();
    await userEvent.click(await screen.findByText('Shared project'));
    expect(await screen.findByText('from before')).toBeInTheDocument();
    expect(screen.getAllByText('Olga Old').length).toBeGreaterThan(0);
  });

  it('a send refused because the chat became read-only shows the reason and keeps the text', async () => {
    override = (u, method) => {
      if (!(u.includes('/conversations/d1/messages') && method === 'POST')) return undefined;
      // Meanwhile Sara left my company: the server refuses, and its inbox now says so too.
      inbox = [dm({ readOnly: { message: SARA_NOTE } })];
      return json({ error: { code: 'DM_READ_ONLY', message: SARA_NOTE } }, 403);
    };
    renderChat({ openConversationId: 'd1' });
    const box = await screen.findByRole('textbox', { name: /Message/ });
    await userEvent.type(box, 'hello{Enter}');
    expect((await screen.findAllByText(SARA_NOTE)).length).toBeGreaterThan(0);
    // What was written stays on screen (not sent), and the box gives way to the note.
    expect(screen.getByText('hello')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('textbox', { name: /Message/ })).toBeNull());
    expect(screen.getByRole('note')).toHaveTextContent(SARA_NOTE);
  });
});
