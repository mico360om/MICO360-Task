import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query';
import { render, screen, waitFor, fireEvent, act, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChatPage, CHAT_PAGE_SIZE } from './ChatPage';
import { useAuthStore } from '../stores/auth-store';
import { isChatMuted } from '../lib/notificationSound';
import { viewingConversation } from '../lib/chat-sound';

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
  return { qc, ...render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>) };
}

const message = (over: Partial<Record<string, unknown>> = {}) => ({
  id: 'm1', conversationId: 'c1', userId: 'u1', body: 'hello channel',
  editedAt: null, deletedAt: null, createdAt: new Date().toISOString(), reactions: [], attachments: [], replyTo: null, clientId: null, ...over,
});

const dmSummary = (over: Partial<Record<string, unknown>> = {}) => ({
  conversation: { id: 'd1', kind: 'DIRECT', projectId: null, createdAt: '' },
  participants: [
    { conversationId: 'd1', userId: 'me', lastReadAt: null, lastDeliveredAt: null, addedAt: '' },
    { conversationId: 'd1', userId: 'u1', lastReadAt: null, lastDeliveredAt: null, addedAt: '' },
  ],
  unread: 0,
  lastMessage: null,
  prefs: { favorite: false, archived: false, muted: false },
  ...over,
});

let posted: { url: string; body: unknown }[] = [];
let requests: { url: string; method: string; body?: unknown }[] = [];
/** Per-test overrides: return a Response (or a promise of one) to handle the request, or undefined to fall through. */
let override: (u: string, method: string, body: unknown) => Response | Promise<Response> | undefined;
let c1Messages: ReturnType<typeof message>[];
let inbox: unknown[];

/** Uploads report progress over XMLHttpRequest; this one hands the request to the fetch mock. */
class FakeXHR {
  status = 0;
  responseText = '';
  upload: { onprogress: ((e: { lengthComputable: boolean; loaded: number; total: number }) => void) | null } = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  private url = '';
  private method = 'POST';
  open(method: string, url: string) { this.method = method; this.url = url; }
  setRequestHeader() {}
  send(body: FormData) {
    queueMicrotask(async () => {
      this.upload.onprogress?.({ lengthComputable: true, loaded: 1, total: 2 });
      try {
        const res = await fetch(this.url, { method: this.method, body });
        this.status = res.status;
        this.responseText = await res.text();
        this.onload?.();
      } catch {
        this.onerror?.();
      }
    });
  }
}

beforeEach(() => {
  for (const k of Object.keys(handlers)) delete handlers[k];
  localStorage.clear();
  posted = [];
  requests = [];
  override = () => undefined;
  c1Messages = [message()];
  inbox = [];
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
  useAuthStore.getState().setSession({ user: { id: 'me', email: 'me@x', username: 'me', roles: ['EMPLOYEE'] }, accessToken: 'at', refreshToken: 'rt' });
  vi.stubGlobal('XMLHttpRequest', FakeXHR);
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
    if (u.endsWith('/users/directory')) return json({ data: [{ id: 'u1', username: 'ada', firstName: 'Ada', lastName: 'Lovelace' }, { id: 'me', username: 'me', firstName: 'Mo', lastName: 'Me' }] });
    if (u.endsWith('/projects/p1/chat')) return json({ data: { conversation: { id: 'c1', kind: 'PROJECT', projectId: 'p1', createdAt: '' }, messages: c1Messages } });
    if (u.includes('/conversations/c1/messages') && method === 'GET') return json({ data: c1Messages });
    if (u.includes('/conversations/c1/messages') && method === 'POST') {
      const b = body as { body: string; clientId?: string; replyToId?: string };
      return json({ data: message({ id: `srv-${posted.length}`, userId: 'me', body: b.body, clientId: b.clientId ?? null, createdAt: new Date().toISOString() }) }, 201);
    }
    if (u.includes('/read') || u.includes('/delivered')) return new Response(null, { status: 204 });
    if (u.includes('/prefs') && method === 'PUT') return json({ data: { favorite: false, archived: false, muted: false, ...(body as object) } });
    return json({ data: [] });
  }));
});
afterEach(() => {
  // A test that went offline must not leave every later query paused.
  onlineManager.setOnline(true);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  useAuthStore.setState({ user: null, accessToken: null, refreshToken: null, isAuthenticated: false });
});

async function openMobileChannel() {
  const view = renderWithQuery(<ChatPage />);
  await waitFor(() => expect(screen.getByText('Mobile App')).toBeInTheDocument());
  await userEvent.click(screen.getByText('Mobile App'));
  await waitFor(() => expect(screen.getByText('hello channel')).toBeInTheDocument());
  return view;
}

/** Open the Mobile App channel and wait until the given text is on screen (exact, or part of a message). */
async function openChannelWith(text: string, exact = true) {
  const view = renderWithQuery(<ChatPage />);
  await userEvent.click(await screen.findByText('Mobile App'));
  await waitFor(() => expect(screen.getByText(text, { exact })).toBeInTheDocument());
  return view;
}

/** The message's own row (bubble, toolbar, reactions, files). */
const rowOf = (text: string) => screen.getByText(text).closest('[data-message-id]') as HTMLElement;

async function messageAction(text: string, action: RegExp) {
  await userEvent.click(within(rowOf(text)).getByRole('button', { name: 'More actions' }));
  await userEvent.click(await screen.findByRole('menuitem', { name: action }));
}

const sends = () => posted.filter((p) => /\/conversations\/\w+\/messages$/.test(p.url));

