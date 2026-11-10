import { describe, it, expect, vi, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { SidebarBody } from './Sidebar';

// 1.23.6 The side menu's "Saved": the pinned saved searches (up to 5), each with its live count; the one
// the Search page shows is marked. Nothing pinned: no section.
function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}
const saved = (id: string, name: string, over: Record<string, unknown> = {}) => ({ id, name, q: 'overdue', filters: {}, owner: { id: 'me', name: 'Me' }, mine: true, shared: null, pinned: true, updatedAt: '2026-11-07T08:00:00.000Z', ...over });
function setup(list: unknown, at = '/dashboard') {
  const asked: string[] = [];
  vi.stubGlobal('fetch', vi.fn((url: string) => {
    const u = String(url);
    asked.push(u);
    if (u.endsWith('/search/saved')) return Promise.resolve(json({ data: list }));
    if (u.includes('/search/saved/counts')) return Promise.resolve(json({ data: { s1: { total: 7, capped: false }, s2: { total: 1200, capped: true } } }));
    return Promise.resolve(json({ data: [] }));
  }));
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[at]}>
        <SidebarBody isAdmin={false} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return asked;
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Sidebar — Saved (1.23.6)', () => {
  it('lists the pinned searches in order, each with how many it finds', async () => {
    const asked = setup({ mine: [saved('s1', 'Overdue of mine'), saved('s9', 'Not pinned', { pinned: false })], shared: [saved('s2', 'Team late', { mine: false, filters: { type: 'task' } })], pinned: ['s2', 's1'] });
    const one = await screen.findByRole('link', { name: 'Overdue of mine, 7 results' });
    expect(one).toHaveAttribute('href', '/search?q=overdue');
    const group = one.closest('[data-saved-nav]') as HTMLElement;
    expect(within(group).getAllByRole('link').map((a) => a.getAttribute('aria-label'))).toEqual(['Team late, 1000+ results', 'Overdue of mine, 7 results']);
    expect(screen.queryByText('Not pinned')).toBeNull();
    expect(screen.getByText('Saved')).toBeInTheDocument();
    expect(asked.some((u) => u.includes('/search/saved/counts?ids=s2%2Cs1'))).toBe(true);
  });

  it('the one shown on the Search page is the current page', async () => {
    setup({ mine: [saved('s1', 'Overdue of mine')], shared: [], pinned: ['s1'] }, '/search?q=overdue');
    expect(await screen.findByRole('link', { name: /Overdue of mine/ })).toHaveAttribute('aria-current', 'page');
  });

  it('nothing pinned: no Saved section', async () => {
    setup({ mine: [saved('s1', 'Overdue of mine', { pinned: false })], shared: [], pinned: [] });
    await screen.findByRole('link', { name: 'Dashboard' });
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByText('Saved')).toBeNull();
  });
});

describe('Saved on the folded menu (1.23.8 review)', () => {
  it('the fly-out marks only the search shown on the Search page as the current one', async () => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: /max-width/.test(q) && /48em/.test(q), media: q, addEventListener: () => {}, removeEventListener: () => {} }));
    const list = { mine: [saved('s1', 'Overdue of mine'), saved('s3', 'Blocked work', { q: 'blocked' })], shared: [], pinned: ['s1', 's3'] };
    vi.stubGlobal('fetch', vi.fn((url: string) => Promise.resolve(json({ data: String(url).endsWith('/search/saved') ? list : String(url).includes('/counts') ? {} : [] }))));
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={['/search?q=overdue']}>
          <SidebarBody isAdmin={false} rail />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const { default: userEvent } = await import('@testing-library/user-event');
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Saved' }));
    const menu = screen.getByRole('menu', { name: 'Saved' });
    expect(within(menu).getByRole('menuitem', { name: /Overdue of mine/ })).toHaveAttribute('aria-current', 'page');
    expect(within(menu).getByRole('menuitem', { name: /Blocked work/ })).not.toHaveAttribute('aria-current');
  });
});
