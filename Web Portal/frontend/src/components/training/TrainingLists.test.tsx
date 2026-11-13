import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '../../lib/api-client';
import { CourseGrid, MyLearningSections } from './TrainingLists';
import { adminModuleDetail, card, certificate, detail, fakeLearner, mine, moduleCard, moduleDetail, myTraining, renderOnSide } from './training-fixtures';

const notStarted = mine({ enrolled: false, assigned: false, mandatory: false, status: 'NOT_STARTED', progressPct: 0, dueDay: null, lessonsDone: 0, nextLessonId: 'l1' });
const cardOf = (title: string) => screen.getByRole('link', { name: title }).closest('article')!;

describe('course cards (R1: a small Start / Continue / Review beside the whole-card link)', () => {
  it('each card: one link over the whole card and a separate action, never one inside the other', () => {
    const { container } = renderOnSide(
      <CourseGrid
        courses={[
          card({ id: 'c1', title: 'Tasks basics', lessonCount: 3, mine: { ...notStarted, nextLessonId: 'l1' } }),
          moduleCard({ mine: mine({ ...moduleCard().mine, modules: { done: 4, total: 8 } }) }),
          card({ id: 'c4', title: 'Kanban board', lessonCount: 4, mine: mine({ status: 'COMPLETED', progressPct: 100, dueDay: null, lessonsDone: 4, nextLessonId: 'l1', completedAt: '2026-11-05T08:00:00.000Z' }) }),
        ]}
      />,
      { api: fakeLearner() },
    );
    expect(container.querySelector('a button, button a, a a, button button')).toBeNull();
    // Not started: Start (a button: it starts the course first); "0 of 3 lessons".
    const first = cardOf('Tasks basics');
    expect(within(first).getByRole('button', { name: 'Start: Tasks basics' })).toHaveTextContent(/^Start$/);
    expect(within(first).getByText('0 of 3 lessons')).toBeInTheDocument();
    // Started: Continue goes where the card's next lesson is; "4 of 8 modules" for the one course.
    const one = cardOf('MICO360 Tasks User Training');
    expect(within(one).getByRole('link', { name: 'Continue: MICO360 Tasks User Training' })).toHaveAttribute('href', '/training/courses/u1/lessons/t2');
    expect(within(one).getByText('4 of 8 modules')).toBeInTheDocument();
    expect(within(one).getByRole('link', { name: 'MICO360 Tasks User Training' })).toHaveAttribute('href', '/training/courses/u1');
    // Done: Review.
    expect(within(cardOf('Kanban board')).getByRole('link', { name: 'Review: Kanban board' })).toHaveAttribute('href', '/training/courses/c4/lessons/l1');
    // The action sits above the card's stretched link.
    expect(within(first).getByRole('button', { name: 'Start: Tasks basics' }).closest('.relative.z-10')).not.toBeNull();
  });

  it('a finished course with no lesson to open still offers Review, to the course page', () => {
    renderOnSide(
      <CourseGrid courses={[card({ id: 'c9', title: 'Finished course', lessonCount: 3, mine: mine({ status: 'COMPLETED', progressPct: 100, dueDay: null, lessonsDone: 3, next: null, nextLessonId: null, completedAt: '2026-11-05T08:00:00.000Z' }) })]} />,
      { api: fakeLearner() },
    );
    expect(within(cardOf('Finished course')).getByRole('link', { name: 'Review: Finished course' })).toHaveAttribute('href', '/training/courses/c9');
  });

  it('a started card says how far along in lessons (not a percentage); New for your role when modules were added for them', () => {
    renderOnSide(
      <CourseGrid
        courses={[
          card({ id: 'c3', title: 'Calendar tips', lessonCount: 5, mine: mine({ dueDay: null, mandatory: false, lessonsDone: 3, progressPct: 60 }) }),
          moduleCard({ mine: mine({ ...moduleCard().mine, status: 'COMPLETED', progressPct: 100, completedAt: '2026-11-05T08:00:00.000Z', newForRole: 2, modules: { done: 6, total: 8 }, next: { lessonId: 'r1', lessonTitle: 'Read a report', moduleTitle: 'Reports' } }) }),
        ]}
      />,
      { api: fakeLearner() },
    );
    const cal = cardOf('Calendar tips');
    expect(within(cal).getByText('3 of 5 lessons')).toBeInTheDocument();
    expect(within(cal).queryByText('60% done')).toBeNull();
    const one = cardOf('MICO360 Tasks User Training');
    expect(within(one).getByText('New for your role: 2')).toBeInTheDocument();
    expect(within(one).getByText('Done')).toBeInTheDocument();
    // Finished, with new modules to do: Continue opens the first of them.
    expect(within(one).getByRole('link', { name: 'Continue: MICO360 Tasks User Training' })).toHaveAttribute('href', '/training/courses/u1/lessons/r1');
  });

  it('Start on a card starts the course, then opens its first lesson to take; a refusal is said on the card', async () => {
    const api = fakeLearner();
    renderOnSide(<CourseGrid courses={[card({ id: 'c1', title: 'Tasks basics', mine: notStarted }), card({ id: 'c2', title: 'Meetings & minutes', mine: notStarted })]} />, { api });
    api.start.mockResolvedValueOnce(detail({ id: 'c1', resumeLessonId: 'l1' }));
    await userEvent.click(screen.getByRole('button', { name: 'Start: Tasks basics' }));
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/training/courses/c1/lessons/l1'));
    expect(api.start).toHaveBeenCalledWith('c1');
    api.start.mockRejectedValueOnce(new ApiError(409, 'NOT_FOR_YOU', 'You can preview this course, but it isn’t one of yours to take.'));
    await userEvent.click(screen.getByRole('button', { name: 'Start: Meetings & minutes' }));
    expect(await within(cardOf('Meetings & minutes')).findByRole('alert')).toHaveTextContent('You can preview this course, but it isn’t one of yours to take.');
  });

  it('in the Client portal: the portal’s addresses', () => {
    renderOnSide(<CourseGrid courses={[card({ id: 'pc1', title: 'Client portal basics', moduleKey: 'portal', audience: 'CLIENTS' })]} />, { api: fakeLearner(), portal: true });
    expect(screen.getByRole('link', { name: 'Continue: Client portal basics' })).toHaveAttribute('href', '/portal/training/courses/pc1/lessons/l2');
  });
});

