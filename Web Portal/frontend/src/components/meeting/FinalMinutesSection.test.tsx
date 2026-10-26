import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FinalMinutesSection } from './FinalMinutesSection';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const content = {
  summary: 'Progress was reviewed and go-live moved.',
  discussion: [{ topic: 'Go-live plan', text: 'The client needs time to test.' }],
  decisions: ['Go-live moves to 1 November.'],
  risks: ['Tablets may be late.'],
  nextSteps: ['Send the form — Bilal, by Oct 18'],
};
const none = { status: 'NONE', content: null, savedAt: null, approvedBy: null, approvedAt: null, canEdit: true };
const draft = { ...none, status: 'DRAFT', content, savedAt: '2026-10-14T08:00:00.000Z' };
const final = { ...draft, status: 'FINAL', approvedBy: { id: 'u1', name: 'Khurram' }, approvedAt: '2026-10-14T09:30:00.000Z' };

let current: Record<string, unknown>;
let calls: Array<{ method: string; path: string; body: unknown }>;
let answer: Record<string, () => Response>;

beforeEach(() => {
  current = none;
  calls = [];
  answer = {};
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const path = String(url).replace(/^.*\/api\/v1/, '');
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    calls.push({ method, path, body });
    const key = `${method} ${path}`;
    if (answer[key]) return answer[key]!();
    if (method === 'GET' && path === '/meetings/m1/final-minutes') return json({ data: current });
    return json({ data: current });
  }));
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function renderSection(canEdit = true) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <FinalMinutesSection meetingId="m1" meetingTitle="Weekly review" canEdit={canEdit} timeZone="Asia/Muscat" />
    </QueryClientProvider>,
  );
}
const section = () => screen.getByRole('region', { name: /final mom/i });

describe('Final minutes: writing them', () => {
  it('starts from an AI draft, which is edited and saved as a draft', async () => {
    answer['POST /meetings/m1/final-minutes/draft'] = () => json({ data: { content, source: 'ai' } });
    answer['PUT /meetings/m1/final-minutes'] = () => json({ data: { ...draft, content: { ...content, summary: 'Edited summary.' } } });
    renderSection();
    await userEvent.click(await screen.findByRole('button', { name: 'Draft with AI' }));
    expect(calls.find((c) => c.path.endsWith('/draft'))!.body).toEqual({ source: 'ai' });
    const summary = await screen.findByLabelText('Summary');
    expect(summary).toHaveValue(content.summary);
    expect(screen.getByLabelText('Topic 1')).toHaveValue('Go-live plan');
    expect(screen.getByLabelText('What was discussed under topic 1')).toHaveValue('The client needs time to test.');
    expect(screen.getByLabelText(/^Decisions/)).toHaveValue('Go-live moves to 1 November.');
    expect(screen.getByLabelText(/^Risks & open issues/)).toHaveValue('Tablets may be late.');
    expect(screen.getByLabelText(/^Next steps/)).toHaveValue('Send the form — Bilal, by Oct 18');

    await userEvent.clear(summary);
    await userEvent.type(summary, 'Edited summary.');
    await userEvent.type(screen.getByLabelText(/^Decisions/), '\nKeep the old forms until then.');
    await userEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true));
    expect(calls.find((c) => c.method === 'PUT')!.body).toEqual({
      content: { ...content, summary: 'Edited summary.', decisions: ['Go-live moves to 1 November.', 'Keep the old forms until then.'] },
    });
    expect(await within(section()).findByText(/draft saved/i)).toBeInTheDocument();
  });

  it('offers to start from the notes when the AI can’t draft them', async () => {
    answer['POST /meetings/m1/final-minutes/draft'] = () => {
      const last = calls[calls.length - 1]!;
      return (last.body as { source: string }).source === 'ai'
        ? json({ error: { code: 'VALIDATION', message: 'AI is not configured yet — an admin needs to add a provider and enable a chat model in AI Management.' } }, 400)
        : json({ data: { content, source: 'notes' } });
    };
    renderSection();
    await userEvent.click(await screen.findByRole('button', { name: 'Draft with AI' }));
    expect(await within(section()).findByRole('alert')).toHaveTextContent('AI is not configured yet');
    await userEvent.click(within(section()).getAllByRole('button', { name: 'Start from the notes' })[0]!);
    expect(await screen.findByLabelText('Summary')).toHaveValue(content.summary);
    expect(calls.filter((c) => c.path.endsWith('/draft')).map((c) => c.body)).toEqual([{ source: 'ai' }, { source: 'notes' }]);
  });

  it('asks before a new draft replaces what was written', async () => {
    current = draft;
    const ask = vi.fn(() => false);
    vi.stubGlobal('confirm', ask);
    renderSection();
    await userEvent.click(await screen.findByRole('button', { name: 'Redraft with AI' }));
    expect(ask).toHaveBeenCalled();
    expect(calls.some((c) => c.path.endsWith('/draft'))).toBe(false);
  });

  it('marks them final: they are then shown as approved, read-only, with the PDF and Reopen', async () => {
    current = draft;
    // The fake server keeps what was approved or reopened, as the real one does.
    answer['POST /meetings/m1/final-minutes/approve'] = () => json({ data: (current = final) });
    answer['POST /meetings/m1/final-minutes/reopen'] = () => json({ data: (current = draft) });
    renderSection();
    await userEvent.click(await screen.findByRole('button', { name: 'Mark as final' }));
    expect(calls.find((c) => c.path.endsWith('/approve'))!.body).toEqual({ content });
    expect(await within(section()).findByText(/approved by Khurram/i)).toBeInTheDocument();
    expect(within(section()).getByText('Progress was reviewed and go-live moved.')).toBeInTheDocument();
    expect(within(section()).getByText('Tablets may be late.')).toBeInTheDocument();
    expect(screen.queryByLabelText('Summary')).not.toBeInTheDocument();
    // One minutes PDF: it opens with the Final MOM once it is final.
    expect(within(section()).getByRole('button', { name: 'Download minutes (PDF)' })).toBeInTheDocument();
    await userEvent.click(within(section()).getByRole('button', { name: 'Reopen' }));
    expect(await screen.findByLabelText('Summary')).toHaveValue(content.summary);
  });
});

