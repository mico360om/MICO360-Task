import { describe, it, expect, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { MessageView, type MessageActions } from './MessageView';
import type { MicoAiMessage } from '../../api/mico-ai';

const proposalMessage: MicoAiMessage = {
  id: 'a1',
  role: 'assistant',
  status: 'done',
  text: 'Here is the task to create. Check it, then confirm.',
  createdAt: new Date().toISOString(),
  step: null,
  answer: {
    kind: 'proposal',
    unavailable: false,
    tables: [],
    sources: [],
    followUps: ['Anything else?'],
    options: [],
    proposal: {
      id: 'p1',
      status: 'proposed',
      note: null,
      sendInvites: true,
      hasMeetings: false,
      confirmedAt: null,
      undoUntil: null,
      canUndo: false,
      serverNow: new Date().toISOString(),
      items: [
        {
          id: 'c1',
          type: 'create_task',
          needs: [],
          problem: null,
          locked: false,
          warning: null,
          result: null,
          undo: null,
          fields: { title: 'Replace the gauge', projectId: 'p-rig', assigneeIds: [], due: null, priority: 'NORMAL', description: '' },
          labels: { project: 'Rig Inspection Portal', assignees: [] },
        },
      ],
    },
  },
};

function actions(): MessageActions {
  return {
    ask: vi.fn(),
    retry: vi.fn(),
    download: vi.fn(),
    report: vi.fn(),
    canAsk: true,
    proposal: { confirm: vi.fn(async () => null), cancel: vi.fn(async () => null), undo: vi.fn(async () => null), announce: vi.fn() },
  };
}

function renderMessage(m: MicoAiMessage, a = actions()) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ data: {} }), { status: 200, headers: { 'content-type': 'application/json' } })));
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <MessageView message={m} actions={a} latest />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return a;
}

describe('MICO AI message: a card of proposed changes', () => {
  it('shows MICO AI’s words, then the card; no PDF report or follow-ups for a card', async () => {
    const a = renderMessage(proposalMessage);
    expect(screen.getByText('Here is the task to create. Check it, then confirm.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '1 new task' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /PDF report/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Suggested follow-ups' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /^Confirm/ }));
    expect(a.proposal!.confirm).toHaveBeenCalledWith({ items: [{ id: 'c1', include: true }] });
  });

  it('a card without its actions wired is shown, but can’t be confirmed', () => {
    const a = actions();
    delete a.proposal;
    renderMessage(proposalMessage, a);
    expect(screen.getByRole('heading', { name: '1 new task' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Confirm/ })).toBeDisabled();
  });
});
