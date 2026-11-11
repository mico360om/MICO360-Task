import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { card, myTraining } from '../../components/training/training-fixtures';
import { useTourStore } from '../../components/training/tour-store';
import { MyTrainingPage } from './MyTrainingPage';

/** The staff training API, replaced (hoisted: the side and the queries take it when they load). */
const staff = vi.hoisted(() => ({
  access: vi.fn(),
  me: vi.fn(),
  catalogue: vi.fn(),
  learn: vi.fn(),
  certificatePdf: vi.fn(),
}));
vi.mock('../../api/training', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../api/training')>()), trainingApi: () => staff }));

function Where() {
  const l = useLocation();
  return <div data-testid="where">{`${l.pathname}${l.search}`}</div>;
}

function renderAt(path = '/training') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/training" element={<MyTrainingPage />} />
          <Route path="*" element={<div>elsewhere</div>} />
        </Routes>
        <Where />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const ACCESS = { learner: true, manager: false, admin: false, teamReports: false, overdue: 1, assigned: 2, tour: { show: false } };

beforeEach(() => {
  for (const f of Object.values(staff)) f.mockReset();
  staff.access.mockResolvedValue(ACCESS);
  staff.me.mockResolvedValue(myTraining());
  staff.catalogue.mockResolvedValue({ courses: [card(), card({ id: 'c5', title: 'Reports for admins', moduleKey: 'reports', difficulty: 'ADVANCED', starter: false, rating: { average: null, count: 0 }, mine: { ...card().mine, enrolled: false, assigned: false, mandatory: false, status: 'NOT_STARTED', progressPct: 0, dueDay: null } })] });
  staff.learn.mockResolvedValue({ courseId: null, module: 'training', count: 0 });
  useTourStore.setState({ open: false, autoShown: false });
});

describe('Learning Hub: My learning and the catalogue', () => {
  it('counts, then assigned (overdue in red, due days), in progress with %, completed and certificates', async () => {
    renderAt();
    expect(screen.getByRole('heading', { level: 1, name: 'Learning Hub' })).toBeInTheDocument();
    const tabs = screen.getByRole('navigation', { name: 'Learning Hub' });
    expect(within(tabs).getByRole('link', { name: 'My learning' })).toHaveAttribute('aria-current', 'page');
    const assigned = (await screen.findByRole('heading', { name: /Assigned to you/ })).closest('section')!;
    const cards = within(assigned).getAllByRole('link');
    expect(cards.map((c) => c.querySelector('h3')?.textContent)).toEqual(['Tasks basics', 'Meetings & minutes']);
    expect(within(cards[0]!).getByText('Overdue')).toBeInTheDocument();
    expect(within(cards[0]!).getByText('Due 4 Nov')).toBeInTheDocument();
    expect(within(cards[0]!).getByText('Mandatory')).toBeInTheDocument();
    expect(cards[0]).toHaveAttribute('href', '/training/courses/c1');
    expect(within(cards[1]!).getByText('Due 20 Nov')).toBeInTheDocument();
    const progress = (screen.getByRole('heading', { name: /In progress \(1\)/ })).closest('section')!;
    expect(within(progress).getByRole('progressbar')).toHaveAttribute('aria-valuenow', '60');
    expect(screen.getByRole('heading', { name: /Completed \(1\)/ })).toBeInTheDocument();
    const certs = screen.getByRole('heading', { name: /Certificates/ }).closest('section')!;
    expect(within(certs).getByText('TC-ABCD-EFGH-JKLM')).toBeInTheDocument();
    staff.certificatePdf.mockResolvedValue(new Blob(['%PDF']));
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:x');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    await userEvent.click(within(certs).getByRole('button', { name: 'Download the certificate for Kanban board (PDF)' }));
    await waitFor(() => expect(click).toHaveBeenCalled());
    expect(staff.certificatePdf).toHaveBeenCalledWith('cert1');
  });

  it('nothing yet: says so, with the way to the catalogue', async () => {
    staff.me.mockResolvedValue(myTraining({ assigned: [], inProgress: [], completed: [], certificates: [], counts: { assigned: 0, inProgress: 0, notStarted: 0, completed: 0, overdue: 0, review: 0 } }));
    renderAt();
    expect(await screen.findByText('Nothing assigned to you yet.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Browse the catalogue' }));
    expect(within(screen.getByRole('navigation', { name: 'Learning Hub' })).getByRole('link', { name: 'Catalogue' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByTestId('where')).toHaveTextContent('/training?tab=catalogue');
  });

  it('the catalogue: cards with minutes, lessons, difficulty, Starter and rating; search and filters ask the server', async () => {
    renderAt('/training?tab=catalogue');
    const grid = await screen.findByText('2 courses');
    expect(grid).toBeInTheDocument();
    const first = screen.getByRole('link', { name: /Tasks basics/ });
    expect(within(first).getByText('25 min')).toBeInTheDocument();
    expect(within(first).getByText('4 lessons')).toBeInTheDocument();
    expect(within(first).getByText('Beginner')).toBeInTheDocument();
    expect(within(first).getByText('Starter')).toBeInTheDocument();
    expect(within(first).getByText('4.5 · 12 ratings')).toBeInTheDocument();
    expect(within(screen.getByRole('link', { name: /Reports for admins/ })).getByText('No ratings yet')).toBeInTheDocument();
    // The module filter: asked for, kept in the address, and the cards keep it for the way back.
    staff.catalogue.mockResolvedValue({ courses: [card()] });
    await userEvent.selectOptions(screen.getByLabelText('Module'), 'tasks');
    await waitFor(() => expect(staff.catalogue).toHaveBeenLastCalledWith({ module: 'tasks', difficulty: '', q: '' }));
    expect(screen.getByTestId('where')).toHaveTextContent('/training?tab=catalogue&module=tasks');
    expect(await screen.findByText('1 course')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Tasks basics/ })).toHaveAttribute('href', '/training/courses/c1?module=tasks');
    await userEvent.selectOptions(screen.getByLabelText('Difficulty'), 'BEGINNER');
    await waitFor(() => expect(staff.catalogue).toHaveBeenLastCalledWith({ module: 'tasks', difficulty: 'BEGINNER', q: '' }));
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search courses' }), 'assign');
    await waitFor(() => expect(staff.catalogue).toHaveBeenLastCalledWith({ module: 'tasks', difficulty: 'BEGINNER', q: 'assign' }));
    // The Client portal's courses aren't a staff filter.
    expect(within(screen.getByLabelText('Module')).queryByRole('option', { name: 'Client portal' })).toBeNull();
    staff.catalogue.mockResolvedValue({ courses: [] });
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search courses' }), 'zzz');
    expect(await screen.findByText('No courses match.')).toBeInTheDocument();
  });

  it('a Learn link (or a back link) opens the catalogue filtered to its module', async () => {
    renderAt('/training?tab=catalogue&module=meetings');
    await waitFor(() => expect(staff.catalogue).toHaveBeenCalledWith({ module: 'meetings', difficulty: '', q: '' }));
    expect(screen.getByLabelText('Module')).toHaveValue('meetings');
  });

  it('the tabs are links: Catalogue opens the catalogue, My learning comes back', async () => {
    renderAt();
    const tabs = screen.getByRole('navigation', { name: 'Learning Hub' });
    await userEvent.click(within(tabs).getByRole('link', { name: 'Catalogue' }));
    expect(await screen.findByText('2 courses')).toBeInTheDocument();
    await userEvent.click(within(tabs).getByRole('link', { name: 'My learning' }));
    expect(await screen.findByRole('heading', { name: /Assigned to you/ })).toBeInTheDocument();
    expect(screen.getByTestId('where')).toHaveTextContent(/^\/training$/);
  });

  it('Manage and Reports are tabs for managers; Reports alone for a project manager; neither for others (no separate buttons)', async () => {
    staff.access.mockResolvedValue({ ...ACCESS, manager: true });
    const a = renderAt();
    const tabs = () => screen.getByRole('navigation', { name: 'Learning Hub' });
    await waitFor(() => expect(within(tabs()).getAllByRole('link').map((l) => l.textContent)).toEqual(['My learning', 'Catalogue', 'Manage', 'Reports']));
    expect(screen.queryByRole('link', { name: /Training Center|Team training/ })).toBeNull();
    a.unmount();
    staff.access.mockResolvedValue({ ...ACCESS, teamReports: true });
    const b = renderAt();
    await waitFor(() => expect(within(tabs()).getAllByRole('link').map((l) => l.textContent)).toEqual(['My learning', 'Catalogue', 'Reports']));
    b.unmount();
    staff.access.mockResolvedValue(ACCESS);
    renderAt();
    await screen.findByRole('heading', { name: /Assigned to you/ });
    expect(within(tabs()).getAllByRole('link').map((l) => l.textContent)).toEqual(['My learning', 'Catalogue']);
  });

  it('“Take the tour” plays the tour again', async () => {
    renderAt();
    await userEvent.click(screen.getByRole('button', { name: 'Take the tour' }));
    expect(useTourStore.getState().open).toBe(true);
  });
});
