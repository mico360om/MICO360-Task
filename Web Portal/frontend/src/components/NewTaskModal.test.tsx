import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NewTaskModal } from './NewTaskModal';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

let posted: { url: string; body: Record<string, unknown> } | null;
let assigned: Record<string, unknown> | null;

beforeEach(() => {
  posted = null;
  assigned = null;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      const method = init?.method ?? 'GET';
      if (u.includes('/projects/p1/columns')) {
        return json({
          data: [
            { id: 'c1', projectId: 'p1', name: 'To Do', category: 'TODO', position: 0, color: '#000', enabled: true },
            { id: 'c2', projectId: 'p1', name: 'Done', category: 'DONE', position: 1, color: '#000', enabled: true },
          ],
        });
      }
      if (u.includes('/projects/p1/members')) {
        return json({ data: [{ id: 'u9', username: 'omar', email: '', firstName: 'Omar', lastName: 'A' }] });
      }
      if (u.endsWith('/projects')) {
        return json({ data: [{ id: 'p1', code: 'MICO', name: 'MICO360', description: null, clientName: null, status: 'ACTIVE', priority: 'HIGH', color: '#000', createdAt: '', updatedAt: '' }] });
      }
      if (u.endsWith('/tasks') && method === 'POST') {
        posted = { url: u, body: JSON.parse(String(init?.body)) };
        return json({ data: { id: 't99', key: 'MICO-1', title: 'X', columnId: 'c1', projectId: 'p1' } }, 201);
      }
      if (u.includes('/assignees') && method === 'POST') {
        assigned = JSON.parse(String(init?.body));
        return json({ data: [] });
      }
      return json({ data: [] });
    }),
  );
});
afterEach(() => vi.restoreAllMocks());

function renderModal(props: Partial<{ onClose: () => void; onCreated: () => void }> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <NewTaskModal onClose={props.onClose ?? vi.fn()} onCreated={props.onCreated} />
    </QueryClientProvider>,
  );
}

describe('NewTaskModal', () => {
  it('creates a task in the selected project and column with chosen assignees', async () => {
    const onCreated = vi.fn();
    const onClose = vi.fn();
    renderModal({ onCreated, onClose });

    await waitFor(() => expect(screen.getByRole('button', { name: /^column$/i })).toHaveTextContent('To Do'));
    await userEvent.type(screen.getByLabelText(/task title/i), 'Ship it');
    await userEvent.click(screen.getByRole('checkbox', { name: 'Omar A' }));
    await userEvent.click(screen.getByRole('button', { name: /add task/i }));

    await waitFor(() => expect(posted).toBeTruthy());
    expect(posted!.body).toMatchObject({ projectId: 'p1', columnId: 'c1', title: 'Ship it' });
    await waitFor(() => expect(assigned).toEqual({ userIds: ['u9'] }));
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    expect(onClose).toHaveBeenCalled();
  });

  it('lets the user create in a different column', async () => {
    renderModal();
    await waitFor(() => expect(screen.getByRole('button', { name: /^column$/i })).toHaveTextContent('To Do'));
    await userEvent.click(screen.getByRole('button', { name: /^column$/i }));
    await userEvent.click(screen.getByRole('option', { name: 'Done' }));
    await userEvent.type(screen.getByLabelText(/task title/i), 'Done task');
    await userEvent.click(screen.getByRole('button', { name: /add task/i }));
    await waitFor(() => expect(posted).toBeTruthy());
    expect(posted!.body).toMatchObject({ columnId: 'c2', title: 'Done task' });
  });

  it('shows a hint when there are no projects', async () => {
    (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation(async (url: string) => {
      if (String(url).endsWith('/projects')) return json({ data: [] });
      return json({ data: [] });
    });
    renderModal();
    await waitFor(() => expect(screen.getByText(/create a project first/i)).toBeInTheDocument());
  });
});
