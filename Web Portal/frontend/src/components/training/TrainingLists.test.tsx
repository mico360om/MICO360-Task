import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '../../lib/api-client';
import { CourseGrid, MyLearningSections } from './TrainingLists';
import { card, certificate, detail, fakeLearner, mine, moduleCard, myTraining, renderOnSide } from './training-fixtures';

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

describe('My learning with the one course', () => {
  it('Up next names the next lesson and its module, and Continue opens it', async () => {
    renderOnSide(<MyLearningSections data={myTraining({ assigned: [moduleCard({ mine: mine({ ...moduleCard().mine, assigned: true, dueDay: '2026-12-13' }) })], inProgress: [], completed: [], certificates: [] })} />, { api: fakeLearner() });
    const upNext = screen.getByRole('region', { name: 'Up next' });
    expect(within(upNext).getByText(/^Next:/)).toHaveTextContent('Next: Tasks · Work on a task');
    expect(within(upNext).getByText('1 of 3 modules')).toBeInTheDocument();
    await userEvent.click(within(upNext).getByRole('link', { name: 'Continue' }));
    expect(screen.getByTestId('where')).toHaveTextContent('/training/courses/u1/lessons/t2');
  });

  it('a plain course: “Next: the lesson” (no module)', () => {
    renderOnSide(<MyLearningSections data={myTraining({ assigned: [card({ mine: mine({ next: { lessonId: 'l2', lessonTitle: 'Make a task', moduleTitle: null } }) })], inProgress: [], completed: [], certificates: [] })} />, { api: fakeLearner() });
    expect(within(screen.getByRole('region', { name: 'Up next' })).getByText(/^Next:/)).toHaveTextContent(/^Next: Make a task$/);
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
