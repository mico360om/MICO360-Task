import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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
/** What GET /audit-logs/modules answers (every module the whole log holds). */
let modules: string[];
beforeEach(() => {
  urls = [];
  pages = () => [entry()];
  modules = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const u = String(url);
    urls.push(u);
    if (u.endsWith('/users/directory')) return json({ data: [{ id: 'admin', username: 'root', firstName: 'Amal', lastName: 'Admin' }, { id: 'u2', username: 'omar', firstName: 'Omar', lastName: 'A' }] });
    if (u.endsWith('/config')) return json({ data: { timeZone: 'Asia/Muscat', productName: '', companyName: '', serverTime: new Date().toISOString() } });
    if (u.endsWith('/audit-logs/modules')) return json({ data: modules });
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

describe('AuditPage filters', () => {
  const auditCalls = () => urls.filter((u) => u.includes('/audit-logs'));

  it('keeps every module on offer after one is chosen', async () => {
    // The server only sends back the chosen module once the filter is on.
    pages = (u) => (u.includes('module=users') ? [entry({ id: 'a' })] : [entry({ id: 'a' }), entry({ id: 'b', module: 'projects' }), entry({ id: 'c', module: 'settings' })]);
    renderPage();
    await screen.findAllByText('users');
    await userEvent.click(screen.getByRole('button', { name: /filter by module/i }));
    await userEvent.click(await screen.findByRole('option', { name: 'users' }));
    await waitFor(() => expect(auditCalls().some((u) => u.includes('module=users'))).toBe(true));

    await userEvent.click(screen.getByRole('button', { name: /filter by module/i }));
    for (const name of ['All modules', 'projects', 'settings', 'users']) expect(await screen.findByRole('option', { name })).toBeInTheDocument();
  });

  it('offers every module the log holds, also those only in entries not loaded yet', async () => {
    // The newest page holds only "users" entries; "projects" and "ai" are further back.
    modules = ['ai', 'projects', 'users'];
    renderPage();
    await screen.findAllByText('users');
    await userEvent.click(screen.getByRole('button', { name: /filter by module/i }));
    for (const name of ['All modules', 'ai', 'projects', 'users']) expect(await screen.findByRole('option', { name })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('option', { name: 'projects' }));
    await waitFor(() => expect(auditCalls().some((u) => u.includes('module=projects'))).toBe(true));
  });

  it('without the module list (it failed to load), still offers the modules it has seen', async () => {
    pages = () => [entry({ id: 'a' }), entry({ id: 'b', module: 'settings' })];
    const plain = globalThis.fetch;
    vi.stubGlobal('fetch', vi.fn(async (url: string) => (String(url).endsWith('/audit-logs/modules') ? new Response('{}', { status: 500 }) : plain(url))));
    renderPage();
    await screen.findAllByText('settings');
    await userEvent.click(screen.getByRole('button', { name: /filter by module/i }));
    for (const name of ['All modules', 'settings', 'users']) expect(await screen.findByRole('option', { name })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('explains a start date after the end date instead of reporting a failed load', async () => {
    renderPage();
    await screen.findAllByText('users');
    fireEvent.change(screen.getByLabelText('To date'), { target: { value: '2026-10-02' } });
    await waitFor(() => expect(auditCalls().some((u) => u.includes('to=2026-10-02'))).toBe(true));
    fireEvent.change(screen.getByLabelText('From date'), { target: { value: '2026-10-03' } });

    expect(await screen.findByRole('alert')).toHaveTextContent(/start date.*on or before the end date/i);
    expect(screen.queryByText(/couldn’t load/i)).not.toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 30));
    expect(auditCalls().some((u) => u.includes('from=2026-10-03'))).toBe(false);
  });

  it('waits for a whole date before filtering (a half-typed year is not sent)', async () => {
    renderPage();
    await screen.findAllByText('users');
    const before = auditCalls().length;
    fireEvent.change(screen.getByLabelText('From date'), { target: { value: '0002-06-01' } });
    await new Promise((r) => setTimeout(r, 30));
    expect(auditCalls().length).toBe(before);
    fireEvent.change(screen.getByLabelText('From date'), { target: { value: '2026-06-01' } });
    await waitFor(() => expect(auditCalls().some((u) => u.includes('from=2026-06-01'))).toBe(true));
  });

  it('a failed load is not blamed on permissions', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes('/audit-logs')) return new Response(JSON.stringify({ error: { code: 'INTERNAL', message: 'x' } }), { status: 500, headers: { 'content-type': 'application/json' } });
      return json({ data: [] });
    }));
    renderPage();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/couldn’t load the audit log/i);
    expect(alert).not.toHaveTextContent(/admin only/i);
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
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
