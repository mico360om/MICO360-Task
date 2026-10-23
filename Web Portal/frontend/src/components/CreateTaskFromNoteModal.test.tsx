import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CreateTaskFromNoteModal } from './CreateTaskFromNoteModal';
import { useAuthStore } from '../stores/auth-store';
import type { MeetingNote } from '../api/meetings';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const note: MeetingNote = {
  id: 'n1', meetingId: 'm1', agendaItemId: null, authorId: 'me', type: 'ACTION', body: 'Book the venue', highlighted: false,
  taskId: null, actionItemId: null, decisionId: null, createdAt: '2026-10-01T06:10:00.000Z', editedAt: null,
};

let created: Record<string, unknown>;
let projects: Record<string, unknown>[];

beforeEach(() => {
  projects = [{ id: 'p1', name: 'Falcon CRM', code: 'FAL' }];
  created = {
    task: { id: 't1', key: 'FAL-9', title: 'Book the venue', projectId: 'p1' },
    note: { ...note, taskId: 't1', actionItemId: 'ai1' },
    actionItem: { id: 'ai1', taskId: 't1', description: 'Book the venue' },
  };
  useAuthStore.getState().setSession({ user: { id: 'me', email: 'me@x', username: 'me', roles: ['EMPLOYEE'] }, accessToken: 'at', refreshToken: 'rt' });
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url);
    if (u.endsWith('/projects')) return json({ data: projects });
    if (u.endsWith('/notes/n1/task') && init?.method === 'POST') return json({ data: created }, 201);
    return json({ data: [] });
  }));
});
afterEach(() => {
  vi.restoreAllMocks();
  useAuthStore.setState({ user: null, accessToken: null, refreshToken: null, isAuthenticated: false });
});

function renderModal() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <CreateTaskFromNoteModal meetingId="m1" note={note} defaultProjectId="p1" onClose={() => {}} onCreated={() => {}} />
    </QueryClientProvider>,
  );
}

describe('CreateTaskFromNoteModal', () => {
  it('says an action note’s task is on the meeting’s action items too', async () => {
    renderModal();
    await userEvent.click(screen.getByRole('button', { name: /create task/i }));
    expect(await screen.findByText(/FAL-9/)).toBeInTheDocument();
    expect(screen.getByText(/also on the meeting’s action items/i)).toBeInTheDocument();
  });

  it('says so when the task was made but couldn’t be added to the action items', async () => {
    created = { ...created, actionItem: undefined, actionItemError: 'The task was created, but it couldn’t be added to the action items.' };
    renderModal();
    await userEvent.click(screen.getByRole('button', { name: /create task/i }));
    expect(await screen.findByText(/couldn’t be added to the action items/i)).toBeInTheDocument();
  });
});

describe('CreateTaskFromNoteModal — a project whose new tasks are due today', () => {
  it('says so next to an empty due date, and not once a date is picked', async () => {
    projects = [{ id: 'p1', name: 'Falcon CRM', code: 'FAL', defaultDueToday: true }];
    renderModal();
    const due = screen.getByLabelText(/^due date/i);
    await waitFor(() => expect(due).toHaveAccessibleDescription('Due today (this project’s setting)'));
    fireEvent.change(due, { target: { value: '2026-11-05' } });
    expect(screen.queryByText('Due today (this project’s setting)')).not.toBeInTheDocument();
  });

  it('says nothing for a project without the setting', async () => {
    renderModal();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Project' })).toHaveTextContent('Falcon CRM'));
    expect(screen.queryByText('Due today (this project’s setting)')).not.toBeInTheDocument();
  });
});
