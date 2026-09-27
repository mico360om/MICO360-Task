import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReportsPage } from './ReportsPage';
import { todayKey } from '../lib/due-date';

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

let urls: string[];
beforeEach(() => {
  urls = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const u = String(url);
    urls.push(u);
    if (/\.(csv|xls|pdf)(\?|$)/.test(u)) return new Response('bytes', { status: 200 });
    if (u.endsWith('/config')) return json({ data: { timeZone: 'Asia/Muscat', productName: '', companyName: '', serverTime: new Date().toISOString() } });
    if (u.includes('/reports/status')) return json({ data: { TODO: 4, DONE: 6 } });
    if (u.includes('/reports/workload')) return json({ data: [{ userId: 'u1', username: 'ada', assigned: 5, completed: 3, overdue: 1 }, { userId: 'u2', username: 'omar', assigned: 2, completed: 2, overdue: 0 }] });
    if (u.includes('/reports/completion')) return json({ data: { total: 10, completed: 6, onTime: 4, late: 2, unclassified: 0, onTimeRate: 67 } });
    if (u.includes('/reports/timeseries')) return json({ data: { from: '', to: '', points: [], velocity: [], velocityPerWeek: 0 } });
    return json({ data: [
      { projectId: 'p1', projectName: 'MICO360', total: 5, completed: 2, overdue: 1, completionPct: 40 },
      { projectId: 'p2', projectName: 'Rig Portal', total: 3, completed: 3, overdue: 0, completionPct: 100 },
    ] });
  }));
  vi.stubGlobal('URL', { ...URL, createObjectURL: () => 'blob:mock', revokeObjectURL: () => {} });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ReportsPage />
    </QueryClientProvider>,
  );
}

async function pick(label: RegExp, option: RegExp) {
  await userEvent.click(screen.getByRole('button', { name: label }));
  await userEvent.click(await screen.findByRole('option', { name: option }));
}

describe('ReportsPage filters (RPT-01)', () => {
  it('passes the project and team filters to every chart, tile and export', async () => {
    renderPage();
    await waitFor(() => expect(screen.getAllByText('MICO360').length).toBeGreaterThan(0));
    await pick(/filter by project/i, /MICO360/);
    await pick(/filter by team member/i, /omar/);

    for (const path of ['/reports/status', '/reports/completion', '/reports/projects', '/reports/workload', '/reports/timeseries']) {
      await waitFor(() => expect(urls.some((u) => u.includes(path) && u.includes('projectId=p1') && u.includes('userId=u2'))).toBe(true));
    }

    await userEvent.click(screen.getByRole('button', { name: /^CSV$/ }));
    await waitFor(() => expect(urls.some((u) => u.includes('/reports/projects.csv') && u.includes('projectId=p1') && u.includes('userId=u2'))).toBe(true));
  });

  it('sends no filter params when nothing is filtered', async () => {
    renderPage();
    await waitFor(() => expect(screen.getAllByText('MICO360').length).toBeGreaterThan(0));
    expect(urls.some((u) => u.endsWith('/reports/status'))).toBe(true);
    expect(urls.some((u) => u.includes('/reports/') && (u.includes('projectId=') || u.includes('userId=')))).toBe(false);
  });
});

describe('ReportsPage dates (XP-03)', () => {
  it('anchors "today" and the default 30-day range to the company time zone', async () => {
    renderPage();
    await waitFor(() => expect(screen.getAllByText('MICO360').length).toBeGreaterThan(0));
    const today = todayKey('Asia/Muscat');
    expect(screen.getByLabelText('To date')).toHaveValue(today);
    expect(screen.getByLabelText('To date')).toHaveAttribute('max', today);
    await waitFor(() => expect(urls.some((u) => u.includes('/reports/timeseries') && u.includes(`to=${today}`))).toBe(true));
  });
});
