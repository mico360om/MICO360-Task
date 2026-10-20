import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { CurrentProjectProvider, useCurrentProject, useCurrentProjectId } from './CurrentProject';
import { NewTaskModal } from './NewTaskModal';

/** A page that shows one project (or none). */
function Page({ projectId }: { projectId: string | null | undefined }) {
  useCurrentProject(projectId);
  return null;
}
function Reader() {
  return <output aria-label="current">{useCurrentProjectId() ?? 'none'}</output>;
}
const current = () => screen.getByLabelText('current');

describe('the current project', () => {
  it('is the project the open page shows, follows it when it changes, and is gone once the page closes', () => {
    const { rerender } = render(<CurrentProjectProvider><Page projectId="p2" /><Reader /></CurrentProjectProvider>);
    expect(current()).toHaveTextContent('p2');
    rerender(<CurrentProjectProvider><Page projectId="p1" /><Reader /></CurrentProjectProvider>);
    expect(current()).toHaveTextContent('p1');
    rerender(<CurrentProjectProvider><Reader /></CurrentProjectProvider>);
    expect(current()).toHaveTextContent('none');
  });

  it('is none on a page that shows no single project', () => {
    render(<CurrentProjectProvider><Page projectId={null} /><Page projectId="" /><Reader /></CurrentProjectProvider>);
    expect(current()).toHaveTextContent('none');
  });

  it('is none, without failing, outside the app shell', () => {
    render(<><Page projectId="p1" /><Reader /></>);
    expect(current()).toHaveTextContent('none');
  });
});

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}
const PROJECTS = [
  { id: 'p1', code: 'MICO', name: 'MICO360 Platform', status: 'ACTIVE', color: '#1E5A8B', icon: null, ownerId: null, clientName: null },
  { id: 'p2', code: 'OPS', name: 'Ops Board', status: 'ACTIVE', color: '#0F766E', icon: null, ownerId: null, clientName: null },
];

describe('New task, opened from a page that shows one project', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const u = String(url);
        const cols = /\/projects\/(p\d)\/columns/.exec(u);
        if (cols) return json({ data: [{ id: `${cols[1]}-todo`, projectId: cols[1], name: 'To Do', category: 'TODO', position: 0, color: '#000', enabled: true }] });
        if (u.endsWith('/projects')) return json({ data: PROJECTS });
        if (u.endsWith('/config')) return json({ data: { timeZone: 'Asia/Muscat', productName: 'x', companyName: 'y', serverTime: '' } });
        return json({ data: [] });
      }),
    );
  });
  afterEach(() => vi.restoreAllMocks());

  const open = (pageProject: string | null) =>
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <CurrentProjectProvider>
          <Page projectId={pageProject} />
          <NewTaskModal onClose={vi.fn()} />
        </CurrentProjectProvider>
      </QueryClientProvider>,
    );

  it('starts in that project, over the one used last time', async () => {
    localStorage.setItem('mico360.newTask.project', 'p1');
    open('p2');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Project' })).toHaveTextContent('Ops Board'));
  });

  it('starts in the project used last time on a page without one', async () => {
    localStorage.setItem('mico360.newTask.project', 'p2');
    open(null);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Project' })).toHaveTextContent('Ops Board'));
  });
});
