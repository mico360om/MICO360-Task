import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChatPage, CHAT_PAGE_SIZE } from './ChatPage';
import { useAuthStore } from '../stores/auth-store';

// The realtime hooks open socket.io connections — stub them and capture the event handlers.
type Handler = (...a: unknown[]) => void;
const handlers: Record<string, Handler> = {};
vi.mock('socket.io-client', () => ({
  io: () => ({ on: (ev: string, cb: Handler) => { handlers[ev] = cb; }, emit: () => {}, connect: () => {}, disconnect: () => {} }),
}));

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
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
let requests: { url: string; method: string; body?: unknown }[] = [];
/** Per-test overrides: return a Response to handle the request, or undefined to fall through. */
let override: (u: string, method: string, body: unknown) => Response | undefined;
let c1Messages: ReturnType<typeof message>[];
let inbox: unknown[];

beforeEach(() => {
  for (const k of Object.keys(handlers)) delete handlers[k];
  posted = [];
  requests = [];
  override = () => undefined;
  c1Messages = [message()];
  inbox = [];
  useAuthStore.getState().setSession({ user: { id: 'me', email: 'me@x', username: 'me', roles: ['EMPLOYEE'] }, accessToken: 'at', refreshToken: 'rt' });
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url);
    const method = init?.method ?? 'GET';
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body ?? null;
    requests.push({ url: u, method, body });
    if (method === 'POST') posted.push({ url: u, body });
    const o = override(u, method, body);
    if (o) return o;
    if (u.endsWith('/projects') && method === 'GET') return json({ data: [{ id: 'p1', code: 'MOB', name: 'Mobile App', color: '#8B1E1E', status: 'ACTIVE', clientName: null }] });
    if (u.endsWith('/conversations') && method === 'GET') return json({ data: inbox });
    if (u.endsWith('/users/directory')) return json({ data: [{ id: 'u1', username: 'ada', firstName: 'Ada', lastName: 'Lovelace' }] });
    if (u.endsWith('/projects/p1/chat')) return json({ data: { conversation: { id: 'c1', kind: 'PROJECT', projectId: 'p1', createdAt: '' }, messages: c1Messages } });
    if (u.includes('/conversations/c1/messages') && method === 'GET') return json({ data: c1Messages });
    if (u.includes('/conversations/c1/messages') && method === 'POST') return json({ data: message({ id: 'm2', userId: 'me', body: 'my reply' }) });
    if (u.includes('/read')) return new Response(null, { status: 204 });
    return json({ data: [] });
  }));
});
afterEach(() => {
  vi.restoreAllMocks();
  useAuthStore.setState({ user: null, accessToken: null, refreshToken: null, isAuthenticated: false });
});

async function openMobileChannel() {
  renderWithQuery(<ChatPage />);
  await waitFor(() => expect(screen.getByText('Mobile App')).toBeInTheDocument());
  await userEvent.click(screen.getByText('Mobile App'));
  await waitFor(() => expect(screen.getByText('hello channel')).toBeInTheDocument());
}

