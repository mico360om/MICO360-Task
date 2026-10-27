import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MyTasksPage } from './MyTasksPage';

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}
beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => json({ data: [{ id: 't1', key: 'MICO-1', title: 'Prepare report', description: null, projectId: 'p1', columnId: 'c1', position: 0, priority: 'HIGH', startDate: null, dueDate: null, progress: 20, completedAt: null, createdAt: '', updatedAt: '' }] })));
});
afterEach(() => vi.restoreAllMocks());

describe('MyTasksPage', () => {
  it('lists the current user’s tasks from /tasks/mine', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MyTasksPage />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(screen.getByText('Prepare report')).toBeInTheDocument());
  });

  it('shows each task’s project with the project’s picture', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => String(url).endsWith('/projects')
      ? json({ data: [{ id: 'p1', code: 'MICO', name: 'MICO Platform', color: '#1E5A8B', icon: 'globe', status: 'ACTIVE' }] })
      : json({ data: [{ id: 't1', key: 'MICO-1', title: 'Prepare report', description: null, projectId: 'p1', columnId: 'c1', position: 0, priority: 'HIGH', startDate: null, dueDate: null, progress: 20, completedAt: null, createdAt: '', updatedAt: '' }] })));
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MyTasksPage />
      </QueryClientProvider>,
    );
    const label = (await screen.findAllByText('MICO Platform', { selector: '[title="MICO Platform"]' }))[0]!;
    expect(label.parentElement!.querySelector('[data-project-avatar="icon"]')).not.toBeNull();
  });

  it('opens the task details drawer when a card is clicked', async () => {
    const task = {
      id: 't1', key: 'FIN-2', title: 'Finance Automation: work item 2', description: null,
      projectId: 'p1', columnId: 'c1', position: 0, priority: 'URGENT',
      startDate: null, dueDate: '2026-09-06', progress: 40, completedAt: null,
      createdAt: '', updatedAt: '',
    };
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const u = String(url);
      calls.push(u);
      if (u.includes('/tasks/mine')) return json({ data: [task] });
      if (/\/tasks\/t1(\?|$)/.test(u)) return json({ data: task });
      if (u.includes('/dependencies')) return json({ data: { blockedBy: [], blocks: [] } });
      return json({ data: [] });
    }));

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <MyTasksPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    // The title is the control that opens the task (its hit area covers the whole card)…
    const open = await screen.findByRole('button', { name: 'Finance Automation: work item 2' });
    // …and the select checkbox is not nested inside another control, so assistive tech reaches both.
    for (const box of screen.getAllByRole('checkbox', { name: /^Select / })) {
      expect(box.closest('button, [role="button"]')).toBeNull();
    }
    fireEvent.click(open);
    // Clicking mounts TaskDrawerContainer, which fetches the single task by id —
    // this is the wiring that was missing (the card had no onClick / no drawer).
    await waitFor(() => expect(calls.some((u) => /\/tasks\/t1(\?|$)/.test(u))).toBe(true));
  });

  it('Space on a row checkbox selects the row instead of opening the task', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <MyTasksPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const box = await screen.findByRole('checkbox', { name: 'Select MICO-1' });
    box.focus();
    const { default: userEvent } = await import('@testing-library/user-event');
    await userEvent.keyboard(' ');
    expect(box).toBeChecked();
    expect(screen.getByText(/1 selected/i)).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: /task/i })).not.toBeInTheDocument();
  });

  it('says "Due today" (not overdue) for a task due today in the company time zone, and never flags done work', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-30T10:00:00Z')); // 14:00 Muscat
    try {
      const t = (id: string, extra: Record<string, unknown>) => ({ id, key: id.toUpperCase(), title: `Task ${id}`, description: null, projectId: 'p1', columnId: 'c1', position: 0, priority: 'HIGH', startDate: null, dueDate: null, progress: 0, completedAt: null, createdAt: '', updatedAt: '', ...extra });
      vi.stubGlobal('fetch', vi.fn(async (url: string) => {
        const u = String(url);
        if (u.endsWith('/config')) return json({ data: { timeZone: 'Asia/Muscat', productName: '', companyName: '', serverTime: '' } });
        if (u.includes('/tasks/mine')) return json({ data: [
          t('a', { dueDate: '2026-09-30T00:00:00.000Z' }),
          t('b', { dueDate: '2026-09-01T00:00:00.000Z', columnCategory: 'DONE' }),
        ] });
        return json({ data: [] });
      }));
      const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      render(
        <QueryClientProvider client={qc}>
          <MemoryRouter>
            <MyTasksPage />
          </MemoryRouter>
        </QueryClientProvider>,
      );
      expect(await screen.findByText('Due today')).toBeInTheDocument();
      expect(screen.queryByText(/overdue ·/i)).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('list view keeps the priority and due date on a phone, under the title', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <MyTasksPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await screen.findByRole('button', { name: 'Prepare report' });
    fireEvent.click(screen.getByRole('button', { name: /list view/i }));
    // The wide columns are hidden below sm; the same facts sit in a line of their own there.
    const title = await screen.findByRole('button', { name: 'Prepare report' });
    const phoneLine = title.parentElement!.querySelector('[data-phone-meta]');
    expect(phoneLine).not.toBeNull();
    expect(phoneLine).toHaveClass('sm:hidden');
    expect(phoneLine).toHaveTextContent(/high/i);
    expect(phoneLine).toHaveTextContent(/due/i);
  });

  describe('open and completed work', () => {
    const base = { description: null, projectId: 'p1', columnId: 'c1', position: 0, startDate: null, dueDate: null, progress: 0, createdAt: '', updatedAt: '' };
    const tasks = [
      { ...base, id: 't1', key: 'MICO-1', title: 'Open urgent job', priority: 'URGENT', columnCategory: 'IN_PROGRESS', completedAt: null },
      { ...base, id: 't2', key: 'MICO-2', title: 'Finished urgent job', priority: 'URGENT', columnCategory: 'DONE', completedAt: '2026-09-30T10:00:00Z', progress: 100 },
      { ...base, id: 't3', key: 'MICO-3', title: 'Open normal job', priority: 'NORMAL', columnCategory: 'TODO', completedAt: null },
    ];
    const show = async () => {
      vi.stubGlobal('fetch', vi.fn(async (url: string) => (String(url).includes('/tasks/mine') ? json({ data: tasks }) : json({ data: [] }))));
      const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      render(<QueryClientProvider client={qc}><MemoryRouter><MyTasksPage /></MemoryRouter></QueryClientProvider>);
      await screen.findByRole('button', { name: 'Open urgent job' });
    };
    const titles = () => ['Open urgent job', 'Finished urgent job', 'Open normal job'].filter((t) => screen.queryByRole('button', { name: t }));

    it('the Open chip shows unfinished work only, and is not lit until it is chosen', async () => {
      await show();
      const open = screen.getByRole('button', { name: /^Open\s*2$/ });
      expect(open).toHaveAttribute('aria-pressed', 'false');
      expect(screen.getByRole('button', { name: /^All\s*3$/ })).toHaveAttribute('aria-pressed', 'true');

      fireEvent.click(open);
      expect(titles()).toEqual(['Open urgent job', 'Open normal job']);
      expect(open).toHaveAttribute('aria-pressed', 'true');
      expect(screen.getByRole('button', { name: /^All\s*3$/ })).toHaveAttribute('aria-pressed', 'false');

      fireEvent.click(open); // pressing it again shows everything
      expect(titles()).toHaveLength(3);
    });

    it('the "Urgent open" view leaves out urgent work that is already finished', async () => {
      await show();
      fireEvent.click(screen.getByRole('button', { name: /urgent open/i }));
      expect(titles()).toEqual(['Open urgent job']);
    });
  });

  it('offers sorting on a phone too (it was hidden below tablet width)', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={qc}><MemoryRouter><MyTasksPage /></MemoryRouter></QueryClientProvider>);
    const sort = await screen.findByRole('button', { name: /sort tasks/i });
    for (let el: HTMLElement | null = sort; el && el !== document.body; el = el.parentElement) expect(el).not.toHaveClass('hidden');
  });

  it('offers Retry when the tasks cannot be loaded', async () => {
    let fail = true;
    const ok = fetch;
    vi.stubGlobal('fetch', vi.fn(async (...args: Parameters<typeof fetch>) =>
      fail && String(args[0]).includes('/tasks/mine')
        ? new Response(JSON.stringify({ error: { code: 'INTERNAL', message: 'Something went wrong.' } }), { status: 500, headers: { 'content-type': 'application/json' } })
        : ok(...args),
    ));
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <MyTasksPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t load your tasks.');
    fail = false;
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('checkbox', { name: 'Select MICO-1' })).toBeInTheDocument();
  });
});

