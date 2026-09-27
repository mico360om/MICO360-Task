import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AuditPage, AUDIT_PAGE_SIZE, summarizeChange } from './AuditPage';

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}
const entry = (over: Record<string, unknown> = {}) => ({
  id: 'a1', userId: 'admin', action: 'USER_CREATED', module: 'users', entityId: 'u9', oldValue: null, newValue: null, ip: '10.0.0.7', createdAt: '2026-06-15T12:00:00Z', ...over,
});

let urls: string[];
let pages: (url: string) => unknown[];
beforeEach(() => {
  urls = [];
  pages = () => [entry()];
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const u = String(url);
    urls.push(u);
    if (u.endsWith('/users/directory')) return json({ data: [{ id: 'admin', username: 'root', firstName: 'Amal', lastName: 'Admin' }, { id: 'u2', username: 'omar', firstName: 'Omar', lastName: 'A' }] });
    if (u.endsWith('/config')) return json({ data: { timeZone: 'Asia/Muscat', productName: '', companyName: '', serverTime: new Date().toISOString() } });
    return json({ data: pages(u) });
  }));
});
afterEach(() => vi.restoreAllMocks());

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <AuditPage />
    </QueryClientProvider>,
  );
}

describe('AuditPage', () => {
  it('renders audit entries from the API', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('USER_CREATED')).toBeInTheDocument());
  });

  it('shows who did it, their IP and what changed (WEB-15)', async () => {
    pages = () => [entry({ action: 'USER_UPDATED', oldValue: { status: 'ACTIVE', passwordHash: 'x1' }, newValue: { status: 'SUSPENDED', passwordHash: 'x2' } })];
    renderPage();
    await waitFor(() => expect(screen.getByText('Amal Admin')).toBeInTheDocument());
    expect(screen.getByText('10.0.0.7')).toBeInTheDocument();
    expect(screen.getByText('status: ACTIVE → SUSPENDED')).toBeInTheDocument();
    expect(screen.getByText('passwordHash: •••• → ••••')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/x1|x2/);
  });

  it('pages back through older entries with ?before= (WEB-15)', async () => {
    const first = Array.from({ length: AUDIT_PAGE_SIZE }, (_, i) =>
      entry({ id: `n${i}`, action: `NEW_${i}`, createdAt: new Date(Date.parse('2026-06-15T12:00:00Z') - i * 60_000).toISOString() }),
    );
    pages = (u) => (u.includes('before=') ? [entry({ id: 'old', action: 'VERY_OLD', createdAt: '2026-01-01T00:00:00Z' })] : first);
    renderPage();
    await waitFor(() => expect(screen.getByText('NEW_0')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: /load older entries/i }));
    await waitFor(() => expect(screen.getByText('VERY_OLD')).toBeInTheDocument());
    const older = urls.find((u) => u.includes('before='))!;
    expect(decodeURIComponent(older)).toContain(`before=${first[AUDIT_PAGE_SIZE - 1]!.createdAt}`);
    await waitFor(() => expect(screen.queryByRole('button', { name: /load older entries/i })).not.toBeInTheDocument());
  });

  it('filters by user and sends the filter to the server (WEB-15)', async () => {
    pages = () => [entry({ id: 'a', userId: 'admin', action: 'BY_ADMIN' }), entry({ id: 'b', userId: 'u2', action: 'BY_OMAR' })];
    renderPage();
    await waitFor(() => expect(screen.getByText('BY_OMAR')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: /filter by user/i }));
    await userEvent.click(await screen.findByRole('option', { name: /omar a/i }));
    await waitFor(() => expect(screen.queryByText('BY_ADMIN')).not.toBeInTheDocument());
    expect(screen.getByText('BY_OMAR')).toBeInTheDocument();
    expect(urls.some((u) => u.includes('/audit-logs') && u.includes('userId=u2'))).toBe(true);
  });
});

describe('summarizeChange', () => {
  it('describes created, removed and primitive changes', () => {
    expect(summarizeChange(null, { name: 'Rig A' })).toEqual(['name: Rig A']);
    expect(summarizeChange({ name: 'Rig A' }, null)).toEqual(['name was Rig A']);
    expect(summarizeChange('TODO', 'DONE')).toEqual(['TODO → DONE']);
    expect(summarizeChange(null, null)).toEqual([]);
  });

  it('caps long change lists', () => {
    const before = { a: 1, b: 1, c: 1, d: 1, e: 1, f: 1 };
    const after = { a: 2, b: 2, c: 2, d: 2, e: 2, f: 2 };
    const lines = summarizeChange(before, after);
    expect(lines).toHaveLength(4);
    expect(lines[3]).toBe('+3 more');
  });
});
