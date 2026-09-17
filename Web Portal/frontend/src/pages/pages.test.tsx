import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { NotificationsPage } from './NotificationsPage';
import { ReportsPage } from './ReportsPage';
import { DashboardPage } from './DashboardPage';
import { ProjectDetailPage } from './ProjectDetailPage';
import { useAuthStore } from '../stores/auth-store';

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}
function renderWithQuery(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

afterEach(() => vi.restoreAllMocks());

describe('NotificationsPage', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ data: [{ id: 'n1', type: 'TASK_ASSIGNED', title: 'You were assigned a task', body: null, readAt: null, createdAt: '' }] })));
  });
  it('lists notifications from the API', async () => {
    renderWithQuery(<NotificationsPage />);
    await waitFor(() => expect(screen.getByText('You were assigned a task')).toBeInTheDocument());
  });
});

describe('ReportsPage', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const u = String(url);
      if (u.endsWith('/reports/status')) return json({ data: { TODO: 4, DONE: 6 } });
      if (u.endsWith('/reports/workload')) return json({ data: [{ userId: 'u1', username: 'ada', assigned: 5, completed: 3, overdue: 1 }] });
      if (u.endsWith('/reports/completion')) return json({ data: { total: 10, completed: 6, onTime: 4, late: 2, unclassified: 0, onTimeRate: 67 } });
      return json({ data: [{ projectId: 'p1', projectName: 'MICO360', total: 5, completed: 2, overdue: 1, completionPct: 40 }] });
    }));
  });
  it('renders a report dashboard: project progress, status, workload and on-time delivery', async () => {
    renderWithQuery(<ReportsPage />);
    await waitFor(() => expect(screen.getByText('MICO360')).toBeInTheDocument()); // project progress row
    expect(screen.getByText('40%')).toBeInTheDocument(); // its completion %
    expect(screen.getByText('Tasks by status')).toBeInTheDocument();
    expect(screen.getByText('On-time delivery')).toBeInTheDocument();
    expect(screen.getByText('Employee workload')).toBeInTheDocument();
    expect(screen.getAllByText('ada').length).toBeGreaterThan(0); // workload chart + table row
  });
});

describe('DashboardPage (admin)', () => {
  beforeEach(() => {
    useAuthStore.getState().setSession({ user: { id: 'u1', email: 'a@b.c', username: 'ada', roles: ['ADMIN'] }, accessToken: 'at', refreshToken: 'rt' });
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const u = String(url);
      if (u.endsWith('/reports/status')) return json({ data: { TODO: 4, DONE: 6 } });
      if (u.endsWith('/reports/projects')) return json({ data: [{ projectId: 'p1', projectName: 'MICO360', total: 10, completed: 6, overdue: 1, completionPct: 60 }] });
      if (u.endsWith('/tasks/mine')) return json({ data: [{ id: 't1', key: 'MICO-1', title: 'Mine', description: '', projectId: 'p1', columnId: 'c1', position: 0, priority: 'NORMAL', startDate: null, dueDate: null, progress: 0, completedAt: null, createdAt: '', updatedAt: '' }] });
      return json({ data: [{ id: 'p1', name: 'MICO360' }] }); // projects
    }));
  });
  afterEach(() => useAuthStore.getState().logout());

  it('shows admin stat tiles and the status + project charts', async () => {
    renderWithQuery(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByText('Tasks by status')).toBeInTheDocument());
    expect(screen.getByText('Project completion')).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByText('MICO360').length).toBeGreaterThan(0));
    expect(screen.getByText('DONE')).toBeInTheDocument(); // status chart label
    expect(screen.getByLabelText(/filter by project/i)).toBeInTheDocument();
  });
});

describe('ProjectDetailPage', () => {
  beforeEach(() => {
    useAuthStore.getState().setSession({ user: { id: 'u1', email: 'a@b.c', username: 'ada', roles: ['ADMIN'] }, accessToken: 'at', refreshToken: 'rt' });
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes('/members')) return json({ data: [{ id: 'u9', username: 'omar', email: 'o@x', firstName: 'Omar', lastName: 'A' }] });
      if (u.endsWith('/users')) return json({ data: [{ id: 'u9', username: 'omar', email: 'o@x', firstName: 'Omar', lastName: 'A' }, { id: 'u5', username: 'ada', email: 'a@x', firstName: 'Ada', lastName: 'L' }] });
      return json({ data: { id: 'p1', code: 'MICO', name: 'MICO Platform', description: 'Desc', clientName: null, status: 'ACTIVE', priority: 'HIGH', color: '#8B1E1E', createdAt: '', updatedAt: '' } });
    }));
  });
  afterEach(() => useAuthStore.getState().logout());

  it('shows the project and manages team members on the Team tab', async () => {
    render(
      <MemoryRouter initialEntries={['/projects/p1']}>
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
          <Routes>
            <Route path="/projects/:id" element={<ProjectDetailPage />} />
          </Routes>
        </QueryClientProvider>
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByText('MICO Platform')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('tab', { name: /team/i }));
    await waitFor(() => expect(screen.getByText('Omar A')).toBeInTheDocument());
    expect(screen.getByLabelText(/add a member/i)).toBeInTheDocument(); // admin can manage
  });
});

describe('ReportsPage exports', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ data: [{ projectId: 'p1', projectName: 'MICO360', total: 5, completed: 2, overdue: 1, completionPct: 40 }] })));
  });
  it('fetches the right export endpoint for each format button', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      const u = String(url);
      if (/\.(csv|xls|pdf)$/.test(u)) return new Response('export-bytes', { status: 200, headers: { 'content-type': 'application/octet-stream' } });
      if (u.endsWith('/reports/status')) return json({ data: { DONE: 6 } });
      if (u.endsWith('/reports/workload')) return json({ data: [] });
      if (u.endsWith('/reports/completion')) return json({ data: { total: 0, completed: 0, onTime: 0, late: 0, unclassified: 0, onTimeRate: 0 } });
      return json({ data: [{ projectId: 'p1', projectName: 'MICO360', total: 5, completed: 2, overdue: 1, completionPct: 40 }] });
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('URL', { ...URL, createObjectURL: () => 'blob:mock', revokeObjectURL: () => {} });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    renderWithQuery(<ReportsPage />);
    await waitFor(() => expect(screen.getByText('MICO360')).toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: /^CSV$/ }));
    await waitFor(() => expect(fetchMock.mock.calls.some((c) => String(c[0]).endsWith('/reports/projects.csv'))).toBe(true));

    await userEvent.click(screen.getByRole('button', { name: /^Excel$/ }));
    await waitFor(() => expect(fetchMock.mock.calls.some((c) => String(c[0]).endsWith('/reports/projects.xls'))).toBe(true));

    await userEvent.click(screen.getByRole('button', { name: /^PDF$/ }));
    await waitFor(() => expect(fetchMock.mock.calls.some((c) => String(c[0]).endsWith('/reports/projects.pdf'))).toBe(true));
  });
});
