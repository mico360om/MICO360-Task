import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useAuthStore } from '../stores/auth-store';
import { forgetLocalAppreciations } from '../components/appreciation/useMyAppreciations';
import { AppreciationsPage } from './AppreciationsPage';
import { MyAppreciationsPage } from './MyAppreciationsPage';
import type { ApiAppreciation, ApiManagedAppreciation } from '../api/appreciations';

// 1.24.1 Appreciation note: the manager sees the note in Scheduled & history (also one record opened from the
// bell notice), and the employee sees their own note in My appreciations.
const api = vi.hoisted(() => ({ me: vi.fn(), history: vi.fn(), list: vi.fn(), people: vi.fn(), templates: vi.fn(), accept: vi.fn(), closePopup: vi.fn() }));
vi.mock('../api/appreciations', async (orig) => ({ ...(await orig<typeof import('../api/appreciations')>()), appreciationsApi: () => api }));

const A: ApiAppreciation = {
  id: 'ap1', batchId: 'b1', title: 'Great Teamwork', message: 'Thank you, Sara Khan.', theme: 'ocean', icon: 'team', animation: 'none',
  day: '2026-11-18', startsAt: '2026-11-17T20:00:00.000Z', endsAt: '2026-11-18T20:00:00.000Z', status: 'ACCEPTED', acceptedAt: '2026-11-18T05:01:00.000Z',
  acceptNote: 'Thank you, Omar!\nIt means a lot.', popupClosedAt: null, sender: { id: 'u-omar', name: 'Omar Said' }, company: { name: 'Contoso', logoUrl: null },
};
const M = (over: Partial<ApiManagedAppreciation> = {}): ApiManagedAppreciation => ({
  ...A, recipient: { id: 'u-sara', name: 'Sara Khan' }, companyId: 'c1', templateId: null, templateName: null, createdAt: '2026-11-17T08:00:00.000Z', cancelledAt: null, rawMessage: 'Thank you, {name}.', ...over,
});

function Where() {
  const l = useLocation();
  const go = useNavigate();
  return (
    <>
      <p data-testid="where">{l.pathname + l.search}</p>
      <button type="button" data-testid="go-row" onClick={() => go('/admin/appreciations?tab=history&row=ap9')}>go</button>
    </>
  );
}
const show = (path: string) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/admin/appreciations" element={<><AppreciationsPage /><Where /></>} />
          <Route path="/appreciations/mine" element={<MyAppreciationsPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

beforeEach(() => {
  forgetLocalAppreciations();
  for (const f of Object.values(api)) f.mockReset();
  api.me.mockResolvedValue({ canManage: true, today: '2026-11-18', serverNow: '2026-11-18T05:00:00.000Z', live: [] });
  api.people.mockResolvedValue([]);
  api.templates.mockResolvedValue([]);
  useAuthStore.setState({ user: { id: 'u-omar', username: 'omar', email: 'omar@contoso.test', roles: ['EMPLOYEE'] } as never, isAuthenticated: true });
});
afterEach(() => useAuthStore.setState({ user: null, isAuthenticated: false } as never));

describe('the note in Scheduled & history', () => {
  it('shows the note under the row it belongs to (none without one)', async () => {
    api.list.mockResolvedValue({ total: 2, page: 1, pageSize: 50, rows: [M(), M({ id: 'ap2', recipient: { id: 'u-ali', name: 'Ali Noor' }, acceptNote: null })] });
    show('/admin/appreciations?tab=history');
    const list = await screen.findByRole('list', { name: 'Appreciations' });
    const rows = within(list).getAllByRole('listitem');
    expect(within(rows[0]!).getByText('Note from Sara Khan')).toBeInTheDocument();
    expect(rows[0]!.querySelector('[data-accept-note]')!.textContent).toContain('Thank you, Omar!\nIt means a lot.');
    expect(within(rows[1]!).queryByText(/Note from/)).not.toBeInTheDocument();
  });

  it('opened from the bell notice (?row=): only that record, with “Show all” back to the full list', async () => {
    api.list.mockResolvedValue({ total: 1, page: 1, pageSize: 50, rows: [M()] });
    show('/admin/appreciations?tab=history&row=ap1');
    await screen.findByText('Note from Sara Khan');
    expect(api.list).toHaveBeenCalledWith(expect.objectContaining({ id: 'ap1' }));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Show all' })));
    await waitFor(() => expect(api.list).toHaveBeenLastCalledWith(expect.not.objectContaining({ id: 'ap1' })));
    expect(screen.getByTestId('where').textContent).toBe('/admin/appreciations?tab=history');
  });

  it('review fix: a notice opened while the history tab is already showing still opens its record', async () => {
    api.list.mockResolvedValue({ total: 1, page: 1, pageSize: 50, rows: [M()] });
    show('/admin/appreciations?tab=history');
    await screen.findByText('Note from Sara Khan');
    expect(api.list).toHaveBeenLastCalledWith(expect.not.objectContaining({ id: expect.anything() }));
    await act(async () => fireEvent.click(screen.getByTestId('go-row')));
    await waitFor(() => expect(api.list).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'ap9' })));
    expect(screen.getByRole('button', { name: 'Show all' })).toBeInTheDocument();
  });
});

describe('My appreciations', () => {
  it('shows the employee’s own note', async () => {
    api.history.mockResolvedValue([A, { ...A, id: 'ap2', acceptNote: null }]);
    show('/appreciations/mine');
    const items = await screen.findAllByRole('listitem');
    expect(within(items[0]!).getByText('Your note')).toBeInTheDocument();
    expect(items[0]!.querySelector('[data-accept-note]')!.textContent).toContain('It means a lot.');
    expect(within(items[1]!).queryByText('Your note')).not.toBeInTheDocument();
  });
});
