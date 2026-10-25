import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within, act, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { MicoAiPage } from './MicoAiPage';
import { useAuthStore } from '../stores/auth-store';
import type { MicoAiMessage } from '../api/mico-ai';
import { shiftDayKey, todayKey } from '../lib/due-date';

// Counts how often the messages are drawn (typing in the box must not redraw them).
const messageRenders = vi.hoisted(() => ({ count: 0 }));
vi.mock('../components/mico-ai/MessageView', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../components/mico-ai/MessageView')>();
  return {
    ...mod,
    MessageView: (props: Parameters<typeof mod.MessageView>[0]) => {
      messageRenders.count++;
      return mod.MessageView(props);
    },
  };
});

// ── A small fake of the MICO AI API ──
interface FakeChat {
  id: string;
  title: string;
  lastMessageAt: string;
  messages: MicoAiMessage[];
  /** Messages before the first page (GET …/messages?before=). */
  older?: MicoAiMessage[];
}
let ready: boolean;
let chats: FakeChat[];
let calls: Array<{ method: string; url: string; body?: unknown }>;
/** What a pending answer becomes on the next poll. */
let next: Partial<MicoAiMessage> | null;
let seq: number;
/** How the fake answers Confirm, Cancel and Undo on a card (changing the message, or a refusal). */
let onCard: ((kind: 'confirm' | 'cancel' | 'undo', msg: MicoAiMessage, body: unknown) => Response | void) | null;

const now = new Date().toISOString();
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const summary = (c: FakeChat) => ({ id: c.id, title: c.title, createdAt: c.lastMessageAt, updatedAt: c.lastMessageAt, lastMessageAt: c.lastMessageAt, match: null });

const tableAnswer: Partial<MicoAiMessage> = {
  status: 'done',
  step: null,
  text: '**2 tasks** in Rig Inspection Portal are overdue.',
  answer: {
    kind: 'answer',
    unavailable: false,
    options: [],
    followUps: ['Which of them are blocked?'],
    sources: [
      { type: 'task', id: 't14', label: 'RIG-14', url: '?task=t14' },
      { type: 'project', id: 'p-rig', label: 'Rig Inspection Portal', url: '/projects/p-rig' },
    ],
    tables: [
      {
        title: 'Overdue tasks',
        fromResult: 'r1',
        columns: [
          { key: 'key', label: 'Task', kind: 'key' },
          { key: 'title', label: 'Title' },
          { key: 'due', label: 'Due', kind: 'date' },
          { key: 'overdueDays', label: 'Overdue', kind: 'days' },
        ],
        rows: [
          { ref: { type: 'task', id: 't14', label: 'RIG-14', url: '?task=t14' }, cells: ['RIG-14', 'Pressure test report', '2026-10-19', 5] },
          { ref: { type: 'task', id: 't9', label: 'RIG-9', url: '?task=t9' }, cells: ['RIG-9', 'Valve inventory update', '2026-10-20', 4] },
        ],
      },
    ],
  },
};

beforeEach(() => {
  ready = true;
  chats = [];
  calls = [];
  next = null;
  seq = 0;
  onCard = null;
  useAuthStore.setState({ user: { id: 'u1', email: 'k@mico360.test', username: 'khurram', roles: ['EMPLOYEE'] }, accessToken: 'token', isAuthenticated: true });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit) => {
      const url = String(input).replace(/^.*\/api\/v1/, '');
      const method = init?.method ?? 'GET';
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ method, url, body });
      const path = url.split('?')[0]!;
      if (path === '/config') return json({ data: { timeZone: 'Asia/Muscat', productName: '', companyName: '', serverTime: now } });
      if (path === '/users/directory') return json({ data: [{ id: 'u1', username: 'khurram', firstName: 'Khurram', lastName: 'Shahzad', active: true }] });
      if (path === '/users/me/preferences') return json({ data: {} });
      if (path === '/projects') return json({ data: [{ id: 'p-falcon', code: 'FAL', name: 'Falcon CRM', status: 'ACTIVE' }] });
      if (path === '/mico-ai/status') return json({ data: { ready, message: ready ? null : 'MICO AI isn’t set up yet. An administrator can add the AI service in AI Management.' } });
      if (path === '/mico-ai/chats' && method === 'GET') {
        const q = new URLSearchParams(url.split('?')[1] ?? '').get('q')?.toLowerCase();
        return json({ data: chats.filter((c) => !q || c.title.toLowerCase().includes(q)).map(summary) });
      }
      if (path === '/mico-ai/chats' && method === 'POST') {
        const c: FakeChat = { id: `c${++seq}`, title: '', lastMessageAt: now, messages: [] };
        chats.unshift(c);
        return json({ data: summary(c) }, 201);
      }
      const m = /^\/mico-ai\/chats\/([^/]+)(?:\/messages(?:\/([^/]+)(\/stop|\/confirm|\/cancel|\/undo|\/report\.pdf|\/tables\/(\d+)\.(xlsx|pdf))?)?)?$/.exec(path);
      const c = m ? chats.find((x) => x.id === m[1]) : undefined;
      if (m && !c) return json({ error: { code: 'NOT_FOUND', message: 'This chat doesn’t exist, or it isn’t yours.' } }, 404);
      if (m && c) {
        const [, , messageId, tail, , format] = m;
        if (!messageId && path.endsWith('/messages') && method === 'POST') {
          if (!c.title) c.title = body.text;
          const question: MicoAiMessage = { id: `q${++seq}`, role: 'user', status: 'done', text: body.text, createdAt: now, step: null };
          const answer: MicoAiMessage = { id: `a${++seq}`, role: 'assistant', status: 'pending', text: '', createdAt: now, step: 'Checking tasks in Rig Inspection…' };
          c.messages.push(question, answer);
          return json({ data: { question, answer } }, 202);
        }
        if (!messageId && method === 'GET' && path.endsWith('/messages')) return json({ data: { messages: c.older ?? [], hasMore: false } });
        if (!messageId && method === 'GET') return json({ data: { chat: summary(c), messages: c.messages, hasMore: !!c.older?.length } });
        if (!messageId && method === 'PATCH') {
          c.title = body.title;
          return json({ data: summary(c) });
        }
        if (!messageId && method === 'DELETE') {
          chats = chats.filter((x) => x !== c);
          return new Response(null, { status: 204 });
        }
        const msg = c.messages.find((x) => x.id === messageId)!;
        if (tail === '/stop') {
          Object.assign(msg, { status: 'stopped', step: null });
          return json({ data: msg });
        }
        if (tail === '/confirm' || tail === '/cancel' || tail === '/undo') {
          const reply = onCard?.(tail.slice(1) as 'confirm' | 'cancel' | 'undo', msg, body);
          if (reply) return reply;
          return json({ data: msg });
        }
        if (tail === '/report.pdf') return new Response('bytes', { status: 200, headers: { 'content-disposition': 'attachment; filename="mico-ai-overdue-2026-10-25.pdf"' } });
        if (format) return new Response('bytes', { status: 200, headers: { 'content-disposition': `attachment; filename="mico-ai-overdue-tasks.${format}"` } });
        if (msg.status === 'pending' && next) Object.assign(msg, next);
        return json({ data: msg });
      }
      return json({ data: [] });
    }),
  );
  URL.createObjectURL = vi.fn(() => 'blob:mock');
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function Where() {
  const loc = useLocation();
  const navigate = useNavigate();
  return (
    <>
      <div data-testid="where">{`${loc.pathname}${loc.search}`}</div>
      {/* Stands in for Ctrl+K "Ask MICO AI" while this page is open. */}
      <button type="button" onClick={() => navigate('/mico-ai', { state: { ask: 'A second question' } })}>
        palette
      </button>
    </>
  );
}