describe('ChatPage', () => {
  it('lists project channels and opens one to show its messages', async () => {
    await openMobileChannel();
    // author name resolved from the directory
    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument();
    // The channel shows the project's picture (its initials here: it has no icon or image), in the list and the header.
    const tiles = [...document.querySelectorAll('[data-project-avatar="initials"]')].filter((t) => t.textContent === 'MA');
    expect(tiles.length).toBeGreaterThanOrEqual(2);
  });

  it('tells assistive tech whether the new-message picker is open', async () => {
    renderWithQuery(<ChatPage />);
    const toggle = await screen.findByRole('button', { name: 'New direct message' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: 'Start a direct message' })).toBeInTheDocument();
  });

  it('opens a direct conversation with the person it is asked for (search result → chat)', async () => {
    override = (u, method) => (u.endsWith('/conversations/direct') && method === 'POST' ? json({ data: { id: 'd1', kind: 'DIRECT', projectId: null, createdAt: '' } }) : undefined);
    const opened = vi.fn();
    renderWithQuery(<ChatPage startDirectWith="u1" onOpened={opened} />);
    await waitFor(() => expect(posted).toContainEqual({ url: expect.stringContaining('/conversations/direct'), body: { userId: 'u1' } }));
    // The conversation opens under the person's name (so the directory was loaded first).
    expect(await screen.findByRole('heading', { name: /ada lovelace/i })).toBeInTheDocument();
    await waitFor(() => expect(opened).toHaveBeenCalledTimes(1));
    expect(posted.filter((p) => p.url.endsWith('/conversations/direct'))).toHaveLength(1);
  });

  it('opens the conversation a notification points at, and marks it read', async () => {
    inbox = [dmSummary({ unread: 2 })];
    const opened = vi.fn();
    renderWithQuery(<ChatPage openConversationId="d1" onOpened={opened} />);
    expect(await screen.findByRole('heading', { name: /ada lovelace/i })).toBeInTheDocument();
    await waitFor(() => expect(posted.some((p) => p.url.endsWith('/conversations/d1/read'))).toBe(true));
    await waitFor(() => expect(opened).toHaveBeenCalledTimes(1));
  });

  it('opens the same conversation again when a second notification about it is clicked', async () => {
    inbox = [dmSummary({ unread: 2 })];
    const opened = vi.fn();
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const page = (id: string | null) => <QueryClientProvider client={qc}><ChatPage openConversationId={id} onOpened={opened} /></QueryClientProvider>;
    const view = render(page('d1'));
    await waitFor(() => expect(opened).toHaveBeenCalledTimes(1));
    // The route tidies the address back to /chat, then a later notification asks for d1 again.
    view.rerender(page(null));
    view.rerender(page('d1'));
    await waitFor(() => expect(opened).toHaveBeenCalledTimes(2));
    expect(posted.filter((p) => p.url.endsWith('/conversations/d1/read'))).toHaveLength(2);
  });

  it('fetches the inbox again for a conversation it does not know yet (a first message from someone new)', async () => {
    let inboxCalls = 0;
    override = (u, method) => (u.endsWith('/conversations') && method === 'GET' ? json({ data: ++inboxCalls === 1 ? [] : [dmSummary({ unread: 1 })] }) : undefined);
    const opened = vi.fn();
    renderWithQuery(<ChatPage openConversationId="d1" onOpened={opened} />);
    expect(await screen.findByRole('heading', { name: /ada lovelace/i })).toBeInTheDocument();
    await waitFor(() => expect(opened).toHaveBeenCalledTimes(1));
    expect(inboxCalls).toBeGreaterThanOrEqual(2);
  });

  it('says so when a conversation from a notification cannot be found at all', async () => {
    renderWithQuery(<ChatPage openConversationId="gone" onOpened={vi.fn()} />);
    expect(await screen.findByText('This conversation couldn’t be opened')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(/couldn’t be found/i);
  });

  it('opens a project channel from a notification about it (a mention)', async () => {
    inbox = [{ conversation: { id: 'c1', kind: 'PROJECT', projectId: 'p1', createdAt: '' }, participants: [], unread: 1, lastMessage: null }];
    renderWithQuery(<ChatPage openConversationId="c1" />);
    expect(await screen.findByText('hello channel')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Mobile App' })).toBeInTheDocument();
  });

  it('sends a message to the open channel, with an id that lets the server recognise a retry', async () => {
    await openMobileChannel();
    const box = screen.getByPlaceholderText(/message/i);
    await userEvent.type(box, 'my reply');
    await userEvent.click(screen.getByRole('button', { name: /^send$/i }));

    await waitFor(() => expect(sends()).toHaveLength(1));
    const sent = sends()[0]!.body as { body: string; clientId: string };
    expect(sent.body).toBe('my reply');
    expect(sent.clientId).toMatch(/^[\w-]{8,64}$/);
    // Shown once: the confirmed copy replaces the one on its way.
    await waitFor(() => expect(screen.getAllByText('my reply')).toHaveLength(1));
    expect(box).toHaveValue('');
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
    await openChannelWith('my first draft');

    await messageAction('my first draft', /^edit$/i);
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

  it('refuses a file type the server won’t take, before uploading it', async () => {
    await openMobileChannel();
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(['x'], 'run.sh', { type: 'text/x-sh' })] } });
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/run\.sh.*can’t be sent/i));
    expect(posted.some((p) => p.url.includes('/attachments'))).toBe(false);
  });

  it('reports a failed upload from the server and offers to try it again', async () => {
    await openMobileChannel();
    let attempts = 0;
    override = (u) => (u.includes('/attachments') ? (++attempts === 1 ? json({ error: { code: 'VALIDATION', message: 'File type text/plain is not allowed.' } }, 400) : json({ data: message({ id: 'f1', userId: 'me', body: '', attachments: [{ id: 'a1', messageId: 'f1', fileName: 'notes.txt', mimeType: 'text/plain', sizeBytes: 1, storageKey: 'k', createdAt: '', url: '/uploads/k' }] }) }, 201)) : undefined);
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(['x'], 'notes.txt', { type: 'text/plain' })] } });
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/not allowed/i));
    expect(screen.getByText(/not sent/i)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(attempts).toBe(2));
    const [first, second] = posted.filter((p) => p.url.includes('/attachments')).map((p) => (p.body as FormData).get('clientId'));
    expect(second).toBe(first); // the same message, sent again — never a second copy
    await waitFor(() => expect(screen.queryByText(/not sent/i)).not.toBeInTheDocument());
  });

  it('shows upload progress and a preview while a picture is on its way', async () => {
    await openMobileChannel();
    let finish: (r: Response) => void = () => {};
    let sentId: unknown = null;
    override = (u, _method, body) => {
      if (!u.includes('/attachments')) return undefined;
      sentId = (body as FormData).get('clientId');
      return new Promise<Response>((resolve) => { finish = resolve; });
    };
    const url = vi.fn(() => 'blob:preview');
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: url, revokeObjectURL: vi.fn() }));
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(['img'], 'site.png', { type: 'image/png' })] } });
    const bar = await screen.findByRole('progressbar', { name: /uploading site\.png/i });
    await waitFor(() => expect(bar).toHaveAttribute('aria-valuenow', '50'));
    expect(screen.getByRole('img', { name: 'site.png' })).toHaveAttribute('src', 'blob:preview');
    await act(async () => { finish(json({ data: message({ id: 'f2', userId: 'me', body: '', clientId: sentId, attachments: [{ id: 'a2', messageId: 'f2', fileName: 'site.png', mimeType: 'image/png', sizeBytes: 3, storageKey: 'k2', createdAt: '', url: '/uploads/k2' }] }) }, 201)); });
    await waitFor(() => expect(screen.queryByRole('progressbar')).not.toBeInTheDocument());
  });

  it('hides the unread badge on the open conversation and marks new arrivals read (WEB-13)', async () => {
    inbox = [dmSummary({ conversation: { id: 'c9', kind: 'DIRECT', projectId: null, createdAt: '' }, participants: [{ conversationId: 'c9', userId: 'me', lastReadAt: null, addedAt: '' }, { conversationId: 'c9', userId: 'u1', lastReadAt: null, addedAt: '' }], unread: 3 })];
    override = (u, method) => (u.includes('/conversations/c9/messages') && method === 'GET' ? json({ data: [message({ id: 'd1', conversationId: 'c9', body: 'hi there' })] }) : undefined);
    renderWithQuery(<ChatPage />);
    const dm = await screen.findByRole('button', { name: /^ada lovelace/i });
    expect(dm).toHaveTextContent('3');
    await userEvent.click(dm);
    await waitFor(() => expect(screen.getByText('hi there')).toBeInTheDocument());
    // The open conversation never shows a badge, even while the inbox still says "3 unread".
    expect(screen.getByRole('button', { name: /^ada lovelace/i })).not.toHaveTextContent('3');
    expect(screen.getByRole('button', { name: /^ada lovelace/i })).toHaveAttribute('aria-current', 'true');

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
    await openChannelWith('مرحبا بالفريق');
    const body = screen.getByText('مرحبا بالفريق');
    expect(body.closest('[dir="auto"]')).not.toBeNull();
    expect(screen.getByPlaceholderText(/message/i)).toHaveAttribute('dir', 'auto');
  });

  it('keeps a mixed Arabic/English name in one piece inside the message box’s hint', async () => {
    override = (u, method) => (u.endsWith('/projects') && method === 'GET' ? json({ data: [{ id: 'p1', code: 'MOB', name: 'مشروع الإطلاق 817ab4', color: '#8B1E1E', status: 'ACTIVE', clientName: null }] }) : undefined);
    renderWithQuery(<ChatPage />);
    await userEvent.click(await screen.findByText('مشروع الإطلاق 817ab4'));
    await screen.findByText('hello channel');
    // First-strong isolate … pop isolate: the name keeps its own direction next to "Message #".
    expect(screen.getByLabelText('Message')).toHaveAttribute('placeholder', 'Message #⁨مشروع الإطلاق 817ab4⁩');
  });

  it('on a touch screen, shows the actions of the one message tapped', async () => {
    c1Messages = [message({ id: 'a1', body: 'first one' }), message({ id: 'a2', body: 'second one' })];
    await openChannelWith('second one');
    await userEvent.click(screen.getByText('first one'));
    expect(rowOf('first one')).toHaveAttribute('data-revealed');
    await userEvent.click(screen.getByText('second one'));
    expect(rowOf('second one')).toHaveAttribute('data-revealed');
    expect(rowOf('first one')).not.toHaveAttribute('data-revealed');
    await userEvent.click(screen.getByText('second one'));
    expect(rowOf('second one')).not.toHaveAttribute('data-revealed');
  });

  it('tells the sound notifier which conversation is open, and forgets it on leaving', async () => {
    const view = await openMobileChannel();
    expect(viewingConversation()).toBe('c1');
    view.unmount();
    expect(viewingConversation()).toBeNull();
  });
});