describe('MyTasksPage: moving the selected tasks to another project', () => {
  it('“Move to project…” moves the selection in one go, then says how it went and clears it', async () => {
    const task = (id: string, key: string, title: string) => ({ id, key, title, description: null, projectId: 'p1', columnId: 'c1', columnCategory: 'TODO', position: 0, priority: 'HIGH', startDate: null, dueDate: null, progress: 0, completedAt: null, createdAt: '', updatedAt: '' });
    const projects = [
      { id: 'p1', code: 'RIG', name: 'Rig Inspection', status: 'ACTIVE', color: '#8B1E1E', icon: null, imageUrl: null },
      { id: 'p2', code: 'OPS', name: 'Operations', status: 'ACTIVE', color: '#1E5B8B', icon: null, imageUrl: null },
    ];
    let moved = false;
    const posts: { url: string; body: unknown }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      if (init?.method === 'POST') posts.push({ url: u, body: JSON.parse(String(init.body)) });
      if (u.endsWith('/projects')) return json({ data: projects });
      if (u.endsWith('/tasks/move-targets')) return json({ data: { managesAll: false, managedProjectIds: ['p1', 'p2'], projects } });
      if (u.endsWith('/tasks/move-preview')) {
        const p = (id: string, key: string, title: string, newKey: string) => ({ id, key, title, from: { id: 'p1', code: 'RIG', name: 'Rig Inspection' }, canMove: true, reason: null, newKey, currentCategory: 'TODO', columnId: 'o1', milestoneCleared: false, dueDate: null, repeat: null, outsiders: [] });
        return json({ data: { project: { ...projects[1], defaultDueToday: false }, columns: [{ id: 'o1', name: 'Next', category: 'TODO', position: 0, enabled: true }], outsiders: [], tasks: [p('t1', 'RIG-1', 'One', 'OPS-17'), p('t2', 'RIG-2', 'Two', 'OPS-18')] } });
      }
      if (u.endsWith('/tasks/move-to-project')) {
        moved = true;
        return json({ data: { results: [{ taskId: 't1', ok: true, to: { projectId: 'p2', name: 'Operations', key: 'OPS-17' } }, { taskId: 't2', ok: true, to: { projectId: 'p2', name: 'Operations', key: 'OPS-18' } }], moved: 2, failed: 0 } });
      }
      if (u.includes('/tasks/mine')) return json({ data: moved ? [] : [task('t1', 'RIG-1', 'One'), task('t2', 'RIG-2', 'Two')] });
      return json({ data: [] });
    }));
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter>
          <MyTasksPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await screen.findByText('One');
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select all tasks' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Move to project…' }));
    const dialog = await screen.findByRole('dialog', { name: 'Move 2 tasks to another project' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Project' }));
    await userEvent.click(await screen.findByRole('option', { name: /Operations/ }));
    await userEvent.click(await within(dialog).findByRole('button', { name: /^Move 2 tasks/ }));
    expect(await screen.findByText('Moved 2 tasks to Operations.')).toBeInTheDocument();
    expect(posts.find((p) => p.url.endsWith('/tasks/move-to-project'))?.body).toEqual({ taskIds: ['t1', 't2'], projectId: 'p2' });
    expect(screen.queryByRole('dialog', { name: 'Move 2 tasks to another project' })).not.toBeInTheDocument();
    expect(screen.queryByText(/selected$/)).not.toBeInTheDocument();
  });

  it('marks a check (a task that carries an inspection form) in the list and on cards', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => (String(url).includes('/tasks/mine')
      ? json({ data: [
        { id: 't1', key: 'RIG-1', title: 'Daily rig check', description: null, projectId: 'p1', columnId: 'c1', position: 0, priority: 'HIGH', startDate: null, dueDate: null, progress: 0, completedAt: null, createdAt: '', updatedAt: '', inspectionFormId: 'f1' },
        { id: 't2', key: 'RIG-2', title: 'Order parts', description: null, projectId: 'p1', columnId: 'c1', position: 1, priority: 'HIGH', startDate: null, dueDate: null, progress: 0, completedAt: null, createdAt: '', updatedAt: '' },
      ] })
      : json({ data: [] }))));
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter>
          <MyTasksPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await screen.findAllByText('Daily rig check');
    expect(screen.getAllByText('Inspection').length).toBeGreaterThan(0);
    for (const chip of screen.getAllByText('Inspection')) expect(chip.closest('[data-task-key]')?.getAttribute('data-task-key')).toBe('RIG-1');
  });
});
