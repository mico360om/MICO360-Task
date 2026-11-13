import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import { PageHeader, PageTitle } from '../ui/PageHeader';
import { learnTarget } from './LearnLink';

const staff = vi.hoisted(() => ({ learn: vi.fn() }));
vi.mock('../../api/training', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../api/training')>()), trainingApi: () => staff }));

let lastClient: QueryClient | null = null;

function renderHeader(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  lastClient = qc;
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  staff.learn.mockReset();
});

describe('Learn this feature', () => {
  it('one course for the module: its page (keeping the module for the way back)', async () => {
    staff.learn.mockResolvedValue({ courseId: 'c1', module: 'tasks', count: 1 });
    renderHeader(<PageHeader eyebrow="Workspace" title="My Tasks" learn="tasks" />);
    const link = await screen.findByRole('link', { name: 'Learn this feature' });
    expect(link).toHaveAttribute('href', '/training/courses/c1?module=tasks');
    expect(staff.learn).toHaveBeenCalledWith('tasks');
    // A book and the words (just "Learn" on a phone).
    expect(link.querySelector('svg')).not.toBeNull();
    expect(link).toHaveTextContent('Learn this feature');
  });

  it('the one course with modules: its page opened at the feature’s module', async () => {
    staff.learn.mockResolvedValue({ courseId: 'u1', moduleId: 'tk', module: 'tasks', count: 1 });
    renderHeader(<PageHeader eyebrow="Workspace" title="My Tasks" learn="tasks" />);
    expect(await screen.findByRole('link', { name: 'Learn this feature' })).toHaveAttribute('href', '/training/courses/u1?module=tasks&moduleId=tk');
  });

  it('several: the catalogue filtered to the module', async () => {
    staff.learn.mockResolvedValue({ courseId: 'c1', module: 'meetings', count: 3 });
    renderHeader(<PageTitle eyebrow="Workspace" title="Meetings" learn="meetings" />);
    expect(await screen.findByRole('link', { name: 'Learn this feature' })).toHaveAttribute('href', '/training?tab=catalogue&module=meetings');
  });

  it('hidden while it is asked, and when there is none', async () => {
    let answer: (v: unknown) => void = () => {};
    staff.learn.mockReturnValue(new Promise((r) => (answer = r)));
    renderHeader(<PageHeader title="Reports" learn="reports" />);
    expect(screen.queryByRole('link', { name: 'Learn this feature' })).toBeNull();
    await act(async () => answer({ courseId: null, module: 'reports', count: 0 }));
    expect(staff.learn).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('link', { name: 'Learn this feature' })).toBeNull();
  });

  it('hidden when the question fails', async () => {
    staff.learn.mockRejectedValue(new TypeError('offline'));
    renderHeader(<PageHeader title="Reports" learn="reports" />);
    await waitFor(() => expect(lastClient!.getQueryState(['training', 'learn', 'reports'])?.status).toBe('error'));
    expect(staff.learn).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('link', { name: 'Learn this feature' })).toBeNull();
  });

  it('one read per module, shared by every header that asks (kept 5 minutes)', async () => {
    staff.learn.mockResolvedValue({ courseId: 'c1', module: 'admin', count: 1 });
    renderHeader(
      <>
        <PageHeader title="Users" learn="admin" />
        <PageHeader title="Clients" learn="admin" />
      </>,
    );
    expect(await screen.findAllByRole('link', { name: 'Learn this feature' })).toHaveLength(2);
    expect(staff.learn).toHaveBeenCalledTimes(1);
  });

  it('no learn: no link and no question asked (the header as before)', () => {
    renderHeader(<PageHeader eyebrow="Admin" title="Audit Logs" />);
    expect(staff.learn).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { level: 1, name: 'Audit Logs' }).parentElement!.className).toMatch(/grid-cols-\[auto_auto_auto_minmax\(0,1fr\)\]/);
  });

  it('where it goes, in plain rules', () => {
    expect(learnTarget('/training', 'chat', { courseId: 'c9', count: 1 })).toBe('/training/courses/c9?module=chat');
    expect(learnTarget('/training', 'chat', { courseId: 'c9', count: 2 })).toBe('/training?tab=catalogue&module=chat');
    expect(learnTarget('/training', 'chat', { courseId: null, count: 0 })).toBeNull();
    expect(learnTarget('/training', 'chat', { courseId: 'u1', moduleId: 'ch', count: 1 })).toBe('/training/courses/u1?module=chat&moduleId=ch');
    expect(learnTarget('/training', 'chat', { courseId: 'u1', moduleId: null, count: 1 })).toBe('/training/courses/u1?module=chat');
  });
});
