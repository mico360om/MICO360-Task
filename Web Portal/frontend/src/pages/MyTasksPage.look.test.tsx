import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MyTasksPage } from './MyTasksPage';
import { useDensityStore } from '../lib/density';

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Muscat', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const shift = (key: string, days: number) => {
  const d = new Date(`${key}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
const task = (id: string, key: string, title: string, extra: Record<string, unknown> = {}) => ({
  id, key, title, description: null, projectId: 'p1', columnId: 'c1', columnCategory: 'IN_PROGRESS', position: 0, priority: 'NORMAL', startDate: null, dueDate: null, progress: 0, completedAt: null, createdAt: '', updatedAt: '', assignees: [], ...extra,
});

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const u = String(url);
      if (u.endsWith('/projects')) return json({ data: [{ id: 'p1', code: 'MICO', name: 'MICO Platform', color: '#1E5A8B', icon: null, status: 'ACTIVE' }] });
      if (u.includes('/tasks/mine'))
        return json({
          data: [
            task('t1', 'MICO-1', 'Late handover pack', { dueDate: shift(today, -3) }),
            task('t2', 'MICO-2', 'Due soon permit', { dueDate: shift(today, 1), columnCategory: 'REVIEW' }),
            task('t3', 'MICO-3', 'A very long title about the crane inspection and the permits that must be renewed before the pour', {
              description: '\n  Ask the crane company for the certificate.\nThen book the inspector.',
              tags: [{ id: 'g1', name: 'Safety', color: '#8B1E1E' }],
              counts: { comments: 0, attachments: 0, checklistDone: 2, checklistTotal: 5 },
              assignees: [{ id: 'u1', name: 'Ann Lee' }, { id: 'u2', name: 'Bo Chen' }, { id: 'u3', name: 'Cy Dee' }, { id: 'u4', name: 'Di Eve' }],
            }),
          ],
        });
      return json({ data: [] });
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  act(() => useDensityStore.getState().set('comfortable'));
});

const renderPage = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <MyTasksPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
/** The row or card of a task (its number chip carries the same data-task-key: the row is the one holding it). */
const rowOf = async (key: string) => {
  await screen.findAllByText(new RegExp(key));
  return [...document.querySelectorAll<HTMLElement>(`[data-task-key="${key}"]`)].find((el) => el.querySelector(`[data-task-key="${key}"]`))!;
};

describe('My Tasks in the one colour scheme (1.23.8)', () => {
  it('overdue: a red edge and red words; due tomorrow: amber words; statuses in their colours', async () => {
    renderPage();
    await userEvent.setup().click(await screen.findByRole('button', { name: 'List view' }));
    const late = await rowOf('MICO-1');
    expect(late.className).toContain('border-l-overdue');
    expect(late.querySelector('.text-overdue')).not.toBeNull();
    const soon = await rowOf('MICO-2');
    expect(soon.className).not.toContain('border-l-overdue');
    expect(soon.textContent).toContain('Due tomorrow');
    expect(soon.querySelector('.text-soon')).not.toBeNull();
    expect(soon.querySelector('[data-status="REVIEW"]')).toHaveClass('bg-status-review-soft');
  });

  it('the Overdue and Completed chips wear the overdue and Done colours', async () => {
    renderPage();
    const overdue = await screen.findByRole('button', { name: /^Overdue/ });
    expect(overdue.querySelector('span')).toHaveClass('bg-overdue');
    expect(screen.getByRole('button', { name: /^Completed/ }).querySelector('span')).toHaveClass('bg-status-done');
  });
});

describe('Detailed rows and cards on My Tasks (1.23.8)', () => {
  it('list: the whole title wraps, with the description’s first line, tags and everyone on it', async () => {
    act(() => useDensityStore.getState().set('detailed'));
    renderPage();
    await userEvent.setup().click(await screen.findByRole('button', { name: 'List view' }));
    const row = await rowOf('MICO-3');
    const title = row.querySelector('button[dir="auto"]')!;
    expect(title.className).not.toContain('truncate');
    expect(row.querySelector('[data-testid="card-description"]')).toHaveTextContent('Ask the crane company for the certificate.');
    expect(row.querySelector('[data-testid="card-tags"]')).toHaveTextContent('Safety');
    expect(row.querySelector('[data-testid="card-people"]')).toHaveTextContent('Ann Lee, Bo Chen, Cy Dee, Di Eve');
    // The checklist count too (review: the owner's Detailed list names it).
    expect(row.querySelector('[data-testid="card-checklist"]')).toHaveTextContent('2/5');
  });

  it('cards: the same', async () => {
    act(() => useDensityStore.getState().set('detailed'));
    renderPage();
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Grid view' }));
    const card = await rowOf('MICO-3');
    expect(card.querySelector('button[dir="auto"]')!.className).not.toContain('line-clamp-2');
    expect(card.querySelector('[data-testid="card-description"]')).toHaveTextContent('Ask the crane company for the certificate.');
    expect(card.querySelector('[data-testid="card-people"]')).toHaveTextContent('Ann Lee, Bo Chen, Cy Dee, Di Eve');
    expect(card.querySelector('[data-testid="card-checklist"]')).toHaveTextContent('2/5');
  });

  it('comfortable: none of that (the title is cut, its tooltip has it all)', async () => {
    renderPage();
    await userEvent.setup().click(await screen.findByRole('button', { name: 'List view' }));
    const row = await rowOf('MICO-3');
    expect(row.querySelector('button[dir="auto"]')!.className).toContain('truncate');
    await waitFor(() => expect(row.querySelector('[data-testid="card-description"]')).toBeNull());
    expect(row.querySelector('[data-testid="card-people"]')).toBeNull();
  });
});