describe('ChatPage sidebar', () => {
  it('filters conversations by name as you type', async () => {
    inbox = [dmSummary()];
    renderWithQuery(<ChatPage />);
    await screen.findByRole('button', { name: /^ada lovelace/i });
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search conversations' }), 'ada');
    expect(screen.queryByText('Mobile App')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^ada lovelace/i })).toBeInTheDocument();
  });

  it('searches message text in all conversations and opens the one a result is in', async () => {
    inbox = [{ conversation: { id: 'c1', kind: 'PROJECT', projectId: 'p1', createdAt: '' }, participants: [], unread: 0, lastMessage: null }];
    override = (u) => (u.includes('/chat/search') ? json({ data: [message({ id: 'm1', body: 'hello channel' })] }) : undefined);
    renderWithQuery(<ChatPage />);
    await screen.findByText('Mobile App');
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search conversations' }), 'hello');
    await userEvent.click(screen.getByRole('button', { name: /search messages for “hello”/i }));
    const results = await screen.findByRole('list', { name: 'Message results' });
    expect(requests.some((r) => r.url.includes('/chat/search?q=hello'))).toBe(true);
    const hit = within(results).getByRole('button', { name: /mobile app/i });
    expect(hit).toHaveTextContent('hello');
    await userEvent.click(hit);
    expect(await screen.findByRole('heading', { name: 'Mobile App' })).toBeInTheDocument();
    await waitFor(() => expect(document.querySelector('[data-message-id="m1"]')).toHaveAttribute('data-highlighted', 'true'));
  });

  it('collapses a section and remembers it', async () => {
    const first = renderWithQuery(<ChatPage />);
    const header = await screen.findByRole('button', { name: /^project channels/i });
    expect(header).toHaveAttribute('aria-expanded', 'true');
    await userEvent.click(header);
    expect(header).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Mobile App')).not.toBeInTheDocument();
    first.unmount();
    renderWithQuery(<ChatPage />);
    expect(await screen.findByRole('button', { name: /^project channels/i })).toHaveAttribute('aria-expanded', 'false');
  });

  it('adds a conversation to favorites, which lists it first', async () => {
    inbox = [dmSummary()];
    renderWithQuery(<ChatPage />);
    await screen.findByRole('button', { name: /^ada lovelace/i });
    expect(screen.queryByRole('button', { name: /^favorites/i })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'More options for Ada Lovelace' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Add to favorites' }));
    await waitFor(() => expect(requests).toContainEqual(expect.objectContaining({ url: expect.stringContaining('/conversations/d1/prefs'), method: 'PUT', body: { favorite: true } })));
    const favorites = await screen.findByRole('button', { name: /^favorites/i });
    expect(within(favorites.closest('[data-section]') as HTMLElement).getByRole('button', { name: /^ada lovelace/i })).toBeInTheDocument();
  });

  it('archives a conversation out of the way, and still counts its unread messages', async () => {
    inbox = [dmSummary({ unread: 2 })];
    renderWithQuery(<ChatPage />);
    await screen.findByRole('button', { name: /^ada lovelace/i });
    await userEvent.click(screen.getByRole('button', { name: 'More options for Ada Lovelace' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Archive' }));
    await waitFor(() => expect(requests).toContainEqual(expect.objectContaining({ method: 'PUT', body: { archived: true } })));
    const archived = await screen.findByRole('button', { name: /^archived/i });
    expect(archived).toHaveAttribute('aria-expanded', 'false');
    expect(archived).toHaveTextContent('2');
    expect(screen.queryByRole('button', { name: /^ada lovelace/i })).not.toBeInTheDocument();
    await userEvent.click(archived);
    expect(screen.getByRole('button', { name: /^ada lovelace/i })).toBeInTheDocument();
  });

  it('keeps long names on one line, with the full name on hover', async () => {
    const long = 'Ada Augusta King, Countess of Lovelace and First Programmer of the Analytical Engine';
    inbox = [dmSummary()];
    override = (u) => (u.endsWith('/users/directory') ? json({ data: [{ id: 'u1', username: 'ada', firstName: long, lastName: '' }] }) : undefined);
    renderWithQuery(<ChatPage />);
    const title = await screen.findByText(long);
    expect(title).toHaveClass('truncate');
    expect(title).toHaveAttribute('title', long);
  });

  it('turns the notification sound off and on, and remembers it', async () => {
    renderWithQuery(<ChatPage />);
    const sound = await screen.findByRole('button', { name: 'Notification sound' });
    expect(sound).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(sound);
    expect(sound).toHaveAttribute('aria-pressed', 'false');
    expect(isChatMuted()).toBe(true);
    await userEvent.click(sound);
    expect(isChatMuted()).toBe(false);
  });
});

describe('ChatPage conversation header', () => {
  it('mutes notifications for just this conversation', async () => {
    await openMobileChannel();
    const mute = screen.getByRole('button', { name: 'Mute notifications' });
    expect(mute).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(mute);
    await waitFor(() => expect(requests).toContainEqual(expect.objectContaining({ url: expect.stringContaining('/conversations/c1/prefs'), method: 'PUT', body: { muted: true } })));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Mute notifications' })).toHaveAttribute('aria-pressed', 'true'));
  });

  it('lists the members with their presence and a way to message them', async () => {
    override = (u) => (u.endsWith('/conversations/c1/members') ? json({ data: ['me', 'u1'] }) : undefined);
    await openMobileChannel();
    await waitFor(() => expect(screen.getByText(/2 members/)).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: 'Members' }));
    const panel = await screen.findByRole('complementary', { name: 'Members' });
    expect(within(panel).getByText('Ada Lovelace')).toBeInTheDocument();
    expect(within(panel).getByRole('button', { name: 'Message Ada Lovelace' })).toBeInTheDocument();
  });

  it('shows a direct conversation’s presence', async () => {
    inbox = [dmSummary()];
    override = (u) => (u.endsWith('/users/directory') ? json({ data: [{ id: 'u1', username: 'ada', firstName: 'Ada', lastName: 'Lovelace', lastActiveAt: new Date(Date.now() - 5 * 60_000).toISOString() }] }) : undefined);
    renderWithQuery(<ChatPage openConversationId="d1" />);
    expect(await screen.findByRole('heading', { name: 'Ada Lovelace' })).toBeInTheDocument();
    expect(screen.getByText('Last active 5m ago')).toBeInTheDocument();
  });

  it('searches inside the conversation and jumps to a result', async () => {
    c1Messages = [message({ id: 'm1', body: 'hello channel' }), message({ id: 'm2', body: 'the budget is ready' })];
    override = (u) => (u.includes('/chat/search') ? json({ data: [message({ id: 'm2', body: 'the budget is ready' })] }) : undefined);
    await openMobileChannel();
    await userEvent.click(screen.getByRole('button', { name: 'Search in conversation' }));
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search this conversation' }), 'budget');
    const results = await screen.findByRole('list', { name: 'Message results' });
    await waitFor(() => expect(requests.some((r) => r.url.includes('/chat/search?q=budget&conversationId=c1'))).toBe(true));
    await userEvent.click(within(results).getByRole('button', { name: /budget/i }));
    await waitFor(() => expect(document.querySelector('[data-message-id="m2"]')).toHaveAttribute('data-highlighted', 'true'));
  });

  it('says when the connection is lost and when it is coming back', async () => {
    await openMobileChannel();
    act(() => { window.dispatchEvent(new Event('offline')); });
    expect(await screen.findByRole('status', { name: /connection/i })).toHaveTextContent(/offline/i);
    act(() => { window.dispatchEvent(new Event('online')); });
    await waitFor(() => expect(screen.getByRole('status', { name: /connection/i })).toHaveTextContent(/reconnecting/i));
  });
});