function renderPage(entry: string | { pathname: string; state?: unknown } = '/mico-ai') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route
            path="/mico-ai"
            element={
              <>
                <MicoAiPage pollMs={20} searchDebounceMs={0} />
                <Where />
              </>
            }
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const box = () => screen.getByRole('textbox', { name: 'Ask MICO AI' });
const posted = (suffix: string) => calls.filter((c) => c.method === 'POST' && c.url.endsWith(suffix));

describe('MICO AI page', () => {
  it('a new chat greets the person and suggests four questions', async () => {
    renderPage();
    expect(await screen.findByRole('heading', { name: 'How can I help, Khurram?' })).toBeInTheDocument();
    expect(screen.getByText('I answer from your tasks, projects, meetings, reports and team chat.')).toBeInTheDocument();
    for (const q of ['Which of my tasks are overdue?', 'Summarize this week’s meetings', 'Workload report for my team this week', 'What changed in Falcon CRM yesterday?']) {
      expect(screen.getByRole('button', { name: q })).toBeInTheDocument();
    }
  });

  it('says so before anyone types when AI isn’t set up', async () => {
    ready = false;
    renderPage();
    expect(await screen.findByText('MICO AI isn’t set up yet. An administrator can add the AI service in AI Management.')).toBeInTheDocument();
    await waitFor(() => expect(box()).toBeDisabled());
    expect(screen.queryByText('Enter to send · Shift+Enter for a new line')).not.toBeInTheDocument(); // no hint for a box that is off
  });

  it('Enter sends, Shift+Enter adds a new line; it shows its progress with Stop, then the answer with its table, sources and downloads', async () => {
    renderPage();
    await screen.findByRole('heading', { name: 'How can I help, Khurram?' });
    await userEvent.type(box(), 'Which tasks are overdue{Shift>}{Enter}{/Shift}in Rig Inspection?');
    expect(box()).toHaveValue('Which tasks are overdue\nin Rig Inspection?');
    expect(posted('/messages')).toHaveLength(0);
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(posted('/messages')).toHaveLength(1));
    expect(posted('/messages')[0]!.body).toEqual({ text: 'Which tasks are overdue\nin Rig Inspection?' });
    expect(await screen.findByText('Checking tasks in Rig Inspection…')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Stop' })).toBeInTheDocument();
    expect(box()).toHaveValue('');
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/mico-ai?chat=c1'));
    // The new chat takes its name from the question at once.
    expect(await screen.findByRole('heading', { level: 2, name: /^Which tasks are overdue/ })).toBeInTheDocument();

    next = tableAnswer;
    const table = await screen.findByRole('table', { name: 'Overdue tasks' });
    // A wide table scrolls sideways in its own box, which the keyboard can reach.
    expect(screen.getByRole('region', { name: 'Overdue tasks' })).toHaveAttribute('tabindex', '0');
    expect(within(table).getAllByRole('row').map((r) => r.textContent)).toEqual(['TaskTitleDueOverdue', 'RIG-14Pressure test reportMon 19 Oct5 days', 'RIG-9Valve inventory updateTue 20 Oct4 days']);
    expect(screen.getByText('2 tasks', { selector: 'strong' })).toBeInTheDocument();
    const sources = screen.getByRole('list', { name: 'Sources' });
    expect(within(sources).getByRole('link', { name: 'RIG-14' })).toHaveAttribute('href', '/mico-ai?chat=c1&task=t14');
    expect(within(sources).getByRole('link', { name: 'Rig Inspection Portal' })).toHaveAttribute('href', '/projects/p-rig');
    expect(screen.queryByRole('button', { name: 'Stop' })).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(/MICO AI answered/);

    await userEvent.click(screen.getByRole('button', { name: 'Download Overdue tasks as Excel' }));
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/tables/1.xlsx'))).toBe(true));
    await userEvent.click(screen.getByRole('button', { name: 'Download this answer as a PDF report' }));
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/messages/a3/report.pdf'))).toBe(true));
  });

  it('Stop ends an answer', async () => {
    renderPage();
    await screen.findByRole('heading', { name: 'How can I help, Khurram?' });
    await userEvent.type(box(), 'Dig deep{Enter}');
    await userEvent.click(await screen.findByRole('button', { name: 'Stop' }));
    await waitFor(() => expect(posted('/stop')).toHaveLength(1));
    expect(await screen.findByText('Stopped.')).toBeInTheDocument();
  });

  it('a suggested question starts a chat with it', async () => {
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Which of my tasks are overdue?' }));
    await waitFor(() => expect(posted('/messages')[0]?.body).toEqual({ text: 'Which of my tasks are overdue?' }));
    expect(posted('/mico-ai/chats')).toHaveLength(1);
  });

  it('renders answers safely: HTML in an answer is only text', async () => {
    chats = [{ id: 'c9', title: 'Old chat', lastMessageAt: now, messages: [
      { id: 'q1', role: 'user', status: 'done', text: '<b>hi</b>', createdAt: now, step: null },
      { id: 'a1', role: 'assistant', status: 'done', text: '<img src="x" onerror="alert(1)"> **<script>bad()</script>**', createdAt: now, step: null, answer: { kind: 'answer', unavailable: false, options: [], followUps: [], sources: [], tables: [] } },
    ] }];
    const { container } = renderPage('/mico-ai?chat=c9');
    expect(await screen.findByText('<img src="x" onerror="alert(1)">', { exact: false })).toBeInTheDocument();
    expect(container.querySelector('img[src="x"]')).toBeNull();
    expect(container.querySelector('script')).toBeNull();
    expect(screen.getByText('<b>hi</b>')).toBeInTheDocument();
  });

  it('a clarifying question offers quick replies that answer it; “not available” is a note', async () => {
    chats = [{ id: 'c9', title: 'Workload', lastMessageAt: now, messages: [
      { id: 'q1', role: 'user', status: 'done', text: 'What is the budget left?', createdAt: now, step: null },
      { id: 'a1', role: 'assistant', status: 'done', text: 'MICO360 Tasks doesn’t keep budgets, so I can’t answer that.', createdAt: now, step: null, answer: { kind: 'answer', unavailable: true, options: [], followUps: [], sources: [], tables: [] } },
      { id: 'q2', role: 'user', status: 'done', text: 'Make a workload report for my team.', createdAt: now, step: null },
      { id: 'a2', role: 'assistant', status: 'done', text: 'Which team and period do you mean?', createdAt: now, step: null, answer: { kind: 'clarify', unavailable: false, options: ['Rig Inspection · this week', 'All my projects · this week'], followUps: [], sources: [], tables: [] } },
    ] }];
    renderPage('/mico-ai?chat=c9');
    const note = await screen.findByRole('note');
    expect(note).toHaveTextContent('MICO360 Tasks doesn’t keep budgets, so I can’t answer that.');
    await userEvent.click(screen.getByRole('button', { name: 'Rig Inspection · this week' }));
    await waitFor(() => expect(posted('/messages')[0]?.body).toEqual({ text: 'Rig Inspection · this week' }));
  });

  it('Copy and Retry on an answer; a failed answer says why in plain words', async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    chats = [{ id: 'c9', title: 'Overdue', lastMessageAt: now, messages: [
      { id: 'q1', role: 'user', status: 'done', text: 'Which tasks are overdue?', createdAt: now, step: null },
      { id: 'a1', role: 'assistant', createdAt: now, ...(tableAnswer as Omit<MicoAiMessage, 'id' | 'role' | 'createdAt'>) },
      { id: 'q2', role: 'user', status: 'done', text: 'And blocked?', createdAt: now, step: null },
      { id: 'a2', role: 'assistant', status: 'error', text: '', createdAt: now, step: null, error: 'The AI service is busy right now (HTTP 429). Try again in a moment.' },
    ] }];
    renderPage('/mico-ai?chat=c9');
    expect(await screen.findByText('The AI service is busy right now (HTTP 429). Try again in a moment.')).toBeInTheDocument();
    await userEvent.click(screen.getAllByRole('button', { name: 'Copy' })[0]!);
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('RIG-14\tPressure test report\tMon 19 Oct\t5 days'));
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument();
    const retries = screen.getAllByRole('button', { name: 'Retry' });
    await userEvent.click(retries[retries.length - 1]!);
    await waitFor(() => expect(posted('/messages')[0]?.body).toEqual({ text: 'And blocked?' }));
  });

  it('the chat list: groups, search, open, rename and delete (after asking)', async () => {
    const yesterday = new Date(`${shiftDayKey(todayKey('Asia/Muscat'), -1)}T12:00:00+04:00`).toISOString();
    chats = [
      { id: 'c1', title: 'Overdue tasks in Rig Inspection', lastMessageAt: now, messages: [] },
      { id: 'c2', title: 'Summary of the weekly review', lastMessageAt: yesterday, messages: [] },
    ];
    renderPage();
    const list = await screen.findByRole('navigation', { name: 'Chats' });
    await waitFor(() => expect(within(list).getByRole('heading', { name: 'Today' })).toBeInTheDocument());
    expect(within(list).getByRole('heading', { name: 'Yesterday' })).toBeInTheDocument();

    await userEvent.type(within(list).getByRole('searchbox', { name: 'Search chats' }), 'weekly');
    await waitFor(() => expect(within(list).queryByRole('button', { name: 'Overdue tasks in Rig Inspection' })).not.toBeInTheDocument());
    await userEvent.clear(within(list).getByRole('searchbox', { name: 'Search chats' }));

    await userEvent.click(await within(list).findByRole('button', { name: 'Overdue tasks in Rig Inspection' }));
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/mico-ai?chat=c1'));
    expect(screen.getByRole('heading', { level: 2, name: 'Overdue tasks in Rig Inspection' })).toBeInTheDocument();

    await userEvent.click(within(list).getByRole('button', { name: 'More for Overdue tasks in Rig Inspection' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Rename' }));
    const name = within(list).getByRole('textbox', { name: 'Chat name' });
    await userEvent.clear(name);
    await userEvent.type(name, 'Rig overdue{Enter}');
    await waitFor(() => expect(calls.some((c) => c.method === 'PATCH' && (c.body as { title: string }).title === 'Rig overdue')).toBe(true));

    await userEvent.click(await within(list).findByRole('button', { name: 'More for Rig overdue' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Delete…' }));
    const dialog = screen.getByRole('alertdialog', { name: 'Delete this chat?' });
    expect(dialog).toHaveTextContent('“Rig overdue” and its messages will be deleted for good.');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete chat' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'DELETE' && c.url.endsWith('/mico-ai/chats/c1'))).toBe(true));
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent(/^\/mico-ai$/));
  });

  it('the chat title in the header can be edited', async () => {
    chats = [{ id: 'c1', title: 'Rig', lastMessageAt: now, messages: [] }];
    renderPage('/mico-ai?chat=c1');
    await userEvent.click(await screen.findByRole('button', { name: 'Rename this chat' }));
    const input = screen.getByRole('textbox', { name: 'Chat name' });
    await userEvent.clear(input);
    await userEvent.type(input, 'Rig inspection{Enter}');
    await waitFor(() => expect(calls.some((c) => c.method === 'PATCH' && (c.body as { title: string }).title === 'Rig inspection')).toBe(true));
  });

  it('a question from Ctrl+K (“Ask MICO AI”) starts a new chat with it', async () => {
    renderPage({ pathname: '/mico-ai', state: { ask: 'Who has the most overdue tasks?' } });
    await waitFor(() => expect(posted('/messages')[0]?.body).toEqual({ text: 'Who has the most overdue tasks?' }));
  });

  it('a question from Ctrl+K asked while a chat is open still starts a new chat', async () => {
    chats = [{ id: 'c9', title: 'Old chat', lastMessageAt: now, messages: [] }];
    renderPage({ pathname: '/mico-ai', search: '?chat=c9', state: { ask: 'Who has the most overdue tasks?' } } as never);
    await waitFor(() => expect(posted('/messages')).toHaveLength(1));
    expect(posted('/messages')[0]!.url).not.toContain('/c9/');
    expect(posted('/mico-ai/chats')).toHaveLength(1);
  });

  it('on a phone the chats open from ☰', async () => {
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Open chats' }));
    const drawer = screen.getByRole('dialog', { name: 'Chats' });
    expect(within(drawer).getByRole('button', { name: 'New chat' })).toBeInTheDocument();
    await act(async () => {
      await userEvent.keyboard('{Escape}');
    });
    expect(screen.queryByRole('dialog', { name: 'Chats' })).not.toBeInTheDocument();
  });
});

describe('MICO AI page: review fixes', () => {
  it('a second “Ask MICO AI” from Ctrl+K while on the page asks that question too', async () => {
    renderPage({ pathname: '/mico-ai', state: { ask: 'The first question' } });
    await waitFor(() => expect(posted('/messages')).toHaveLength(1));
    next = { status: 'done', step: null, text: 'One.', answer: { kind: 'answer', unavailable: false, options: [], followUps: [], sources: [], tables: [] } };
    await screen.findByText('One.');
    await userEvent.click(screen.getByRole('button', { name: 'palette' }));
    await waitFor(() => expect(posted('/messages')).toHaveLength(2));
    expect(posted('/messages')[1]!.body).toEqual({ text: 'A second question' });
  });

  it('when the chat is deleted elsewhere, it stops following the answer and says so', async () => {
    chats = [{ id: 'c9', title: 'Gone soon', lastMessageAt: now, messages: [
      { id: 'q1', role: 'user', status: 'done', text: 'question', createdAt: now, step: null },
      { id: 'a1', role: 'assistant', status: 'pending', text: '', createdAt: now, step: 'Checking tasks…' },
    ] }];
    renderPage('/mico-ai?chat=c9');
    await screen.findByText('Checking tasks…');
    chats = [];
    expect(await screen.findByText('This chat was deleted.')).toBeInTheDocument();
    const polls = () => calls.filter((c) => c.url.endsWith('/messages/a1')).length;
    const seen = polls();
    await new Promise((r) => setTimeout(r, 120));
    expect(polls()).toBe(seen);
  });

  it('after Stop, focus moves to the answer (not the page)', async () => {
    renderPage();
    await screen.findByRole('heading', { name: 'How can I help, Khurram?' });
    await userEvent.type(box(), 'Dig deep{Enter}');
    await userEvent.click(await screen.findByRole('button', { name: 'Stop' }));
    await screen.findByText('Stopped.');
    await waitFor(() => expect(document.activeElement).toHaveAttribute('aria-label', 'MICO AI’s answer'));
  });

  it('a long chat shows its latest messages and loads earlier ones on request', async () => {
    chats = [{ id: 'c9', title: 'Long', lastMessageAt: now, messages: [{ id: 'q9', role: 'user', status: 'done', text: 'latest question', createdAt: now, step: null }], older: [{ id: 'q1', role: 'user', status: 'done', text: 'an early question', createdAt: now, step: null }] }];
    renderPage('/mico-ai?chat=c9');
    await screen.findByText('latest question');
    expect(screen.queryByText('an early question')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Load earlier messages' }));
    expect(await screen.findByText('an early question')).toBeInTheDocument();
    expect(calls.some((c) => c.url.includes('/mico-ai/chats/c9/messages?before=q9'))).toBe(true);
    expect(screen.queryByRole('button', { name: 'Load earlier messages' })).not.toBeInTheDocument();
  });

  it('a capped table says how many there were in all', async () => {
    const capped = structuredClone(tableAnswer) as MicoAiMessage;
    capped.answer!.tables[0]!.total = 250;
    chats = [{ id: 'c9', title: 'Big', lastMessageAt: now, messages: [{ ...capped, id: 'a1', role: 'assistant', createdAt: now }] }];
    renderPage('/mico-ai?chat=c9');
    expect(await screen.findByText('Showing 2 of 250')).toBeInTheDocument();
  });
});

describe('MICO AI page: a ChatGPT-style layout', () => {
  /** A scroll area jsdom can't measure: give it a size and a scroll position that sticks. */
  function measure(el: HTMLElement, size: { scrollHeight: number; clientHeight: number; scrollTop: number }) {
    let top = size.scrollTop;
    Object.defineProperty(el, 'scrollHeight', { configurable: true, get: () => size.scrollHeight });
    Object.defineProperty(el, 'clientHeight', { configurable: true, get: () => size.clientHeight });
    Object.defineProperty(el, 'scrollTop', { configurable: true, get: () => top, set: (v: number) => (top = Math.max(0, Math.min(v, size.scrollHeight - size.clientHeight))) });
    return size;
  }
  const answered = (): FakeChat => ({
    id: 'c9',
    title: 'Overdue',
    lastMessageAt: now,
    messages: [
      { id: 'q1', role: 'user', status: 'done', text: 'Which tasks are overdue?', createdAt: now, step: null },
      { id: 'a1', role: 'assistant', createdAt: now, ...(tableAnswer as Omit<MicoAiMessage, 'id' | 'role' | 'createdAt'>) },
    ],
  });

  it('fills the page: no boxed frame; the messages scroll across the full width while the conversation and the box sit in a centred reading column', async () => {
    renderPage();
    await screen.findByRole('heading', { name: 'How can I help, Khurram?' });
    const messages = screen.getByRole('region', { name: 'Messages' });
    expect(messages).toHaveAttribute('tabindex', '0'); // still scrollable from the keyboard
    expect(messages.querySelector('[data-mico-column]')).toHaveClass('mx-auto', 'max-w-3xl');
    expect(screen.getByRole('form', { name: 'Ask MICO AI' })).toHaveClass('mx-auto', 'max-w-3xl');
    const frame = messages.closest('.chat-frame')!;
    expect(frame.className).not.toMatch(/rounded|shadow|(^|\s)sm:border(\s|$)/);
  });

  it('your question is a bubble on the right; MICO AI’s answer is full-width text beside its drawn mark, with no bubble', async () => {
    chats = [answered()];
    renderPage('/mico-ai?chat=c9');
    const answer = await screen.findByRole('article', { name: 'MICO AI’s answer' });
    const question = screen.getByText('Which tasks are overdue?').closest('[data-mico-message]')!;
    expect(question).toHaveAttribute('data-mico-message', 'user');
    expect(question).toHaveClass('justify-end');
    expect(question.querySelector('[data-bubble]')).toHaveClass('rounded-3xl', 'bg-ground');
    expect(answer).toHaveAttribute('data-mico-message', 'assistant');
    expect(answer.className).not.toMatch(/(^|\s)bg-/);
    // The mark is a drawing, not a text character (no ✦ that a font or an emoji set may draw differently).
    const marks = document.querySelectorAll('[data-mico-mark]');
    expect(marks.length).toBeGreaterThan(0);
    marks.forEach((m) => {
      expect(m.querySelector('svg')).not.toBeNull();
      expect(m.textContent).toBe('');
    });
  });

  it('while MICO AI writes, Send turns into Stop and the box says it is working; afterwards Send is back', async () => {
    renderPage();
    await screen.findByRole('heading', { name: 'How can I help, Khurram?' });
    expect(box()).toHaveAttribute('enterkeyhint', 'send'); // a phone keyboard's Enter key says Send
    await userEvent.type(box(), 'Dig deep{Enter}');
    expect(await screen.findByRole('button', { name: 'Stop' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Send' })).not.toBeInTheDocument();
    expect(screen.getByText('MICO AI is working…')).toBeInTheDocument();
    next = { status: 'done', step: null, text: 'Done digging.', answer: { kind: 'answer', unavailable: false, options: [], followUps: [], sources: [], tables: [] } };
    await screen.findByText('Done digging.');
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled(); // nothing typed yet
    expect(screen.queryByRole('button', { name: 'Stop' })).not.toBeInTheDocument();
    expect(screen.queryByText('MICO AI is working…')).not.toBeInTheDocument();
  });

  it('the box grows with what is typed, up to a limit', async () => {
    let height = 120;
    vi.spyOn(HTMLTextAreaElement.prototype, 'scrollHeight', 'get').mockImplementation(() => height);
    renderPage();
    await screen.findByRole('heading', { name: 'How can I help, Khurram?' });
    await userEvent.type(box(), 'Three{Shift>}{Enter}{/Shift}lines{Shift>}{Enter}{/Shift}here');
    expect(box().style.height).toBe('120px');
    height = 900;
    await userEvent.type(box(), '{Shift>}{Enter}{/Shift}and many more');
    expect(box().style.height).toBe('200px');
  });

  it('a new chat: the greeting, what MICO AI reads, and the suggestions as a grid of cards (two columns from 40em, one on a phone)', async () => {
    renderPage();
    await screen.findByRole('heading', { name: 'How can I help, Khurram?' });
    const suggestions = screen.getByRole('list', { name: 'Suggested questions' });
    expect(suggestions).toHaveClass('grid', 'grid-cols-1', 'sm:grid-cols-2');
    expect(within(suggestions).getAllByRole('button')).toHaveLength(4);
    expect(within(screen.getByRole('list', { name: 'MICO AI reads' })).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Tasks', 'Meetings', 'Reports', 'Chat']);
  });

  it('scrolled up through a long chat, “Jump to latest” brings the newest message back', async () => {
    chats = [answered()];
    renderPage('/mico-ai?chat=c9');
    await screen.findByRole('article', { name: 'MICO AI’s answer' });
    const region = screen.getByRole('region', { name: 'Messages' });
    measure(region, { scrollHeight: 2000, clientHeight: 500, scrollTop: 1500 });
    fireEvent.scroll(region);
    expect(screen.queryByRole('button', { name: 'Jump to latest' })).not.toBeInTheDocument();
    region.scrollTop = 200;
    fireEvent.scroll(region);
    await userEvent.click(await screen.findByRole('button', { name: 'Jump to latest' }));
    expect(region.scrollTop).toBe(1500);
    fireEvent.scroll(region);
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Jump to latest' })).not.toBeInTheDocument());
    // A click or tap leaves focus alone (on a phone, focusing the box would open the keyboard)…
    expect(box()).not.toHaveFocus();
    // …from the keyboard, focus moves on to the box (the button it was on is gone).
    region.scrollTop = 200;
    fireEvent.scroll(region);
    (await screen.findByRole('button', { name: 'Jump to latest' })).focus();
    await userEvent.keyboard('{Enter}');
    expect(region.scrollTop).toBe(1500);
    expect(box()).toHaveFocus();
  });

  it('a new chat opens at its top (the greeting, and any notice above it), not scrolled to its end', async () => {
    chats = [answered()];
    renderPage('/mico-ai?chat=c9');
    await screen.findByRole('article', { name: 'MICO AI’s answer' });
    const region = screen.getByRole('region', { name: 'Messages' });
    measure(region, { scrollHeight: 1200, clientHeight: 500, scrollTop: 700 });
    await userEvent.click(screen.getAllByRole('button', { name: 'New chat' })[0]!);
    await screen.findByRole('heading', { name: 'How can I help, Khurram?' });
    expect(region.scrollTop).toBe(0);
  });

  it('keeps the newest message in view when the message area gets shorter (a phone keyboard opening)', async () => {
    const resized: Array<() => void> = [];
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(private cb: () => void) {}
        observe() {
          resized.push(() => this.cb());
        }
        unobserve() {}
        disconnect() {}
      },
    );
    chats = [answered()];
    renderPage('/mico-ai?chat=c9');
    await screen.findByRole('article', { name: 'MICO AI’s answer' });
    const region = screen.getByRole('region', { name: 'Messages' });
    const size = measure(region, { scrollHeight: 2000, clientHeight: 600, scrollTop: 1400 });
    fireEvent.scroll(region);
    size.clientHeight = 300; // the keyboard takes half the area
    act(() => resized.forEach((r) => r()));
    expect(region.scrollTop).toBe(1700);
    // Someone reading further up is left where they are.
    region.scrollTop = 100;
    fireEvent.scroll(region);
    size.clientHeight = 600;
    act(() => resized.forEach((r) => r()));
    expect(region.scrollTop).toBe(100);
  });

  it('not set up: an administrator is offered the way to AI Management; others are told to ask one', async () => {
    ready = false;
    useAuthStore.setState({ user: { id: 'u1', email: 'k@mico360.test', username: 'khurram', roles: ['ADMIN'] } });
    const first = renderPage();
    expect(await screen.findByRole('link', { name: 'Open AI Management' })).toHaveAttribute('href', '/admin/ai');
    first.unmount();
    useAuthStore.setState({ user: { id: 'u1', email: 'k@mico360.test', username: 'khurram', roles: ['EMPLOYEE'] } });
    renderPage();
    await screen.findByText('MICO AI isn’t set up yet. An administrator can add the AI service in AI Management.');
    expect(screen.queryByRole('link', { name: 'Open AI Management' })).not.toBeInTheDocument();
  });

  it('on a phone the chats are a sheet over the whole window (not under the top bar) that ends above the on-screen keyboard', async () => {
    const { container } = renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Open chats' }));
    const sheet = screen.getByRole('dialog', { name: 'Chats' });
    expect(sheet.closest('.above-keyboard')).not.toBeNull();
    // At the end of <body>: the page's animated wrapper would otherwise keep it under the app's top bar.
    expect(container.contains(sheet)).toBe(false);
  });
});

describe('MICO AI page: review fixes (2)', () => {
  const rect = (top: number, height: number) => ({ top, bottom: top + height, height, left: 0, right: 0, width: 0, x: 0, y: top, toJSON: () => ({}) }) as DOMRect;
  /** A scroll area jsdom can't measure: its size (a number, or worked out each time) and a scroll position that sticks. */
  function measure(el: HTMLElement, size: { scrollHeight: number | (() => number); clientHeight: number; scrollTop: number }) {
    let top = size.scrollTop;
    const height = () => (typeof size.scrollHeight === 'function' ? size.scrollHeight() : size.scrollHeight);
    Object.defineProperty(el, 'scrollHeight', { configurable: true, get: height });
    Object.defineProperty(el, 'clientHeight', { configurable: true, get: () => size.clientHeight });
    Object.defineProperty(el, 'scrollTop', { configurable: true, get: () => top, set: (v: number) => (top = Math.max(0, Math.min(v, height() - size.clientHeight))) });
    return size;
  }
  const question = (id: string, text: string): MicoAiMessage => ({ id, role: 'user', status: 'done', text, createdAt: now, step: null });
  const done = (id: string, extra: Partial<MicoAiMessage>): MicoAiMessage => ({ id, role: 'assistant', createdAt: now, ...(tableAnswer as Omit<MicoAiMessage, 'id' | 'role' | 'createdAt'>), ...extra });
  const pendingChat = (): FakeChat => ({ id: 'c9', title: 'Working', lastMessageAt: now, messages: [question('q1', 'Which tasks are overdue?'), { id: 'a1', role: 'assistant', status: 'pending', text: '', createdAt: now, step: 'Checking tasks…' }] });

  it('every finished answer with something in it offers the whole answer as a PDF report (a text-only one too); Excel sits with each table', async () => {
    chats = [
      {
        id: 'c9',
        title: 'Mixed',
        lastMessageAt: now,
        messages: [
          question('q1', 'Which tasks are overdue?'),
          done('a1', {}),
          question('q2', 'Summarize this week’s meetings'),
          done('a2', { text: 'Two meetings this week.', answer: { kind: 'answer', unavailable: false, options: [], followUps: [], sources: [], tables: [] } }),
          question('q3', 'Make a workload report.'),
          done('a3', { text: 'Which team do you mean?', answer: { kind: 'clarify', unavailable: false, options: ['Rig Inspection'], followUps: [], sources: [], tables: [] } }),
        ],
      },
    ];
    renderPage('/mico-ai?chat=c9');
    await screen.findByText('Two meetings this week.');
    const reports = screen.getAllByRole('button', { name: 'Download this answer as a PDF report' });
    expect(reports).toHaveLength(2); // not for the clarifying question
    expect(screen.queryByRole('button', { name: 'Download Overdue tasks as a PDF report' })).not.toBeInTheDocument();
    const excel = screen.getByRole('button', { name: 'Download Overdue tasks as Excel' });
    expect(excel.closest('[data-answer-table]')).toBe(screen.getByRole('region', { name: 'Overdue tasks' }).closest('[data-answer-table]'));
    // Big enough to hit: 36px tall (min-h-9), like the buttons around them.
    for (const b of [reports[0]!, excel, screen.getAllByRole('button', { name: 'Copy' })[0]!, screen.getAllByRole('button', { name: 'Retry' })[0]!]) expect(b).toHaveClass('min-h-9');
    await userEvent.click(reports[1]!);
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/messages/a2/report.pdf'))).toBe(true));
  });

  it('a wide table breaks out of the reading column on a wide screen, and fades at the side it can still scroll to (on scroll and on resize)', async () => {
    const resized: Array<() => void> = [];
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(private cb: () => void) {}
        observe() {
          resized.push(() => this.cb());
        }
        unobserve() {}
        disconnect() {}
      },
    );
    chats = [{ id: 'c9', title: 'Overdue', lastMessageAt: now, messages: [question('q1', 'Which tasks are overdue?'), done('a1', {})] }];
    renderPage('/mico-ai?chat=c9');
    const region = await screen.findByRole('region', { name: 'Overdue tasks' });
    expect(screen.getByRole('region', { name: 'Messages' }).className).toContain('[container-type:inline-size]');
    expect(region.closest('[data-answer-table]')!.className).toMatch(/cqw/);
    const cues = () => [...region.parentElement!.querySelectorAll('[data-scroll-cue]')].map((c) => c.getAttribute('data-scroll-cue'));
    expect(cues()).toEqual([]);
    let left = 0;
    let width = 600;
    Object.defineProperty(region, 'scrollWidth', { configurable: true, get: () => 1200 });
    Object.defineProperty(region, 'clientWidth', { configurable: true, get: () => width });
    Object.defineProperty(region, 'scrollLeft', { configurable: true, get: () => left, set: (v: number) => (left = v) });
    act(() => resized.forEach((r) => r()));
    expect(cues()).toEqual(['end']);
    left = 300;
    fireEvent.scroll(region);
    expect(cues()).toEqual(['start', 'end']);
    left = 600;
    fireEvent.scroll(region);
    expect(cues()).toEqual(['start']);
    width = 1200; // a wider window: it all fits
    left = 0;
    act(() => resized.forEach((r) => r()));
    expect(cues()).toEqual([]);
  });

  it('a new chat stays at its top when the area is resized (the greeting and any notice stay in view)', async () => {
    const resized: Array<() => void> = [];
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(private cb: () => void) {}
        observe() {
          resized.push(() => this.cb());
        }
        unobserve() {}
        disconnect() {}
      },
    );
    ready = false;
    renderPage();
    await screen.findByText('MICO AI isn’t set up yet. An administrator can add the AI service in AI Management.');
    const region = screen.getByRole('region', { name: 'Messages' });
    measure(region, { scrollHeight: 1200, clientHeight: 500, scrollTop: 0 });
    act(() => resized.forEach((r) => r()));
    expect(region.scrollTop).toBe(0);
  });

  it('follows MICO AI’s progress only while you are at the end', async () => {
    chats = [pendingChat()];
    renderPage('/mico-ai?chat=c9');
    await screen.findByText('Checking tasks…');
    const region = screen.getByRole('region', { name: 'Messages' });
    const size = measure(region, { scrollHeight: 2000, clientHeight: 500, scrollTop: 300 });
    fireEvent.scroll(region); // reading further up
    size.scrollHeight = 2100;
    next = { status: 'pending', step: 'Reading meetings…' };
    await screen.findByText('Reading meetings…');
    expect(region.scrollTop).toBe(300);
    region.scrollTop = 1600; // back at the end
    fireEvent.scroll(region);
    size.scrollHeight = 2200;
    next = { status: 'pending', step: 'Checking reports…' };
    await screen.findByText('Checking reports…');
    expect(region.scrollTop).toBe(1700);
  });

  it('when a long answer finishes, its start comes into view (not its end)', async () => {
    chats = [pendingChat()];
    renderPage('/mico-ai?chat=c9');
    await screen.findByText('Checking tasks…');
    const region = screen.getByRole('region', { name: 'Messages' });
    const size = measure(region, { scrollHeight: 1000, clientHeight: 500, scrollTop: 500 });
    fireEvent.scroll(region); // at the end, following
    region.getBoundingClientRect = () => rect(100, 500);
    screen.getByRole('article', { name: 'MICO AI’s answer' }).getBoundingClientRect = () => rect(400, 1400);
    size.scrollHeight = 2400;
    next = tableAnswer;
    await screen.findByRole('table', { name: 'Overdue tasks' });
    // Its top was 300px into the view: it now starts just under the top edge.
    expect(region.scrollTop).toBe(500 + 300 - 16);
  });

  it('“Load earlier messages” keeps your place', async () => {
    chats = [{ id: 'c9', title: 'Long', lastMessageAt: now, messages: [question('q9', 'latest question')], older: [question('q1', 'an early question'), question('q2', 'another early one')] }];
    renderPage('/mico-ai?chat=c9');
    await screen.findByText('latest question');
    const region = screen.getByRole('region', { name: 'Messages' });
    measure(region, { scrollHeight: () => 100 + 400 * document.querySelectorAll('[data-mico-message]').length, clientHeight: 300, scrollTop: 150 });
    await userEvent.click(screen.getByRole('button', { name: 'Load earlier messages' }));
    await screen.findByText('an early question');
    expect(region.scrollTop).toBe(150 + 800);
  });

  it('the box lines up with the reading column: the same width and the same side padding', async () => {
    renderPage();
    await screen.findByRole('heading', { name: 'How can I help, Khurram?' });
    const column = screen.getByRole('region', { name: 'Messages' }).querySelector('[data-mico-column]')!;
    const form = screen.getByRole('form', { name: 'Ask MICO AI' });
    for (const c of ['mx-auto', 'max-w-3xl', 'px-4', 'sm:px-6']) {
      expect(column).toHaveClass(c);
      expect(form).toHaveClass(c);
    }
    expect(form.parentElement!.className).not.toMatch(/(^|\s)(sm:)?px-/);
  });

  it('tells a screen reader once that MICO AI is working, then that it answered', async () => {
    renderPage();
    await screen.findByRole('heading', { name: 'How can I help, Khurram?' });
    await userEvent.type(box(), 'Dig deep{Enter}');
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('MICO AI is working on your question…'));
    next = { status: 'done', step: null, text: 'Done digging.', answer: { kind: 'answer', unavailable: false, options: [], followUps: [], sources: [], tables: [] } };
    await screen.findByText('Done digging.');
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('MICO AI answered: Done digging.'));
  });

  it('typing in the box doesn’t redraw the conversation', async () => {
    chats = [{ id: 'c9', title: 'Overdue', lastMessageAt: now, messages: [question('q1', 'Which tasks are overdue?'), done('a1', {})] }];
    renderPage('/mico-ai?chat=c9');
    await screen.findByRole('table', { name: 'Overdue tasks' });
    await new Promise((r) => setTimeout(r, 50));
    messageRenders.count = 0;
    await userEvent.type(box(), 'Hello there');
    expect(box()).toHaveValue('Hello there');
    expect(messageRenders.count).toBe(0);
  });
});

