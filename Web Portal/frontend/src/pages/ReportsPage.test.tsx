import { describe, it, expect, vi, beforeEach, afterEach, onTestFinished } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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
    if (/\.(csv|xlsx|pdf)(\?|$)/.test(u)) return new Response('bytes', { status: 200 });
    if (u.endsWith('/config')) return json({ data: { timeZone: 'Asia/Muscat', productName: '', companyName: '', serverTime: new Date().toISOString() } });
    if (u.includes('/reports/status')) return json({ data: { TODO: 4, DONE: 6 } });
    if (u.includes('/reports/workload')) return json({ data: [{ userId: 'u1', username: 'ada', assigned: 5, completed: 3, overdue: 1 }, { userId: 'u2', username: 'omar', name: 'Omar Ahmed', assigned: 2, completed: 2, overdue: 0 }] });
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
    await pick(/filter by team member/i, /Omar Ahmed/);

    for (const path of ['/reports/status', '/reports/completion', '/reports/projects', '/reports/workload', '/reports/timeseries']) {
      await waitFor(() => expect(urls.some((u) => u.includes(path) && u.includes('projectId=p1') && u.includes('userId=u2'))).toBe(true));
    }

    await pick(/report to export/i, /project performance/i);
    await userEvent.click(screen.getByRole('button', { name: /^CSV$/ }));
    await waitFor(() => expect(urls.some((u) => u.includes('/reports/projects.csv') && u.includes('projectId=p1') && u.includes('userId=u2'))).toBe(true));
  });

  it('names team members by their full name, else their username (as in the exports)', async () => {
    renderPage();
    await waitFor(() => expect(screen.getAllByText('Omar Ahmed').length).toBeGreaterThan(0));
    expect(screen.getAllByText('ada').length).toBeGreaterThan(0);
    await pick(/filter by team member/i, /Omar Ahmed/);
    await waitFor(() => expect(urls.some((u) => u.includes('/reports/status') && u.includes('userId=u2'))).toBe(true));
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

describe('ReportsPage date range typed by hand', () => {
  const trendCalls = () => urls.filter((u) => u.includes('/reports/timeseries'));

  it('keeps a half-typed date in the field and waits for a whole one before reloading', async () => {
    renderPage();
    await screen.findByLabelText('From date');
    await waitFor(() => expect(trendCalls().length).toBeGreaterThan(0));
    const from = screen.getByLabelText('From date');
    const before = trendCalls().length;

    // While a part of the date is being typed the browser reports an empty value: it must stay
    // empty (putting the old date back scrambles the digits typed next) and nothing reloads.
    fireEvent.change(from, { target: { value: '' } });
    expect(from).toHaveValue('');
    // A year still being typed ("0002") is a real date to the browser, not a period to report on.
    fireEvent.change(from, { target: { value: '0002-09-01' } });
    await new Promise((r) => setTimeout(r, 30));
    expect(trendCalls().length).toBe(before);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    fireEvent.change(from, { target: { value: '2026-09-01' } });
    await waitFor(() => expect(trendCalls().some((u) => u.includes('from=2026-09-01'))).toBe(true));
    expect(from).toHaveValue('2026-09-01');
  });

  it('says so when the start is after the end, and keeps showing the last good period', async () => {
    // The page opens on the last 30 days; this test's dates assume "today" is 21 Oct 2026.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-21T08:00:00Z'));
    onTestFinished(() => { vi.useRealTimers(); });
    renderPage();
    await screen.findByLabelText('From date');
    await waitFor(() => expect(trendCalls().length).toBeGreaterThan(0));
    fireEvent.change(screen.getByLabelText('To date'), { target: { value: '2026-09-23' } });
    await waitFor(() => expect(trendCalls().some((u) => u.includes('to=2026-09-23'))).toBe(true));

    fireEvent.change(screen.getByLabelText('From date'), { target: { value: '2026-09-28' } });
    expect(await screen.findByRole('alert')).toHaveTextContent(/start date.*on or before the end date/i);
    await new Promise((r) => setTimeout(r, 30));
    expect(trendCalls().some((u) => u.includes('from=2026-09-28'))).toBe(false);

    // Putting it right clears the message and loads the new period.
    fireEvent.change(screen.getByLabelText('From date'), { target: { value: '2026-09-20' } });
    await waitFor(() => expect(trendCalls().some((u) => u.includes('from=2026-09-20') && u.includes('to=2026-09-23'))).toBe(true));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('marks the chosen period for assistive tech, not by colour alone', async () => {
    renderPage();
    await screen.findByLabelText('From date');
    expect(screen.getByRole('button', { name: '30d' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: '7d' })).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(screen.getByRole('button', { name: '7d' }));
    expect(screen.getByRole('button', { name: '7d' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: '30d' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('a preset button puts the dates back in both fields', async () => {
    renderPage();
    await screen.findByLabelText('From date');
    await waitFor(() => expect(trendCalls().length).toBeGreaterThan(0));
    fireEvent.change(screen.getByLabelText('From date'), { target: { value: '' } });
    await userEvent.click(screen.getByRole('button', { name: '7d' }));
    expect(screen.getByLabelText('To date')).toHaveValue(todayKey('Asia/Muscat'));
    expect(screen.getByLabelText('From date')).not.toHaveValue('');
  });
});

describe('ReportsPage exports', () => {
  let downloads: string[];
  beforeEach(() => {
    downloads = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      downloads.push(this.download);
    });
  });

  it('exports the full report by default — Excel and PDF — with the filters and the trend period', async () => {
    renderPage();
    await waitFor(() => expect(screen.getAllByText('MICO360').length).toBeGreaterThan(0));
    await pick(/filter by project/i, /MICO360/);
    const today = todayKey('Asia/Muscat');
    await userEvent.click(screen.getByRole('button', { name: /^Excel$/ }));
    await waitFor(() => expect(urls.some((u) => u.includes('/reports/export.xlsx') && u.includes('projectId=p1') && u.includes(`to=${today}`) && u.includes('from='))).toBe(true));
    await waitFor(() => expect(downloads).toContain(`tasks-report-${today}.xlsx`));
    await userEvent.click(screen.getByRole('button', { name: /^PDF$/ }));
    await waitFor(() => expect(downloads).toContain(`tasks-report-${today}.pdf`));
  });

  it('saves the file under the name the server gives it (report + filters + day)', async () => {
    const base = fetch;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).includes('/reports/export.pdf')) {
        return new Response('%PDF', { status: 200, headers: { 'content-disposition': 'attachment; filename="tasks-report-mico360-2026-10-01.pdf"' } });
      }
      return base(url, init);
    }));
    renderPage();
    await waitFor(() => expect(screen.getAllByText('MICO360').length).toBeGreaterThan(0));
    await userEvent.click(screen.getByRole('button', { name: /^PDF$/ }));
    await waitFor(() => expect(downloads).toContain('tasks-report-mico360-2026-10-01.pdf'));
  });

  it('offers CSV only for a single report', async () => {
    renderPage();
    await waitFor(() => expect(screen.getAllByText('MICO360').length).toBeGreaterThan(0));
    expect(screen.getByRole('button', { name: /^CSV$/ })).toBeDisabled();
    await pick(/report to export/i, /employee workload/i);
    expect(screen.getByRole('button', { name: /^CSV$/ })).toBeEnabled();
    await userEvent.click(screen.getByRole('button', { name: /^Excel$/ }));
    await waitFor(() => expect(urls.some((u) => u.includes('/reports/workload.xlsx'))).toBe(true));
  });
});