describe('ChatPage on a phone: the list and the conversation take turns', () => {
  it('shows only the conversation once one is opened, with a way back to the list', async () => {
    renderWithQuery(<ChatPage />);
    const list = (await screen.findByText('Mobile App')).closest('aside')!;
    // Nothing open yet: the list is what a phone shows; the empty thread waits for a wide screen.
    expect(list).not.toHaveClass('hidden');
    expect(screen.getByText('Select a conversation').closest('section')).toHaveClass('hidden', 'lg:flex');

    await userEvent.click(screen.getByText('Mobile App'));
    await screen.findByText('hello channel');
    expect(list).toHaveClass('hidden', 'lg:flex');
    expect(screen.getByText('hello channel').closest('section')).not.toHaveClass('hidden');

    await userEvent.click(screen.getByRole('button', { name: 'Back to conversations' }));
    expect(list).not.toHaveClass('hidden');
    expect(screen.getByText('Select a conversation')).toBeInTheDocument();
  });

  it('keeps a main heading for screen readers while the list is out of the way on a phone', async () => {
    await openMobileChannel();
    const headings = screen.getAllByRole('heading', { level: 1, name: 'Chat' });
    expect(headings.some((h) => h.classList.contains('sr-only') && h.classList.contains('lg:hidden'))).toBe(true);
  });

  it('keeps the message toolbar inside the conversation: above the bubble, on its inner side', async () => {
    c1Messages = [message({ id: 'mine1', userId: 'me', body: 'mine' }), message({ id: 'theirs1', userId: 'u1', body: 'theirs' })];
    await openChannelWith('mine');
    const mine = rowOf('mine').querySelector('[data-toolbar]')!;
    const theirs = rowOf('theirs').querySelector('[data-toolbar]')!;
    expect(mine).toHaveClass('bottom-full', 'end-0');
    expect(theirs).toHaveClass('bottom-full', 'start-0');
    expect(mine.className).not.toMatch(/sm:(right|left)-full/);
  });
});