describe('ChatPage', () => {
  it('lists project channels and opens one to show its messages', async () => {
    await openMobileChannel();
    // author name resolved from the directory
    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument();
  });

  it('sends a message to the open channel', async () => {
    await openMobileChannel();
    const box = screen.getByPlaceholderText(/message/i);
    await userEvent.type(box, 'my reply');
    await userEvent.click(screen.getByRole('button', { name: /^send$/i }));

    await waitFor(() => expect(posted.some((p) => p.url.includes('/conversations/c1/messages'))).toBe(true));
    const sent = posted.find((p) => p.url.includes('/conversations/c1/messages'));
    expect((sent?.body as { body: string }).body).toBe('my reply');
  });

  it('shows a clear message when a channel can’t be opened (CHAT-03)', async () => {
    override = (u) => (u.endsWith('/projects/p1/chat') ? json({ error: { code: 'FORBIDDEN', message: 'You are not a member of this project.' } }, 403) : undefined);
    renderWithQuery(<ChatPage />);
    await waitFor(() => expect(screen.getByText('Mobile App')).toBeInTheDocument());
    await userEvent.click(screen.getByText('Mobile App'));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/aren’t a member of this project/i));
  });

  it('loads older history with ?before= the oldest loaded message (CHAT-02)', async () => {
    const base = Date.parse('2026-09-20T08:00:00Z');
    const newestPage = Array.from({ length: CHAT_PAGE_SIZE }, (_, i) =>
      message({ id: `n${i}`, body: `recent ${i}`, createdAt: new Date(base + (100 + i) * 60_000).toISOString() }),
    );
    const olderPage = [message({ id: 'old1', body: 'the very first message', createdAt: new Date(base).toISOString() })];
    override = (u, method) => {
      if (!u.includes('/conversations/c1/messages') || method !== 'GET') return undefined;
      return json({ data: u.includes('before=') ? olderPage : newestPage });
    };
    renderWithQuery(<ChatPage />);
    await waitFor(() => expect(screen.getByText('Mobile App')).toBeInTheDocument());
    await userEvent.click(screen.getByText('Mobile App'));
    await waitFor(() => expect(screen.getByText('recent 0')).toBeInTheDocument());
    expect(screen.queryByText('the very first message')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /load older messages/i }));
    await waitFor(() => expect(screen.getByText('the very first message')).toBeInTheDocument());
    const olderReq = requests.find((r) => r.url.includes('before='));
    expect(decodeURIComponent(olderReq!.url)).toContain(`before=${newestPage[0]!.createdAt}`);
    // A short page means we reached the start: no more "load older".
    await waitFor(() => expect(screen.queryByRole('button', { name: /load older messages/i })).not.toBeInTheDocument());
  });

  it('does not yank a reader who scrolled up; shows a “new messages” button instead (CHAT-02)', async () => {
    await openMobileChannel();
    const thread = screen.getByText('hello channel').closest('.overflow-y-auto') as HTMLElement;
    Object.defineProperty(thread, 'scrollHeight', { value: 2000, configurable: true });
    Object.defineProperty(thread, 'clientHeight', { value: 500, configurable: true });
    Object.defineProperty(thread, 'scrollTop', { value: 200, writable: true, configurable: true });
    fireEvent.scroll(thread);

    c1Messages = [message(), message({ id: 'm9', body: 'a fresh message', createdAt: new Date(Date.now() + 1000).toISOString() })];
    await act(async () => { handlers['chat:message']?.({ conversationId: 'c1' }); });
    await waitFor(() => expect(screen.getByText('a fresh message')).toBeInTheDocument());
    expect(thread.scrollTop).toBe(200); // not moved
    const jump = await screen.findByRole('button', { name: /1 new message/i });
    await userEvent.click(jump);
    expect(thread.scrollTop).toBe(2000);
    expect(screen.queryByRole('button', { name: /new message/i })).not.toBeInTheDocument();
  });

  it('keeps the editor open and explains when an edit fails (WEB-14)', async () => {
    c1Messages = [message({ id: 'mine1', userId: 'me', body: 'my first draft' })];
    override = (u, method) => (u.endsWith('/messages/mine1') && method === 'PATCH' ? json({ error: { code: 'VALIDATION', message: 'Too long.' } }, 400) : undefined);
    renderWithQuery(<ChatPage />);
    await waitFor(() => expect(screen.getByText('Mobile App')).toBeInTheDocument());
    await userEvent.click(screen.getByText('Mobile App'));
    await waitFor(() => expect(screen.getByText('my first draft')).toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: /^edit$/i }));
    const editor = screen.getByLabelText(/edit message/i);
    await userEvent.type(editor, ' v2');
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/wasn’t saved/i));
    expect(screen.getByLabelText(/edit message/i)).toHaveValue('my first draft v2');
  });

  it('shows a counter and blocks sending past 4,000 characters (WEB-14)', async () => {
    await openMobileChannel();
    const box = screen.getByPlaceholderText(/message/i);
    fireEvent.change(box, { target: { value: 'x'.repeat(4001) } });
    expect(screen.getByText(/4,001 \/ 4,000/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^send$/i })).toBeDisabled();
  });

  it('explains when a file is too large instead of doing nothing (WEB-14)', async () => {
    await openMobileChannel();
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const big = new File(['x'], 'report.docx', { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
    Object.defineProperty(big, 'size', { value: 11 * 1024 * 1024 });
    fireEvent.change(input, { target: { files: [big] } });
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/report\.docx.*10 MB/i));
    expect(posted.some((p) => p.url.includes('/attachments'))).toBe(false);
  });

  it('reports a failed upload from the server', async () => {
    await openMobileChannel();
    override = (u) => (u.includes('/attachments') ? json({ error: { code: 'VALIDATION', message: 'File type text/x-sh is not allowed.' } }, 400) : undefined);
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(['x'], 'run.sh', { type: 'text/x-sh' })] } });
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/not allowed/i));
  });

  it('hides the unread badge on the open conversation and marks new arrivals read (WEB-13)', async () => {
    inbox = [{ conversation: { id: 'c9', kind: 'DIRECT', projectId: null, createdAt: '' }, participants: [{ conversationId: 'c9', userId: 'me', lastReadAt: null, addedAt: '' }, { conversationId: 'c9', userId: 'u1', lastReadAt: null, addedAt: '' }], unread: 3, lastMessage: null }];
    override = (u, method) => (u.includes('/conversations/c9/messages') && method === 'GET' ? json({ data: [message({ id: 'd1', conversationId: 'c9', body: 'hi there' })] }) : undefined);
    renderWithQuery(<ChatPage />);
    const dm = await screen.findByRole('button', { name: /ada lovelace/i });
    expect(dm).toHaveTextContent('3');
    await userEvent.click(dm);
    await waitFor(() => expect(screen.getByText('hi there')).toBeInTheDocument());
    // The open conversation never shows a badge, even while the inbox still says "3 unread".
    expect(screen.getByRole('button', { name: /ada lovelace/i })).not.toHaveTextContent('3');

    // A new message arrives while the DM is open → it's marked read again (debounced).
    const readsBefore = posted.filter((p) => p.url.endsWith('/conversations/c9/read')).length;
    inbox = [{ ...(inbox[0] as object), unread: 1 }];
    await act(async () => { handlers['chat:message']?.({ conversationId: 'c9' }); });
    await waitFor(() => expect(posted.filter((p) => p.url.endsWith('/conversations/c9/read')).length).toBeGreaterThan(readsBefore), { timeout: 3000 });
  });

  it('shows an error, not an empty thread, when messages fail to load (WEB-19)', async () => {
    override = (u, method) => (u.includes('/conversations/c1/messages') && method === 'GET' ? json({ error: { code: 'ERR', message: 'boom' } }, 500) : undefined);
    renderWithQuery(<ChatPage />);
    await waitFor(() => expect(screen.getByText('Mobile App')).toBeInTheDocument());
    await userEvent.click(screen.getByText('Mobile App'));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/couldn’t load messages/i));
    expect(screen.queryByText(/no messages yet/i)).not.toBeInTheDocument();
  });

  it('lays out Arabic text right-to-left automatically (ARB-02)', async () => {
    c1Messages = [message({ body: 'مرحبا بالفريق' })];
    renderWithQuery(<ChatPage />);
    await waitFor(() => expect(screen.getByText('Mobile App')).toBeInTheDocument());
    await userEvent.click(screen.getByText('Mobile App'));
    const body = await screen.findByText('مرحبا بالفريق');
    expect(body.closest('[dir="auto"]')).not.toBeNull();
    expect(screen.getByPlaceholderText(/message/i)).toHaveAttribute('dir', 'auto');
  });
});