describe('MICO AI page: a card of proposed changes', () => {
  const card = (status: 'proposed' | 'done', extra: Record<string, unknown> = {}): MicoAiMessage => ({
    id: 'a1',
    role: 'assistant',
    status: 'done',
    text: 'Here is the task to create. Check it, then confirm.',
    createdAt: now,
    step: null,
    answer: {
      kind: 'proposal',
      unavailable: false,
      tables: [],
      sources: [],
      followUps: [],
      options: [],
      proposal: {
        id: 'p1',
        status,
        note: null,
        sendInvites: true,
        hasMeetings: false,
        confirmedAt: status === 'done' ? new Date().toISOString() : null,
        undoUntil: status === 'done' ? new Date(Date.now() + 15 * 60_000).toISOString() : null,
        canUndo: status === 'done',
        items: [
          {
            id: 'c1',
            type: 'create_task',
            problem: null,
            locked: false,
            warning: null,
            result: status === 'done' ? { status: 'done', message: null, link: { label: 'RIG-35', url: '?task=t35' } } : null,
            undo: null,
            fields: { title: 'Replace the gauge', projectId: 'p-rig', assigneeIds: [], due: null, priority: 'NORMAL', description: '' },
            labels: { project: 'Rig Inspection Portal', assignees: [] },
          },
        ],
        ...extra,
      },
    },
  });
  const chat = (): FakeChat => ({ id: 'c9', title: 'Make a task', lastMessageAt: now, messages: [{ id: 'q1', role: 'user', status: 'done', text: 'Make a task to replace the gauge', createdAt: now, step: null }, card('proposed')] });

  it('Confirm sends the card, and the answer shows what happened (announced once)', async () => {
    chats = [chat()];
    onCard = (kind, msg) => {
      if (kind === 'confirm') Object.assign(msg, card('done'));
    };
    renderPage('/mico-ai?chat=c9');
    await userEvent.click(await screen.findByRole('button', { name: /^Confirm/ }));
    await waitFor(() => expect(posted('/messages/a1/confirm')).toHaveLength(1));
    expect(posted('/messages/a1/confirm')[0]!.body).toEqual({ items: [{ id: 'c1', include: true }] });
    expect(await screen.findByRole('link', { name: 'Open RIG-35' })).toHaveAttribute('href', '/mico-ai?chat=c9&task=t35');
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Changes made: 1 done.'));
    expect(screen.getByRole('button', { name: /^Undo/ })).toBeInTheDocument();
  });

  it('Undo refused by the server (its 15 minutes are up) says why on the card, and the card is read again', async () => {
    chats = [{ ...chat(), messages: [chat().messages[0]!, card('done')] }];
    onCard = (kind, msg) => {
      if (kind !== 'undo') return;
      Object.assign(msg, card('done', { canUndo: false }));
      return json({ error: { code: 'UNDO_EXPIRED', message: 'Undo is only available for 15 minutes after confirming.' } }, 409);
    };
    renderPage('/mico-ai?chat=c9');
    await userEvent.click(await screen.findByRole('button', { name: /^Undo/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Undo is only available for 15 minutes after confirming.');
    await waitFor(() => expect(screen.queryByRole('button', { name: /^Undo/ })).not.toBeInTheDocument());
    expect(screen.getByText('Undo is no longer available.')).toBeInTheDocument();
  });

  it('Cancel closes the card', async () => {
    chats = [chat()];
    onCard = (kind, msg) => {
      if (kind === 'cancel') Object.assign(msg, card('proposed', { status: 'cancelled' }));
    };
    renderPage('/mico-ai?chat=c9');
    await userEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    expect(await screen.findByText('Cancelled — nothing was changed.')).toBeInTheDocument();
    expect(posted('/messages/a1/cancel')).toHaveLength(1);
  });
});