describe('Final minutes: for attendees', () => {
  it('says they aren’t ready while they are being written', async () => {
    current = { ...none, canEdit: false };
    renderSection(false);
    expect(await within(await screen.findByRole('region', { name: /final mom/i })).findByText(/aren’t ready yet/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Draft with AI' })).not.toBeInTheDocument();
  });

  it('shows the final minutes read-only, with the PDF but no Reopen', async () => {
    current = { ...final, canEdit: false };
    renderSection(false);
    expect(await within(await screen.findByRole('region', { name: /final mom/i })).findByText('Go-live moves to 1 November.')).toBeInTheDocument();
    expect(within(section()).getByRole('button', { name: 'Download minutes (PDF)' })).toBeInTheDocument();
    expect(within(section()).queryByRole('button', { name: 'Reopen' })).not.toBeInTheDocument();
  });
});

describe('Final minutes: shown to the project’s client', () => {
  const visibility = (over: Record<string, unknown> = {}) => ({ projectMeeting: true, approved: true, clientVisible: false, canChange: true, ...over });

  it('someone who runs the project can show approved minutes to the client, warned that they are shown as written', async () => {
    current = final;
    let shown = visibility();
    answer['GET /meetings/m1/client-visibility'] = () => json({ data: shown });
    answer['PUT /meetings/m1/client-visibility'] = () => {
      shown = visibility({ clientVisible: true });
      return json({ data: shown });
    };
    renderSection();
    const toggle = await within(await screen.findByRole('region', { name: /final mom/i })).findByRole('switch', { name: 'Show to client' });
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    expect(section()).toHaveTextContent(/as written/);
    await userEvent.click(toggle);
    expect(calls.find((c) => c.method === 'PUT' && c.path === '/meetings/m1/client-visibility')!.body).toEqual({ visible: true });
    await waitFor(() => expect(within(section()).getByRole('switch', { name: 'Show to client' })).toHaveAttribute('aria-checked', 'true'));
  });

  it('others see only that the minutes are visible to the client', async () => {
    current = { ...final, canEdit: false };
    answer['GET /meetings/m1/client-visibility'] = () => json({ data: visibility({ clientVisible: true, canChange: false }) });
    renderSection(false);
    expect(await within(await screen.findByRole('region', { name: /final mom/i })).findByText('Visible to client')).toBeInTheDocument();
    expect(within(section()).queryByRole('switch', { name: 'Show to client' })).toBeNull();
  });

  it('a standalone meeting has no client to show them to', async () => {
    current = final;
    answer['GET /meetings/m1/client-visibility'] = () => json({ data: visibility({ projectMeeting: false, canChange: false }) });
    renderSection();
    await within(await screen.findByRole('region', { name: /final mom/i })).findByText('Go-live moves to 1 November.');
    await waitFor(() => expect(calls.some((c) => c.path === '/meetings/m1/client-visibility')).toBe(true));
    expect(within(section()).queryByRole('switch', { name: 'Show to client' })).toBeNull();
  });

  it('reopening the minutes asks the server again (reopened minutes leave the client page)', async () => {
    current = final;
    answer['GET /meetings/m1/client-visibility'] = () => json({ data: visibility({ clientVisible: true }) });
    answer['POST /meetings/m1/final-minutes/reopen'] = () => json({ data: draft });
    renderSection();
    await userEvent.click(await within(await screen.findByRole('region', { name: /final mom/i })).findByRole('button', { name: 'Reopen' }));
    await waitFor(() => expect(calls.filter((c) => c.method === 'GET' && c.path === '/meetings/m1/client-visibility').length).toBeGreaterThanOrEqual(2));
  });
});