describe('ChatPage messages', () => {
  it('lets a long word with no spaces break instead of running off the screen', async () => {
    const long = 'x'.repeat(480);
    c1Messages = [message({ id: 'long1', userId: 'me', body: long })];
    await openChannelWith(long);
    const bubble = screen.getByText(long).closest('[data-bubble]')!;
    expect(bubble).toHaveClass('max-w-full', '[overflow-wrap:anywhere]');
  });

  it('draws no empty bubble for a file sent without a caption, and offers its download', async () => {
    c1Messages = [message({ id: 'file1', userId: 'u1', body: '', attachments: [{ id: 'a1', fileName: 'plan.pdf', mimeType: 'application/pdf', sizeBytes: 1200, url: '/uploads/plan.pdf' }] })];
    await openChannelWith('plan.pdf');
    expect(document.querySelector('[data-bubble]')).toBeNull();
    expect(within(rowOf('plan.pdf')).getByRole('button', { name: 'Add reaction' })).toBeInTheDocument();
    const link = screen.getByRole('link', { name: /download plan\.pdf/i });
    expect(link).toHaveAttribute('download');
  });

  it('opens a picture full size, with a download link', async () => {
    c1Messages = [message({ id: 'img1', userId: 'u1', body: 'see this', attachments: [{ id: 'a1', fileName: 'site.png', mimeType: 'image/png', sizeBytes: 1200, url: '/uploads/site.png' }] })];
    await openChannelWith('see this');
    await userEvent.click(screen.getByRole('button', { name: 'Open site.png' }));
    const viewer = await screen.findByRole('dialog', { name: 'site.png' });
    expect(within(viewer).getByRole('link', { name: /download/i })).toHaveAttribute('href', expect.stringContaining('/uploads/site.png'));
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'site.png' })).not.toBeInTheDocument());
  });

  it('turns web addresses into links that open in a new tab, leaving the full stop of the sentence outside', async () => {
    c1Messages = [message({ id: 'l1', userId: 'u1', body: 'See https://example.com/docs/a_b?x=1. Thanks' })];
    await openChannelWith('Thanks', false);
    const link = screen.getByRole('link', { name: 'https://example.com/docs/a_b?x=1' });
    expect(link).toHaveAttribute('href', 'https://example.com/docs/a_b?x=1');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link.getAttribute('rel')).toMatch(/noopener/);
    expect(link.getAttribute('rel')).toMatch(/noreferrer/);
  });

  it('never makes a link out of anything but http(s) addresses', async () => {
    c1Messages = [message({ id: 'l2', userId: 'u1', body: 'try javascript:alert(1) or ftp://x.test/file' })];
    await openChannelWith('javascript:alert', false);
    expect(screen.queryByRole('link', { name: /javascript|ftp/ })).not.toBeInTheDocument();
  });

  it('asks before deleting a message', async () => {
    c1Messages = [message({ id: 'mine1', userId: 'me', body: 'oops' })];
    await openChannelWith('oops');
    await messageAction('oops', /^delete$/i);
    expect(screen.getByRole('alertdialog', { name: 'Delete this message?' })).toBeInTheDocument();
    expect(requests.some((r) => r.method === 'DELETE')).toBe(false);
    await userEvent.click(screen.getByRole('button', { name: 'Keep' }));
    expect(requests.some((r) => r.method === 'DELETE')).toBe(false);

    await messageAction('oops', /^delete$/i);
    await userEvent.click(screen.getByRole('button', { name: 'Yes, delete' }));
    await waitFor(() => expect(requests.some((r) => r.method === 'DELETE' && r.url.endsWith('/messages/mine1'))).toBe(true));
  });

  it('only offers to edit your own messages, and to delete others’ when you are an admin', async () => {
    c1Messages = [message({ id: 'theirs1', userId: 'u1', body: 'theirs' })];
    const first = await openChannelWith('theirs');
    await userEvent.click(within(rowOf('theirs')).getByRole('button', { name: 'More actions' }));
    expect(await screen.findByRole('menuitem', { name: /copy/i })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: /^edit$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: /^delete$/i })).not.toBeInTheDocument();
    first.unmount();

    useAuthStore.getState().setSession({ user: { id: 'me', email: 'me@x', username: 'me', roles: ['ADMIN'] }, accessToken: 'at', refreshToken: 'rt' });
    await openChannelWith('theirs');
    await userEvent.click(within(rowOf('theirs')).getByRole('button', { name: 'More actions' }));
    expect(await screen.findByRole('menuitem', { name: /^delete$/i })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: /^edit$/i })).not.toBeInTheDocument();
  });

  it('puts the cursor in the box when a message is edited, and marks it edited once saved', async () => {
    c1Messages = [message({ id: 'mine1', userId: 'me', body: 'my first draft' })];
    override = (u, method) => (u.endsWith('/messages/mine1') && method === 'PATCH' ? json({ data: message({ id: 'mine1', userId: 'me', body: 'my second draft', editedAt: new Date().toISOString() }) }) : undefined);
    await openChannelWith('my first draft');
    await messageAction('my first draft', /^edit$/i);
    const editor = screen.getByLabelText(/edit message/i);
    expect(editor).toHaveFocus();
    c1Messages = [message({ id: 'mine1', userId: 'me', body: 'my second draft', editedAt: new Date().toISOString() })];
    fireEvent.change(editor, { target: { value: 'my second draft' } });
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }));
    await waitFor(() => expect(screen.getByText('my second draft')).toBeInTheDocument());
    expect(within(rowOf('my second draft')).getByText('Edited')).toBeInTheDocument();
  });

  it('replies to a message, and shows what was answered', async () => {
    await openMobileChannel();
    await userEvent.click(within(rowOf('hello channel')).getByRole('button', { name: 'Reply' }));
    expect(screen.getByText(/replying to ada lovelace/i)).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Message'), 'sure{Enter}');
    await waitFor(() => expect(sends()).toHaveLength(1));
    expect(sends()[0]!.body).toMatchObject({ body: 'sure', replyToId: 'm1' });
    expect(screen.queryByText(/replying to/i)).not.toBeInTheDocument();
  });

  it('shows the quote of the message a reply answers', async () => {
    c1Messages = [message({ id: 'm1', body: 'hello channel' }), message({ id: 'm2', userId: 'me', body: 'hi back', replyTo: { id: 'm1', userId: 'u1', body: 'hello channel', deleted: false } })];
    await openChannelWith('hi back');
    const quote = within(rowOf('hi back')).getByRole('button', { name: /reply to ada lovelace/i });
    expect(quote).toHaveTextContent('hello channel');
  });

  it('copies a message’s text', async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    await openMobileChannel();
    await messageAction('hello channel', /copy/i);
    expect(writeText).toHaveBeenCalledWith('hello channel');
    expect(await screen.findByText('Copied')).toBeInTheDocument();
  });

  it('reacts with an emoji, and shows who reacted', async () => {
    await openMobileChannel();
    await userEvent.click(within(rowOf('hello channel')).getByRole('button', { name: 'Add reaction' }));
    await userEvent.click(await screen.findByRole('button', { name: 'React with 👍' }));
    await waitFor(() => expect(posted).toContainEqual({ url: expect.stringContaining('/messages/m1/reactions'), body: { emoji: '👍' } }));
  });

  it('marks your own reaction on its chip, and the chip takes it back', async () => {
    c1Messages = [message({ reactions: [{ emoji: '🎉', userIds: ['me', 'u1'] }] })];
    await openMobileChannel();
    const chip = screen.getByRole('button', { name: /🎉 2/ });
    expect(chip).toHaveAttribute('aria-pressed', 'true');
    expect(chip).toHaveAttribute('title', expect.stringContaining('Ada Lovelace'));
    await userEvent.click(chip);
    await waitFor(() => expect(requests.some((r) => r.method === 'DELETE' && r.url.includes('/messages/m1/reactions/'))).toBe(true));
  });

  it('marks where the unread messages start', async () => {
    const t = Date.now();
    c1Messages = [message({ id: 'old', body: 'read already', createdAt: new Date(t - 60_000).toISOString() }), message({ id: 'new', body: 'not read yet', createdAt: new Date(t).toISOString() })];
    inbox = [{ conversation: { id: 'c1', kind: 'PROJECT', projectId: 'p1', createdAt: '' }, participants: [{ conversationId: 'c1', userId: 'me', lastReadAt: new Date(t - 30_000).toISOString(), addedAt: '' }], unread: 1, lastMessage: null }];
    await openChannelWith('not read yet');
    const line = screen.getByRole('separator', { name: 'Unread messages' });
    expect(line.compareDocumentPosition(screen.getByText('not read yet')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(line.compareDocumentPosition(screen.getByText('read already')) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
  });

  it('shows sent, delivered and read on your direct messages, and how many have seen it in a channel', async () => {
    const t = Date.parse('2026-10-10T08:00:00Z');
    const at = (s: number) => new Date(t + s * 1000).toISOString();
    inbox = [dmSummary({ participants: [
      { conversationId: 'd1', userId: 'me', lastReadAt: at(100), lastDeliveredAt: at(100), addedAt: '' },
      { conversationId: 'd1', userId: 'u1', lastReadAt: at(10), lastDeliveredAt: at(20), addedAt: '' },
    ] })];
    override = (u, method) => (u.includes('/conversations/d1/messages') && method === 'GET'
      ? json({ data: [message({ id: 'a', conversationId: 'd1', userId: 'me', body: 'one', createdAt: at(5) }), message({ id: 'b', conversationId: 'd1', userId: 'me', body: 'two', createdAt: at(15) }), message({ id: 'c', conversationId: 'd1', userId: 'me', body: 'three', createdAt: at(25) })] })
      : undefined);
    renderWithQuery(<ChatPage openConversationId="d1" />);
    await screen.findByText('three');
    expect(within(rowOf('one')).getByRole('img', { name: 'Read' })).toBeInTheDocument();
    expect(within(rowOf('two')).getByRole('img', { name: 'Delivered' })).toBeInTheDocument();
    expect(within(rowOf('three')).getByRole('img', { name: 'Sent' })).toBeInTheDocument();
  });

  it('counts who has seen your message in a channel', async () => {
    const t = Date.now();
    c1Messages = [message({ id: 'mine', userId: 'me', body: 'status update', createdAt: new Date(t - 60_000).toISOString() })];
    inbox = [{ conversation: { id: 'c1', kind: 'PROJECT', projectId: 'p1', createdAt: '' }, participants: [
      { conversationId: 'c1', userId: 'me', lastReadAt: new Date(t).toISOString(), addedAt: '' },
      { conversationId: 'c1', userId: 'u1', lastReadAt: new Date(t).toISOString(), addedAt: '' },
    ], unread: 0, lastMessage: null }];
    await openChannelWith('status update');
    expect(within(rowOf('status update')).getByRole('img', { name: 'Seen by 1' })).toBeInTheDocument();
  });

  it('adds a message that arrives live without reloading the conversation, and only once', async () => {
    await openMobileChannel();
    const loads = () => requests.filter((r) => r.method === 'GET' && r.url.includes('/conversations/c1/messages')).length;
    const before = loads();
    const live = message({ id: 'live1', body: 'live one', createdAt: new Date(Date.now() + 1000).toISOString() });
    await act(async () => { handlers['chat:message']?.({ conversationId: 'c1', message: live }); });
    await act(async () => { handlers['chat:message']?.({ conversationId: 'c1', message: live }); });
    await screen.findByText('live one');
    expect(screen.getAllByText('live one')).toHaveLength(1);
    expect(loads()).toBe(before);
  });

  it('applies live edits, deletions and reactions in place', async () => {
    await openMobileChannel();
    await act(async () => { handlers['chat:message:edited']?.({ conversationId: 'c1', message: message({ body: 'hello everyone', editedAt: new Date().toISOString() }) }); });
    expect(await screen.findByText('hello everyone')).toBeInTheDocument();
    await act(async () => { handlers['chat:reaction']?.({ conversationId: 'c1', messageId: 'm1', userId: 'u1', emoji: '✅', op: 'add' }); });
    expect(await screen.findByRole('button', { name: /✅ 1/ })).toBeInTheDocument();
    await act(async () => { handlers['chat:message:deleted']?.({ conversationId: 'c1', id: 'm1' }); });
    expect(await screen.findByText('This message was deleted.')).toBeInTheDocument();
  });
});

describe('ChatPage sending reliably', () => {
  it('keeps a message that failed to send, and retries it as the same message', async () => {
    let attempts = 0;
    override = (u, method) => (u.includes('/conversations/c1/messages') && method === 'POST' && ++attempts === 1 ? json({ error: { code: 'ERR', message: 'boom' } }, 500) : undefined);
    await openMobileChannel();
    await userEvent.type(screen.getByLabelText('Message'), 'hello again{Enter}');
    expect(await screen.findByText(/not sent/i)).toBeInTheDocument();
    expect(screen.getByText('hello again')).toBeInTheDocument(); // the text is still there
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(sends()).toHaveLength(2));
    const [a, b] = sends().map((s) => (s.body as { clientId: string }).clientId);
    expect(b).toBe(a);
    await waitFor(() => expect(screen.queryByText(/not sent/i)).not.toBeInTheDocument());
    expect(screen.getAllByText('hello again')).toHaveLength(1);
  });

  it('puts an unsent message back in its own conversation’s box to change it (and nowhere else)', async () => {
    inbox = [dmSummary()];
    override = (u, method) => (u.includes('/conversations/c1/messages') && method === 'POST' ? json({ error: { code: 'VALIDATION', message: 'Nope.' } }, 400) : undefined);
    await openMobileChannel();
    await userEvent.type(screen.getByLabelText('Message'), 'fix me{Enter}');
    await screen.findByText(/not sent/i);
    await userEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect(screen.getByLabelText('Message')).toHaveValue('fix me');
    expect(screen.queryByText(/not sent/i)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /^ada lovelace/i }));
    await screen.findByRole('heading', { name: 'Ada Lovelace' });
    expect(screen.getByLabelText('Message')).toHaveValue('');
  });

  it('holds messages written offline and sends them when the connection is back', async () => {
    await openMobileChannel();
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    act(() => { window.dispatchEvent(new Event('offline')); });
    await userEvent.type(screen.getByLabelText('Message'), 'written offline{Enter}');
    expect(await screen.findByText(/waiting for connection/i)).toBeInTheDocument();
    expect(sends()).toHaveLength(0);

    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
    act(() => { window.dispatchEvent(new Event('online')); });
    await waitFor(() => expect(sends()).toHaveLength(1));
    await waitFor(() => expect(screen.queryByText(/waiting for connection/i)).not.toBeInTheDocument());
    // Never gone, never twice: on screen the whole time the stand-in gives way to the saved copy.
    expect(screen.getAllByText('written offline')).toHaveLength(1);
  });

  it('keeps messages written offline when you leave the page, and sends them (once) when you come back online', async () => {
    const first = await openMobileChannel();
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    act(() => { window.dispatchEvent(new Event('offline')); });
    await userEvent.type(screen.getByLabelText('Message'), 'kept for later{Enter}');
    await screen.findByText(/waiting for connection/i);
    first.unmount();
    expect(sends()).toHaveLength(0);

    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
    act(() => { window.dispatchEvent(new Event('online')); });
    renderWithQuery(<ChatPage />);
    await waitFor(() => expect(sends()).toHaveLength(1));
    expect(sends()[0]!.body).toMatchObject({ body: 'kept for later' });
    // Delivered: nothing left waiting for the next visit.
    await waitFor(() => expect(Object.keys(localStorage).filter((k) => k.startsWith('mico360.chat.outbox') && localStorage.getItem(k) !== '[]')).toHaveLength(0));
  });

  it('shows only the open conversation’s messages after switching back and forth', async () => {
    inbox = [dmSummary()];
    override = (u, method) => (u.includes('/conversations/d1/messages') && method === 'GET' ? json({ data: [message({ id: 'x1', conversationId: 'd1', body: 'only in the DM' })] }) : undefined);
    await openMobileChannel();
    await userEvent.click(screen.getByRole('button', { name: /^ada lovelace/i }));
    await screen.findByText('only in the DM');
    await userEvent.click(screen.getByRole('button', { name: /^mobile app/i }));
    await screen.findByText('hello channel');
    expect(screen.getAllByRole('log', { name: 'Messages' })).toHaveLength(1);
    expect(screen.getAllByRole('form', { name: 'Send a message' })).toHaveLength(1);
    expect(screen.queryByText('only in the DM')).not.toBeInTheDocument();
  });

  it('keeps a separate unsent draft for each conversation', async () => {
    inbox = [dmSummary()];
    await openMobileChannel();
    await userEvent.type(screen.getByLabelText('Message'), 'for the channel');
    await userEvent.click(screen.getByRole('button', { name: /^ada lovelace/i }));
    await screen.findByRole('heading', { name: 'Ada Lovelace' });
    expect(screen.getByLabelText('Message')).toHaveValue('');
    await userEvent.type(screen.getByLabelText('Message'), 'for Ada');
    await userEvent.click(screen.getByRole('button', { name: /^mobile app/i }));
    await screen.findByRole('heading', { name: 'Mobile App' });
    expect(screen.getByLabelText('Message')).toHaveValue('for the channel');
  });
});

