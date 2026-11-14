import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { card, detail, mine, moduleCard, moduleDetail, myTraining } from '../../components/training/training-fixtures';
import { MyTrainingPage } from './MyTrainingPage';

/** The staff training API, replaced (hoisted: the side and the queries take it when they load). */
const staff = vi.hoisted(() => ({
  access: vi.fn(),
  me: vi.fn(),
  course: vi.fn(),
  catalogue: vi.fn(),
  learn: vi.fn(),
  start: vi.fn(),
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
const notMine = { ...mine(), enrolled: false, assigned: false, mandatory: false, status: 'NOT_STARTED' as const, progressPct: 0, dueDay: null, nextLessonId: 'l1' };
const many = (n: number) => Array.from({ length: n }, (_, i) => card({ id: `m${i}`, title: `Course ${i + 1}`, mine: notMine }));

beforeEach(() => {
  for (const f of Object.values(staff)) f.mockReset();
  staff.access.mockResolvedValue(ACCESS);
  staff.me.mockResolvedValue(myTraining());
  staff.course.mockImplementation(async (id: string) => detail({ id }));
  staff.catalogue.mockResolvedValue({ courses: [card(), card({ id: 'c5', title: 'Reports for admins', summary: 'Read the reports.', moduleKey: 'reports', difficulty: 'ADVANCED', starter: false, rating: { average: null, count: 0 }, mine: notMine })] });
  staff.learn.mockResolvedValue({ courseId: null, module: 'training', count: 0 });
});

describe('My learning (12 Nov: Up next, To do, Done)', () => {
  it('Up next is the most urgent course, with Continue, its due date and how far along; To do and Done below; no count tiles', async () => {
    renderAt();
    expect(screen.getByRole('heading', { level: 1, name: 'Learning Hub' })).toBeInTheDocument();
    expect(within(screen.getByRole('navigation', { name: 'Learning Hub' })).getByRole('link', { name: 'My learning' })).toHaveAttribute('aria-current', 'page');
    const upNext = await screen.findByRole('region', { name: 'Up next' });
    expect(within(upNext).getByRole('heading', { name: 'Tasks basics' })).toBeInTheDocument();
    expect(within(upNext).getByText('Overdue · was due 4 Nov')).toBeInTheDocument();
    // How far along: the progress ring beside it (in lessons for a plain course), the time left and the due day.
    const progress = screen.getByRole('region', { name: 'Your progress' });
    expect(within(progress).getByRole('img', { name: '1 of 4 lessons done' })).toHaveTextContent('1 / 4');
    expect(await within(progress).findByText('About 20 min left')).toBeInTheDocument();
    expect(within(progress).getByText('Overdue · was due 4 Nov')).toBeInTheDocument();
    // Its lessons as tiles (the course read once, as its page reads it).
    expect(within(await screen.findByRole('region', { name: 'Your lessons' })).getAllByRole('listitem')).toHaveLength(4);
    expect(staff.course).toHaveBeenCalledWith('c1');
    // Other courses: the rest, nearest due day before started-without-a-due-day; each course once.
    const todo = screen.getByRole('region', { name: /^Other courses/ });
    expect(within(todo).getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual(['Meetings & minutes', 'Calendar tips']);
    expect(within(todo).getByText('Due 20 Nov')).toBeInTheDocument();
    // How far along, in lessons (R review: not a percentage); each row's own Start / Continue.
    expect(within(within(todo).getByRole('link', { name: 'Calendar tips' }).closest('li')!).getByText('1 of 4 lessons')).toBeInTheDocument();
    expect(within(todo).queryByText('60% done')).toBeNull();
    expect(within(todo).getByRole('link', { name: 'Start: Meetings & minutes' })).toHaveAttribute('href', '/training/courses/c2/lessons/l2');
    expect(within(todo).getByRole('link', { name: 'Continue: Calendar tips' })).toHaveAttribute('href', '/training/courses/c3/lessons/l2');
    // Done: its certificate on the card.
    const done = screen.getByRole('region', { name: /^Done/ });
    expect(within(done).getByRole('heading', { name: 'Kanban board' })).toBeInTheDocument();
    expect(within(within(done).getByRole('link', { name: 'Kanban board' }).closest('article')!).getByText('Done')).toBeInTheDocument();
    staff.certificatePdf.mockResolvedValue(new Blob(['%PDF']));
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:x');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    await userEvent.click(within(done).getByRole('button', { name: 'Certificate (PDF): Kanban board' }));
    await waitFor(() => expect(click).toHaveBeenCalled());
    expect(staff.certificatePdf).toHaveBeenCalledWith('cert1');
    // Gone: the four count tiles, the separate lists, the tour button (it is in the account menu now).
    expect(screen.queryByText(/^Assigned$/i)).toBeNull();
    expect(screen.queryByRole('heading', { name: /In progress|Certificates|Assigned to you/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /tour/i })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Older certificates' })).toBeNull();
    // Continue opens the lesson to do next.
    await userEvent.click(within(upNext).getByRole('link', { name: 'Continue' }));
    expect(screen.getByTestId('where')).toHaveTextContent('/training/courses/c1/lessons/l2');
  });

  it('Start (a course not started yet) starts it and opens its first lesson', async () => {
    staff.me.mockResolvedValue(myTraining({ assigned: [card({ id: 'c2', title: 'Meetings & minutes', mine: mine({ enrolled: false, status: 'NOT_STARTED', progressPct: 0, dueDay: '2026-11-20', nextLessonId: 'm1' }) })], inProgress: [], completed: [], certificates: [] }));
    staff.start.mockResolvedValue(detail({ id: 'c2', resumeLessonId: 'm1' }));
    renderAt();
    const upNext = await screen.findByRole('region', { name: 'Up next' });
    expect(within(upNext).getByText('Due 20 Nov')).toBeInTheDocument();
    expect(within(upNext).queryByRole('progressbar')).toBeNull();
    expect(screen.queryByRole('region', { name: /^Other courses/ })).toBeNull();
    await userEvent.click(within(upNext).getByRole('button', { name: 'Start' }));
    await waitFor(() => expect(staff.start).toHaveBeenCalledWith('c2'));
    expect(screen.getByTestId('where')).toHaveTextContent('/training/courses/c2/lessons/m1');
  });

  it('“Older certificates” only when a certificate has no Done card (expired, replaced, an archived course…)', async () => {
    const data = myTraining();
    staff.me.mockResolvedValue({ ...data, certificates: [...data.certificates, { id: 'cert0', code: 'TC-OLD0-OLD0-OLD0', courseId: 'gone', courseTitle: 'Safety induction', issuedAt: '2025-11-05T08:00:00.000Z', expiresAt: '2026-11-01T08:00:00.000Z', status: 'EXPIRED' }] });
    renderAt();
    const more = await screen.findByRole('button', { name: 'Older certificates' });
    expect(more).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(more);
    expect(more).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Safety induction')).toBeInTheDocument();
    expect(screen.getByText('Expired')).toBeInTheDocument();
  });

  it('1.23.34 nothing assigned or started: MICO360 Tasks User Training as Up next with Start — optional (no Mandatory, no due day); the ring, the tiles and the certificate card as usual; Start opens its first lesson', async () => {
    const fresh = mine({ enrolled: false, assigned: false, mandatory: false, status: 'NOT_STARTED', progressPct: 0, dueDay: null, lastLessonId: null, startedAt: null, lessonsDone: 0, nextLessonId: 'g1', modules: { done: 0, total: 3 }, next: { lessonId: 'g1', lessonTitle: 'Find your way around', moduleTitle: 'Getting started' } });
    const base = moduleDetail();
    const d = moduleDetail({
      mine: fresh,
      resumeLessonId: 'g1',
      lessons: base.lessons.map((l) => ({ ...l, done: false })),
      modules: base.modules.map((m) => ({ ...m, status: 'NOT_STARTED' as const, lessonsDone: 0, doneAt: null, nextLessonId: m.lessonIds[0]! })),
    });
    staff.me.mockResolvedValue(myTraining({ assigned: [], inProgress: [], completed: [], certificates: [], counts: { assigned: 0, inProgress: 0, notStarted: 0, completed: 0, overdue: 0, review: 0 }, suggested: moduleCard({ mine: fresh }) }));
    staff.course.mockResolvedValue(d);
    staff.start.mockResolvedValue({ ...d, mine: { ...fresh, enrolled: true, startedAt: '2026-11-14T08:00:00.000Z' } });
    renderAt();
    const upNext = await screen.findByRole('region', { name: 'Up next' });
    expect(screen.queryByText('Nothing to do right now')).toBeNull();
    expect(within(upNext).getByRole('link', { name: 'MICO360 Tasks User Training' })).toHaveAttribute('href', '/training/courses/u1');
    expect(await within(upNext).findByText('· Module 1 of 3')).toBeInTheDocument();
    expect(within(upNext).getByRole('heading', { name: 'Getting started', level: 3 })).toBeInTheDocument();
    expect(within(upNext).queryByText('Mandatory')).toBeNull();
    expect(within(upNext).queryByText(/^Due |Overdue/)).toBeNull();
    expect(screen.getByRole('region', { name: 'Your progress' })).toContainElement(screen.getByRole('img', { name: '0 of 3 modules done' }));
    expect(await screen.findByText('Finish 3 more modules to get it')).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: /^Module \d+:/ })).toHaveLength(3);
    expect(screen.queryByRole('region', { name: /^Other courses/ })).toBeNull();
    await userEvent.click(within(upNext).getByRole('button', { name: 'Start' }));
    await waitFor(() => expect(staff.start).toHaveBeenCalledWith('u1'));
    expect(screen.getByTestId('where')).toHaveTextContent('/training/courses/u1/lessons/g1');
  });

  it('1.23.34 offered again after an assignment was withdrawn part-way: Continue (it starts the course again first, then opens where they stopped)', async () => {
    const part = mine({ enrolled: false, assigned: false, mandatory: false, status: 'IN_PROGRESS', progressPct: 33, dueDay: null, lessonsDone: 3, nextLessonId: 't2', modules: { done: 1, total: 3 }, next: { lessonId: 't2', lessonTitle: 'Work on a task', moduleTitle: 'Tasks' } });
    staff.me.mockResolvedValue(myTraining({ assigned: [], inProgress: [], completed: [], certificates: [], suggested: moduleCard({ mine: part }) }));
    staff.course.mockResolvedValue(moduleDetail({ mine: part }));
    staff.start.mockResolvedValue(moduleDetail({ mine: { ...part, enrolled: true }, resumeLessonId: 't2' }));
    renderAt();
    const upNext = await screen.findByRole('region', { name: 'Up next' });
    expect(within(upNext).queryByRole('button', { name: 'Start' })).toBeNull();
    await userEvent.click(within(upNext).getByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(staff.start).toHaveBeenCalledWith('u1'));
    expect(screen.getByTestId('where')).toHaveTextContent('/training/courses/u1/lessons/t2');
  });

  it('1.23.34 an assigned course stays Up next; the offered course is not added beside it', async () => {
    staff.me.mockResolvedValue(myTraining({ inProgress: [], completed: [], certificates: [], suggested: moduleCard({ mine: mine({ enrolled: false, assigned: false, mandatory: false, status: 'NOT_STARTED', progressPct: 0, dueDay: null, lessonsDone: 0, modules: { done: 0, total: 3 } }) }) }));
    renderAt();
    const upNext = await screen.findByRole('region', { name: 'Up next' });
    expect(within(upNext).getByRole('link', { name: 'Tasks basics' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'MICO360 Tasks User Training' })).toBeNull();
  });

  it('nothing to do: one line and Browse all courses (no zero tiles)', async () => {
    staff.me.mockResolvedValue(myTraining({ assigned: [], inProgress: [], completed: [], certificates: [], counts: { assigned: 0, inProgress: 0, notStarted: 0, completed: 0, overdue: 0, review: 0 } }));
    renderAt();
    expect(await screen.findByText('Nothing to do right now')).toBeInTheDocument();
    expect(screen.queryByText('0')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Browse all courses' }));
    expect(within(screen.getByRole('navigation', { name: 'Learning Hub' })).getByRole('link', { name: 'All courses' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByTestId('where')).toHaveTextContent('/training?tab=catalogue');
  });

  it('done but nothing to do: “All done, well done” in place of Up next (Review), the Done list below', async () => {
    staff.me.mockResolvedValue(myTraining({ assigned: [], inProgress: [] }));
    renderAt();
    const finished = await screen.findByRole('region', { name: 'All done, well done' });
    expect(within(finished).getByRole('link', { name: 'Review' })).toHaveAttribute('href', '/training/courses/c4/lessons/l2');
    expect(screen.queryByText('Nothing to do right now')).toBeNull();
    expect(screen.getByRole('region', { name: /^Done/ })).toBeInTheDocument();
  });

  it('the subtitle: “Your training, one part at a time.”', async () => {
    renderAt();
    expect(screen.getByText('Your training, one part at a time.')).toBeInTheDocument();
    expect(screen.queryByText('Short courses on the parts of the site you use.')).toBeNull();
  });
});

describe('All courses (was Catalogue)', () => {
  it('slim cards: title, one-line summary, minutes, Mandatory, one chip — no Starter, Beginner, ratings, lesson count or module', async () => {
    renderAt('/training?tab=catalogue');
    expect(await screen.findByText('2 courses')).toBeInTheDocument();
    const first = screen.getByRole('link', { name: 'Tasks basics' }).closest('article')!;
    expect(within(first).getByText('25 min')).toBeInTheDocument();
    expect(within(first).getByText('Mandatory')).toBeInTheDocument();
    expect(within(first).getByText('Due 14 Nov')).toBeInTheDocument();
    for (const gone of ['Starter', 'Beginner', '4 lessons', '4.5 · 12 ratings', 'Tasks', 'Certificate']) expect(within(first).queryByText(gone)).toBeNull();
    expect(screen.getByRole('link', { name: 'Tasks basics' })).toHaveAttribute('href', '/training/courses/c1');
    const second = screen.getByRole('link', { name: 'Reports for admins' }).closest('article')!;
    expect(within(second).getByText('Advanced')).toBeInTheDocument();
    expect(within(second).queryByText('No ratings yet')).toBeNull();
    expect(within(second).queryByText('Mandatory')).toBeNull();
  });

  it('an h2 "Courses" (screen readers only) sits between the page h1 and the card h3s', async () => {
    renderAt('/training?tab=catalogue');
    await screen.findByText('2 courses');
    const h2 = screen.getByRole('heading', { level: 2, name: 'Courses' });
    expect(h2).toHaveClass('sr-only');
    expect(screen.getByText('2 courses').tagName).toBe('P');
  });

  it('8 courses or fewer: no Module filter; Difficulty only when the courses differ; search asks the server', async () => {
    renderAt('/training?tab=catalogue');
    await screen.findByText('2 courses');
    expect(screen.queryByLabelText('Module')).toBeNull();
    await userEvent.selectOptions(screen.getByLabelText('Difficulty'), 'ADVANCED');
    await waitFor(() => expect(staff.catalogue).toHaveBeenLastCalledWith({ module: '', difficulty: 'ADVANCED', q: '' }));
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search courses' }), 'report');
    await waitFor(() => expect(staff.catalogue).toHaveBeenLastCalledWith({ module: '', difficulty: 'ADVANCED', q: 'report' }));
    staff.catalogue.mockResolvedValue({ courses: [] });
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search courses' }), 'zzz');
    expect(await screen.findByText('No courses match.')).toBeInTheDocument();
  });

  it('more than 8 courses: the Module filter (without the Client portal’s), kept in the address and on the cards’ links', async () => {
    staff.catalogue.mockImplementation(async (f: { module?: string }) => ({ courses: f.module ? [card()] : [card(), ...many(8)] }));
    renderAt('/training?tab=catalogue');
    expect(await screen.findByText('9 courses')).toBeInTheDocument();
    expect(screen.queryByLabelText('Difficulty')).toBeNull();
    expect(within(screen.getByLabelText('Module')).queryByRole('option', { name: 'Client portal' })).toBeNull();
    await userEvent.selectOptions(screen.getByLabelText('Module'), 'tasks');
    await waitFor(() => expect(staff.catalogue).toHaveBeenLastCalledWith({ module: 'tasks', difficulty: '', q: '' }));
    expect(screen.getByTestId('where')).toHaveTextContent('/training?tab=catalogue&module=tasks');
    expect(await screen.findByText('1 course')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Tasks basics' })).toHaveAttribute('href', '/training/courses/c1?module=tasks');
  });

  it('R7: a Learn link’s module (?module=) still filters; without the Module filter it shows as a chip that clears it', async () => {
    staff.catalogue.mockImplementation(async (f: { module?: string }) => ({ courses: f.module ? [card({ id: 'c2', title: 'Meetings & minutes', moduleKey: 'meetings' })] : [card(), card({ id: 'c2', title: 'Meetings & minutes', moduleKey: 'meetings' })] }));
    renderAt('/training?tab=catalogue&module=meetings');
    await waitFor(() => expect(staff.catalogue).toHaveBeenCalledWith({ module: 'meetings', difficulty: '', q: '' }));
    expect(await screen.findByText('1 course')).toBeInTheDocument();
    expect(screen.queryByLabelText('Module')).toBeNull();
    const chip = screen.getByRole('button', { name: 'Show every module (now: Meetings & minutes)' });
    expect(chip).toHaveTextContent('Meetings & minutes');
    await userEvent.click(chip);
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent(/^\/training\?tab=catalogue$/));
    expect(await screen.findByText('2 courses')).toBeInTheDocument();
  });
});

describe('the tabs', () => {
  it('links: All courses opens the list, My learning comes back', async () => {
    renderAt();
    const tabs = screen.getByRole('navigation', { name: 'Learning Hub' });
    await userEvent.click(within(tabs).getByRole('link', { name: 'All courses' }));
    expect(await screen.findByText('2 courses')).toBeInTheDocument();
    await userEvent.click(within(tabs).getByRole('link', { name: 'My learning' }));
    expect(await screen.findByRole('region', { name: 'Up next' })).toBeInTheDocument();
    expect(screen.getByTestId('where')).toHaveTextContent(/^\/training$/);
  });

  it('Manage and Reports for managers; Reports alone for a project runner with team courses; neither for others', async () => {
    staff.access.mockResolvedValue({ ...ACCESS, manager: true });
    const a = renderAt();
    const tabs = () => screen.getByRole('navigation', { name: 'Learning Hub' });
    await waitFor(() => expect(within(tabs()).getAllByRole('link').map((l) => l.textContent)).toEqual(['My learning', 'All courses', 'Manage', 'Reports']));
    a.unmount();
    staff.access.mockResolvedValue({ ...ACCESS, teamReports: true });
    const b = renderAt();
    await waitFor(() => expect(within(tabs()).getAllByRole('link').map((l) => l.textContent)).toEqual(['My learning', 'All courses', 'Reports']));
    b.unmount();
    staff.access.mockResolvedValue(ACCESS);
    renderAt();
    await screen.findByRole('region', { name: 'Up next' });
    expect(within(tabs()).getAllByRole('link').map((l) => l.textContent)).toEqual(['My learning', 'All courses']);
  });
});
