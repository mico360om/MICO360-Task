import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MyTasksPage } from './MyTasksPage';

// tgc: 1.24 — external contacts are guests now: each task says "Guest: …" (from the rows' `guests`), and the
// "External company" filter became "Guest" (a person) and "Guest company"; Clear clears them.

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}
const task = (id: string, key: string, title: string, guests: unknown, externalSummary: unknown = null) => ({
  id, key, title, description: null, projectId: 'p1', columnId: 'c1', position: 0, priority: 'HIGH', startDate: null, dueDate: null, progress: 20, completedAt: null, createdAt: '', updatedAt: '', guests, externalSummary,
});
let tasks: unknown[] = [];

beforeEach(() => {
  localStorage.clear();
  tasks = [
    task('t1', 'MICO-1', 'Rig inspection', [{ id: 'g1', name: 'Ahmed Al Said', company: 'Acme' }]),
    task('t2', 'MICO-2', 'Pipeline survey', [
      { id: 'g2', name: 'Salim', company: 'NWT' },
      { id: 'g3', name: 'Ali', company: null },
      { id: 'g4', name: 'Huda', company: 'acme' },
    ]),
    task('t3', 'MICO-3', 'Internal only', []),
  ];
  vi.stubGlobal('fetch', vi.fn(async (url: string) => (String(url).includes('/tasks/mine') ? json({ data: tasks }) : json({ data: [] }))));
});
afterEach(() => vi.restoreAllMocks());

function renderPage() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <MyTasksPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('My Tasks: guests', () => {
  it('each task says who outside the company is named on it', async () => {
    renderPage();
    expect(await screen.findByText('Guest: Ahmed Al Said (Acme)')).toBeInTheDocument();
    expect(screen.getByText('Guest: Salim (NWT) and 2 more')).toBeInTheDocument();
    expect(screen.queryByText(/^External:/)).toBeNull();
  });

  it('…and in the list view too; an older server’s rows (contacts in short) the same way', async () => {
    tasks = [task('t1', 'MICO-1', 'Rig inspection', undefined, { count: 2, name: 'Ahmed Al Said', company: 'Acme', names: ['Ahmed Al Said', 'Sara'], companies: ['Acme'] })];
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'List view' }));
    expect(await screen.findByText('Guest: Ahmed Al Said (Acme) and 1 more')).toBeInTheDocument();
  });

  it('filters by guest company (case aside)', async () => {
    renderPage();
    await screen.findByText('Rig inspection');
    expect(screen.queryByRole('button', { name: 'Filter by external company' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Filter by guest company' }));
    await userEvent.click(await screen.findByRole('option', { name: 'NWT' }));
    await waitFor(() => expect(screen.queryByText('Rig inspection')).toBeNull());
    expect(screen.getByText('Pipeline survey')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Filter by guest company' }));
    await userEvent.click(await screen.findByRole('option', { name: 'Acme' }));
    await waitFor(() => expect(screen.getByText('Rig inspection')).toBeInTheDocument());
    expect(screen.getByText('Pipeline survey')).toBeInTheDocument();
    expect(screen.queryByText('Internal only')).toBeNull();
  });

  it('filters by guest (a person); Clear brings every task back', async () => {
    renderPage();
    await screen.findByText('Rig inspection');
    await userEvent.click(screen.getByRole('button', { name: 'Filter by guest' }));
    await userEvent.click(await screen.findByRole('option', { name: 'Ali' }));
    await waitFor(() => expect(screen.queryByText('Rig inspection')).toBeNull());
    expect(screen.getByText('Pipeline survey')).toBeInTheDocument();
    expect(screen.getByText(/of 3/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Clear' }));
    await waitFor(() => expect(screen.getByText('Internal only')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Filter by guest' })).toHaveTextContent('Guest: Any guest');
  });
});