describe('ChatPage composer', () => {
  const original = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'scrollHeight');
  afterEach(() => {
    if (original) Object.defineProperty(HTMLTextAreaElement.prototype, 'scrollHeight', original);
    else delete (HTMLTextAreaElement.prototype as { scrollHeight?: number }).scrollHeight;
  });

  it('grows with the draft, up to a limit', async () => {
    let contentHeight = 96;
    Object.defineProperty(HTMLTextAreaElement.prototype, 'scrollHeight', { configurable: true, get: () => contentHeight });
    await openMobileChannel();
    const box = screen.getByLabelText('Message') as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: ['one', 'two', 'three'].join(String.fromCharCode(10)) } });
    await waitFor(() => expect(box.style.height).toBe('96px'));
    contentHeight = 900;
    fireEvent.change(box, { target: { value: 'a very long draft' } });
    await waitFor(() => expect(box.style.height).toBe('160px'));
  });

  it('sends with Enter and starts a new line with Shift+Enter', async () => {
    await openMobileChannel();
    await userEvent.type(screen.getByLabelText('Message'), 'line one{Shift>}{Enter}{/Shift}line two{Enter}');
    await waitFor(() => expect(sends()).toHaveLength(1));
    expect((sends()[0]!.body as { body: string }).body).toBe('line one\nline two');
  });

  it('cannot send an empty message', async () => {
    await openMobileChannel();
    const send = screen.getByRole('button', { name: /^send$/i });
    expect(send).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Message'), '   {Enter}');
    expect(send).toBeDisabled();
    expect(sends()).toHaveLength(0);
  });

  it('inserts an emoji picked from the searchable picker', async () => {
    await openMobileChannel();
    await userEvent.type(screen.getByLabelText('Message'), 'well done ');
    await userEvent.click(screen.getByRole('button', { name: 'Insert emoji' }));
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search emoji' }), 'party');
    await userEvent.click(screen.getByRole('button', { name: /🎉/ }));
    expect(screen.getByLabelText('Message')).toHaveValue('well done 🎉');
  });

  it('suggests people for an @mention; Enter picks one instead of sending', async () => {
    await openMobileChannel();
    const box = screen.getByLabelText('Message');
    await userEvent.type(box, 'thanks @lov');
    const option = await screen.findByRole('option', { name: /Ada Lovelace/ });
    expect(option).toHaveAttribute('aria-selected', 'true');
    await userEvent.keyboard('{Enter}');
    expect(box).toHaveValue('thanks @ada ');
    expect(sends()).toHaveLength(0);
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(sends()[0]?.body).toMatchObject({ body: 'thanks @ada' }));
  });
});
