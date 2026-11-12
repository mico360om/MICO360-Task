import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import { ByCategoryCard, categoryBreakdown } from './ByCategoryCard';
import type { ApiTask } from '../../api/tasks';

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
const ELEC = { id: 'k1', name: 'Electrical', color: 'teal', retired: false };
const HSE = { id: 'k2', name: 'HSE', color: 'pink', retired: false };
const OLD = { id: 'k3', name: 'Civil', color: 'gold', retired: true };
const LIST = [
  { ...ELEC, projectId: 'p1', position: 0, retiredAt: null },
  { ...HSE, projectId: 'p1', position: 1, retiredAt: null },
  { ...OLD, projectId: 'p1', position: 2, retiredAt: '2026-11-01T00:00:00Z' },
  { id: 'k4', name: 'Piping', color: 'navy', retired: true, projectId: 'p1', position: 3, retiredAt: '2026-11-01T00:00:00Z' },
  { id: 'k5', name: 'Survey', color: 'lime', retired: false, projectId: 'p1', position: 4, retiredAt: null },
];
const task = (id: string, categories: unknown[], extra: Partial<ApiTask> = {}) =>
  ({ id, key: `P-${id}`, title: id, projectId: 'p1', columnId: 'c', columnCategory: 'TODO', completedAt: null, categories, ...extra }) as unknown as ApiTask;
const TASKS = [
  task('1', [ELEC, HSE]),
  task('2', [ELEC]),
  task('3', [OLD]),
  task('4', []),
  task('5', []),
  task('6', [HSE], { columnCategory: 'DONE' }),
  task('7', [ELEC], { completedAt: '2026-11-01T00:00:00Z' }),
];

let list: unknown = { requireCategory: false, canManage: true, categories: LIST };
beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => (String(url).includes('/projects/p1/categories') ? json({ data: list }) : json({ data: [] }))));
});
afterEach(() => vi.unstubAllGlobals());

const show = (tasks: ApiTask[] = TASKS, ready = true) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ByCategoryCard projectId="p1" tasks={tasks} ready={ready} />
    </QueryClientProvider>,
  );

describe('categoryBreakdown (1.24)', () => {
  it('open tasks per category, in the project’s order; a retired one only while open tasks have it; and “No category”', () => {
    const b = categoryBreakdown(TASKS, LIST);
    expect(b.rows.map((r) => [r.category.name, r.count])).toEqual([
      ['Electrical', 2],
      ['HSE', 1],
      ['Civil', 1],
      ['Survey', 0],
    ]);
    expect(b.none).toBe(2);
    expect(b.open).toBe(5);
  });

  it('without the project’s list (an older server), from the categories on the tasks', () => {
    const b = categoryBreakdown(TASKS, null);
    expect(b.rows.map((r) => [r.category.name, r.count])).toEqual([
      ['Civil', 1],
      ['Electrical', 2],
      ['HSE', 1],
    ]);
  });
});

describe('ByCategoryCard (1.24)', () => {
  it('“By category”: each chip with its count of open tasks, then “No category”', async () => {
    show();
    const card = await screen.findByRole('region', { name: 'By category' });
    const rows = await within(card).findAllByRole('listitem');
    expect(rows.map((r) => r.textContent)).toEqual(['Electrical2', 'HSE1', 'Civil1', 'Survey0', 'No category2']);
    expect(within(card).getByRole('img', { name: 'Category: Civil (retired)' })).toBeInTheDocument();
    expect(within(card).getByText(/open tasks/)).toHaveTextContent('5 open tasks');
  });

  it('hidden when the project has no categories', async () => {
    list = { requireCategory: false, canManage: true, categories: [] };
    show([task('1', []), task('2', [])]);
    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByRole('region', { name: 'By category' })).toBeNull();
    list = { requireCategory: false, canManage: true, categories: LIST };
  });
});