describe('My learning: the learning dashboard (13 Nov new look)', () => {
  const NESTED = 'a a, a button, button a, button button';
  const oneCourse = (over = {}) => moduleCard({ mine: mine({ ...moduleCard().mine, assigned: true, dueDay: '2026-12-13', ...over }) });
  const only = (c: ReturnType<typeof card>) => myTraining({ assigned: [c], inProgress: [], completed: [], certificates: [] });
  const tiles = () => within(screen.getByRole('region', { name: /^Your (modules|lessons)/ })).getAllByRole('listitem');

  it('Up next: “Module 2 of 3”, the module’s name and icon, the next lesson with its kind and minutes; Continue opens it', async () => {
    renderOnSide(<MyLearningSections data={only(oneCourse())} />, { api: fakeLearner({ course: vi.fn(async () => moduleDetail()) }) });
    const upNext = screen.getByRole('region', { name: 'Up next' });
    expect(await within(upNext).findByText('· Module 2 of 3')).toBeInTheDocument();
    expect(within(upNext).getByRole('heading', { level: 3, name: 'Tasks' })).toBeInTheDocument();
    expect(upNext.querySelector('[data-up-next-icon] svg')).toHaveAttribute('aria-hidden', 'true');
    expect(within(upNext).getByText(/^Next:/)).toHaveTextContent('Next: Work on a task · Step-by-step guide · 8 min');
    expect(within(upNext).getByRole('link', { name: 'MICO360 Tasks User Training' })).toHaveAttribute('href', '/training/courses/u1');
    expect(within(upNext).getByText('Due 13 Dec')).toBeInTheDocument();
    await userEvent.click(within(upNext).getByRole('link', { name: 'Continue' }));
    expect(screen.getByTestId('where')).toHaveTextContent('/training/courses/u1/lessons/t2');
  });

  it('progress beside it: the ring “1 / 3”, modules done, about how long is left and the due day', async () => {
    renderOnSide(<MyLearningSections data={only(oneCourse())} />, { api: fakeLearner({ course: vi.fn(async () => moduleDetail()) }) });
    const progress = screen.getByRole('region', { name: 'Your progress' });
    expect(within(progress).getByRole('img', { name: '1 of 3 modules done' })).toHaveTextContent('1 / 3');
    expect(within(progress).getByText('modules done')).toBeInTheDocument();
    expect(await within(progress).findByText('About 20 min left')).toBeInTheDocument();
    expect(within(progress).getByText('Due 13 Dec')).toBeInTheDocument();
  });

  it('Your modules: each of theirs as ONE link to it on the course page, the current one marked; the certificate card says what is left', async () => {
    const { container } = renderOnSide(<MyLearningSections data={only(oneCourse())} />, { api: fakeLearner({ course: vi.fn(async () => moduleDetail()) }) });
    const grid = await screen.findByRole('region', { name: 'Your modules' });
    expect(tiles()).toHaveLength(3);
    expect(container.querySelector(NESTED)).toBeNull();
    expect(within(grid).getByRole('link', { name: /^Module 1: Getting started, Done/ })).toHaveAttribute('href', '/training/courses/u1?moduleId=gs');
    expect(within(grid).getByRole('link', { name: 'Module 2: Tasks, 1 of 3 lessons, up next' })).toHaveAttribute('data-current', 'true');
    expect(within(grid).getByRole('link', { name: 'Module 3: Kanban board, Not started · 8 min' })).toHaveAttribute('href', '/training/courses/u1?moduleId=kb');
    expect(within(screen.getByRole('region', { name: 'Certificate' })).getByText('Finish 2 more modules to get it')).toBeInTheDocument();
  });

  it('hidden modules never appear or count: an employee has 3 tiles; an administrator also Reports and Admin settings', async () => {
    const a = renderOnSide(<MyLearningSections data={only(oneCourse())} />, { api: fakeLearner({ course: vi.fn(async () => moduleDetail()) }) });
    await screen.findByRole('region', { name: 'Your modules' });
    expect(screen.queryByRole('link', { name: /Reports|Admin settings/ })).toBeNull();
    a.unmount();
    renderOnSide(<MyLearningSections data={only(oneCourse({ modules: { done: 1, total: 5 } }))} />, { api: fakeLearner({ course: vi.fn(async () => adminModuleDetail()) }) });
    await screen.findByRole('region', { name: 'Your modules' });
    expect(tiles()).toHaveLength(5);
    expect(screen.getByRole('link', { name: 'Module 4: Reports, Not started · 15 min' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: '1 of 5 modules done' })).toBeInTheDocument();
    expect(screen.getByText('· Module 2 of 5')).toBeInTheDocument();
    expect(screen.getByText('About 45 min left')).toBeInTheDocument();
    expect(screen.getByText('Finish 4 more modules to get it')).toBeInTheDocument();
  });

  it('a plain course: “Next: the lesson”, its lessons as tiles (never an empty grid), the ring in lessons', async () => {
    const { container } = renderOnSide(<MyLearningSections data={only(card({ mine: mine({ next: { lessonId: 'l2', lessonTitle: 'Make a task', moduleTitle: null } }) }))} />, { api: fakeLearner() });
    const upNext = screen.getByRole('region', { name: 'Up next' });
    expect(within(upNext).getByRole('heading', { level: 3, name: 'Tasks basics' })).toBeInTheDocument();
    expect(within(upNext).queryByText(/Module \d+ of/)).toBeNull();
    const grid = await screen.findByRole('region', { name: 'Your lessons' });
    expect(within(upNext).getByText(/^Next:/)).toHaveTextContent(/^Next: Make a task · Step-by-step guide · 8 min$/);
    expect(tiles()).toHaveLength(4);
    expect(within(grid).getByRole('link', { name: 'Lesson 1: Welcome, Done' })).toHaveAttribute('href', '/training/courses/c1/lessons/l1');
    expect(within(grid).getByRole('link', { name: /^Lesson 2: Make a task.*up next$/ })).toBeInTheDocument();
    // In order: the later lessons are locked (not links).
    expect(within(grid).getAllByRole('link')).toHaveLength(2);
    expect(container.querySelector(NESTED)).toBeNull();
    expect(screen.getByRole('img', { name: '1 of 4 lessons done' })).toHaveTextContent('1 / 4');
    expect(screen.getByText('lessons done')).toBeInTheDocument();
  });

  it('Up next in “Other lessons”: that one unit is the current tile', async () => {
    const d = moduleDetail({
      resumeLessonId: 'x1',
      lessons: [...moduleDetail().lessons, { id: 'x1', position: 7, kind: 'DOCUMENT', title: 'House rules', minutes: 4, done: false, locked: false, review: false, moduleId: null }],
      modules: [...moduleDetail().modules, { id: 'other', title: 'Other lessons', position: 3, status: 'NOT_STARTED', lessonsDone: 0, lessonCount: 1, minutes: 4, doneAt: null, newForRole: false, nextLessonId: 'x1', lessonIds: ['x1'] }],
    });
    renderOnSide(<MyLearningSections data={only(oneCourse({ modules: { done: 1, total: 4 }, next: { lessonId: 'x1', lessonTitle: 'House rules', moduleTitle: 'Other lessons' } }))} />, { api: fakeLearner({ course: vi.fn(async () => d) }) });
    expect(await screen.findByText('· Module 4 of 4')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: 'Other lessons' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Module 4: Other lessons, Not started · 4 min, up next' })).toHaveAttribute('href', '/training/courses/u1?moduleId=other');
  });

  it('everything finished: “All done, well done” with Review, the certificate ready, every tile ticked', async () => {
    const done = moduleCard({ mine: mine({ ...moduleCard().mine, status: 'COMPLETED', progressPct: 100, completedAt: '2026-11-10T08:00:00.000Z', modules: { done: 3, total: 3 }, next: null, nextLessonId: 'g1', certificate: certificate() }) });
    const all = moduleDetail({ mine: done.mine, resumeLessonId: 'g1', lessons: moduleDetail().lessons.map((l) => ({ ...l, done: true })), modules: moduleDetail().modules.map((m) => ({ ...m, status: 'DONE' as const, lessonsDone: m.lessonCount, doneAt: '2026-11-10T08:00:00.000Z', nextLessonId: null })) });
    renderOnSide(<MyLearningSections data={myTraining({ assigned: [], inProgress: [], completed: [done], certificates: [certificate()] })} onBrowse={vi.fn()} />, { api: fakeLearner({ course: vi.fn(async () => all) }) });
    const finished = screen.getByRole('region', { name: 'All done, well done' });
    expect(screen.queryByRole('region', { name: 'Up next' })).toBeNull();
    expect(within(finished).getByRole('link', { name: 'Review' })).toHaveAttribute('href', '/training/courses/u1/lessons/g1');
    expect(within(finished).getByRole('button', { name: 'Browse all courses' })).toBeInTheDocument();
    expect(await screen.findByText('Certificate ready')).toBeInTheDocument();
    await waitFor(() => expect(tiles()).toHaveLength(3));
    for (const li of tiles()) expect(li.querySelector('[data-state]')).toHaveAttribute('data-state', 'DONE');
    expect(screen.getByRole('img', { name: '3 of 3 modules done' })).toBeInTheDocument();
    expect(screen.queryByText(/min left$/)).toBeNull();
    expect(screen.queryByRole('link', { name: /up next$/ })).toBeNull();
    // The Done list stays, with the certificate.
    expect(within(screen.getByRole('region', { name: /^Done/ })).getByRole('button', { name: 'Certificate (PDF): MICO360 Tasks User Training' })).toBeInTheDocument();
  });

  it('finished, then modules new for their role: Up next is the first new module (Continue), the certificate says an updated one comes', async () => {
    const d = adminModuleDetail();
    const mineNow = mine({ ...moduleCard().mine, status: 'COMPLETED', progressPct: 100, newForRole: 2, modules: { done: 3, total: 5 }, certificate: certificate(), next: { lessonId: 'r1', lessonTitle: 'Read a report', moduleTitle: 'Reports' } });
    const after = { ...d, mine: mineNow, resumeLessonId: 'r1', modules: d.modules.map((m) => (m.id === 'rp' || m.id === 'ad' ? { ...m, newForRole: true } : { ...m, status: 'DONE' as const })) };
    renderOnSide(<MyLearningSections data={myTraining({ assigned: [], inProgress: [], completed: [moduleCard({ mine: mineNow })], certificates: [certificate()] })} />, { api: fakeLearner({ course: vi.fn(async () => after) }) });
    const upNext = screen.getByRole('region', { name: 'Up next' });
    expect(await within(upNext).findByText('· Module 4 of 5')).toBeInTheDocument();
    expect(within(upNext).getByRole('heading', { level: 3, name: 'Reports' })).toBeInTheDocument();
    expect(within(upNext).getByText('New for your role: 2')).toBeInTheDocument();
    expect(within(upNext).getByRole('link', { name: 'Continue' })).toHaveAttribute('href', '/training/courses/u1/lessons/r1');
    expect(screen.getByText('Finish the new modules for an updated certificate')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Module 4: Reports, Not started · 15 min, New for your role, up next' })).toBeInTheDocument();
  });

  it('Other courses beside it: the other open courses as compact rows, each with its own Start / Continue and due day', async () => {
    const { container } = renderOnSide(<MyLearningSections data={myTraining()} />, { api: fakeLearner() });
    const other = screen.getByRole('region', { name: /^Other courses/ });
    expect(within(other).getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual(['Meetings & minutes', 'Calendar tips']);
    expect(within(other).getByRole('link', { name: 'Meetings & minutes' })).toHaveAttribute('href', '/training/courses/c2');
    expect(within(other).getByText('Due 20 Nov')).toBeInTheDocument();
    expect(within(within(other).getByRole('link', { name: 'Calendar tips' }).closest('li')!).getByText('1 of 4 lessons')).toBeInTheDocument();
    expect(within(other).getByRole('link', { name: 'Start: Meetings & minutes' })).toHaveAttribute('href', '/training/courses/c2/lessons/l2');
    expect(within(other).getByRole('link', { name: 'Continue: Calendar tips' })).toHaveAttribute('href', '/training/courses/c3/lessons/l2');
    expect(container.querySelector(NESTED)).toBeNull();
    await screen.findByRole('region', { name: 'Your lessons' });
  });

  it('the course can’t be read: Up next still works from the list (no tiles, no error)', async () => {
    const course = vi.fn(async () => Promise.reject(new ApiError(500, 'X', 'boom')));
    renderOnSide(<MyLearningSections data={only(oneCourse())} />, { api: fakeLearner({ course }) });
    await waitFor(() => expect(course).toHaveBeenCalled());
    const upNext = screen.getByRole('region', { name: 'Up next' });
    expect(within(upNext).getByRole('heading', { level: 3, name: 'Tasks' })).toBeInTheDocument();
    expect(within(upNext).getByText(/^Next:/)).toHaveTextContent('Next: Work on a task');
    expect(within(upNext).getByRole('link', { name: 'Continue' })).toHaveAttribute('href', '/training/courses/u1/lessons/t2');
    expect(screen.getByRole('img', { name: '1 of 3 modules done' })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('status')).toBeNull());
    expect(screen.queryByRole('region', { name: 'Your modules' })).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('in the Client portal: the same pieces with the portal’s addresses, and no staff links', async () => {
    const guide = card({ id: 'pc1', title: 'Client portal basics', moduleKey: 'portal', audience: 'CLIENTS' });
    const { container } = renderOnSide(<MyLearningSections data={only(guide)} />, { api: fakeLearner({ course: vi.fn(async () => detail({ id: 'pc1', title: 'Client portal basics', moduleKey: 'portal', audience: 'CLIENTS' })) }), portal: true });
    await screen.findByRole('region', { name: 'Your lessons' });
    expect(screen.getAllByRole('link', { name: 'Client portal basics' })).toHaveLength(1);
    const hrefs = [...container.querySelectorAll('a')].map((a) => a.getAttribute('href'));
    expect(hrefs.length).toBeGreaterThan(2);
    for (const h of hrefs) expect(h).toMatch(/^\/portal\/training\//);
    expect(screen.queryByText(/Manage|Reports|online/)).toBeNull();
  });

  it('Done folds after 6 cards: “Show all 7” opens the rest (and folds them again); each Done card keeps Certificate (PDF)', async () => {
    const done = Array.from({ length: 7 }, (_, i) =>
      card({ id: `d${i}`, title: `Done course ${i + 1}`, mine: mine({ status: 'COMPLETED', progressPct: 100, dueDay: null, completedAt: '2026-11-05T08:00:00.000Z', certificate: certificate({ id: `cert-${i}`, courseId: `d${i}`, courseTitle: `Done course ${i + 1}` }) }) }),
    );
    renderOnSide(<MyLearningSections data={myTraining({ assigned: [], inProgress: [], completed: done, certificates: done.map((c) => c.mine.certificate!) })} />, { api: fakeLearner() });
    const region = screen.getByRole('region', { name: /^Done/ });
    expect(within(region).getAllByRole('article')).toHaveLength(6);
    expect(within(region).queryByRole('link', { name: 'Done course 7' })).toBeNull();
    const more = within(region).getByRole('button', { name: 'Show all 7' });
    expect(more).toHaveAttribute('aria-expanded', 'false');
    expect(document.getElementById(more.getAttribute('aria-controls')!)).not.toBeNull();
    await userEvent.click(more);
    expect(more).toHaveAttribute('aria-expanded', 'true');
    expect(within(region).getAllByRole('article')).toHaveLength(7);
    expect(within(region).getByRole('button', { name: 'Certificate (PDF): Done course 7' })).toBeInTheDocument();
    await userEvent.click(within(region).getByRole('button', { name: 'Show fewer' }));
    expect(within(region).getAllByRole('article')).toHaveLength(6);
  });

  it('6 Done cards or fewer: no fold', () => {
    const done = Array.from({ length: 6 }, (_, i) => card({ id: `d${i}`, title: `Done course ${i + 1}`, mine: mine({ status: 'COMPLETED', progressPct: 100, dueDay: null }) }));
    renderOnSide(<MyLearningSections data={myTraining({ assigned: [], inProgress: [], completed: done, certificates: [] })} />, { api: fakeLearner() });
    expect(within(screen.getByRole('region', { name: /^Done/ })).getAllByRole('article')).toHaveLength(6);
    expect(screen.queryByRole('button', { name: /^Show all/ })).toBeNull();
  });
});
