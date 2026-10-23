import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { MicoAiPage } from './MicoAiPage';
import { useAuthStore } from '../stores/auth-store';
import type { MicoAiMessage } from '../api/mico-ai';
import { shiftDayKey, todayKey } from '../lib/due-date';

// ── A small fake of the MICO AI API ──
interface FakeChat {
  id: string;
  title: string;
  lastMessageAt: string;
  messages: MicoAiMessage[];
}
let ready: boolean;
let chats: FakeChat[];
let calls: Array<{ method: string; url: string; body?: unknown }>;
/** What a pending answer becomes on the next poll. */
let next: Partial<MicoAiMessage> | null;
let seq: number;

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
      const m = /^\/mico-ai\/chats\/([^/]+)(?:\/messages(?:\/([^/]+)(\/stop|\/tables\/(\d+)\.(xlsx|pdf))?)?)?$/.exec(path);
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
        if (!messageId && method === 'GET') return json({ data: { chat: summary(c), messages: c.messages } });
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
  return <div data-testid="where">{`${loc.pathname}${loc.search}`}</div>;
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
    expect(screen.getByText('I answer from your tasks, projects, meetings and reports.')).toBeInTheDocument();
    for (const q of ['Which of my tasks are overdue?', 'Summarize this week’s meetings', 'Workload report for my team this week', 'What changed in Falcon CRM yesterday?']) {
      expect(screen.getByRole('button', { name: q })).toBeInTheDocument();
    }
  });

  it('says so before anyone types when AI isn’t set up', async () => {
    ready = false;
    renderPage();
    expect(await screen.findByText('MICO AI isn’t set up yet. An administrator can add the AI service in AI Management.')).toBeInTheDocument();
    await waitFor(() => expect(box()).toBeDisabled());
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

    next = tableAnswer;
    const table = await screen.findByRole('table', { name: 'Overdue tasks' });
    expect(within(table).getAllByRole('row').map((r) => r.textContent)).toEqual(['TaskTitleDueOverdue', 'RIG-14Pressure test reportMon 19 Oct5 days', 'RIG-9Valve inventory updateTue 20 Oct4 days']);
    expect(screen.getByText('2 tasks', { selector: 'strong' })).toBeInTheDocument();
    const sources = screen.getByRole('list', { name: 'Sources' });
    expect(within(sources).getByRole('link', { name: 'RIG-14' })).toHaveAttribute('href', '/mico-ai?chat=c1&task=t14');
    expect(within(sources).getByRole('link', { name: 'Rig Inspection Portal' })).toHaveAttribute('href', '/projects/p-rig');
    expect(screen.queryByRole('button', { name: 'Stop' })).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(/MICO AI answered/);

    await userEvent.click(screen.getByRole('button', { name: 'Download Overdue tasks as Excel' }));
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/tables/1.xlsx'))).toBe(true));
    await userEvent.click(screen.getByRole('button', { name: 'Download Overdue tasks as a PDF report' }));
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/tables/1.pdf'))).toBe(true));
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
