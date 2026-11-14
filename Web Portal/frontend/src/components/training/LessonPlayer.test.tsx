import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useNavigate, useParams } from 'react-router-dom';
import { ApiError } from '../../lib/api-client';
import { LessonPlayer } from './LessonPlayer';
import { detail, fakeLearner, lesson, moduleDetail, paper, renderOnSide, result } from './training-fixtures';
import { windowWidth } from '../../test/window-width';

const STEPS = [
  { id: 's1', position: 0, title: 'Open My Tasks', body: '<p>Choose <strong>My Tasks</strong> in the menu.</p>', image: { fileId: 'img1', alt: 'The menu with My Tasks' } },
  { id: 's2', position: 1, title: 'Press New task', body: '<p>It is at the top.</p>', image: null },
  { id: 's3', position: 2, title: 'Save it', body: null, image: null },
];
const YT = { provider: 'YOUTUBE' as const, videoId: 'v1', embedUrl: 'https://www.youtube-nocookie.com/embed/v1', watchUrl: 'https://www.youtube.com/watch?v=v1' };
const QUIZ = { passMark: 70, maxAttempts: null, attemptsUsed: 0, timeLimitMinutes: null, questionCount: 1, best: null, openAttemptId: null, lastAttemptId: null, canStart: true, reason: null };

const player = (api: ReturnType<typeof fakeLearner>, lessonId = 'l2', state?: unknown) =>
  renderOnSide(<LessonPlayer courseId="c1" lessonId={lessonId} renderTitle={(t) => <h1>{t}</h1>} />, { api, path: `/training/courses/c1/lessons/${lessonId}`, route: '/training/courses/:courseId/lessons/:lessonId', state });
/** Every other lesson of the course done: this one finishes it. */
const lastOne = () => detail({ lessons: detail().lessons.map((l) => (l.id === 'l2' ? l : { ...l, done: true, locked: false })) });

/** The one course's Tasks module, at "Work on a task" (t2, the 2nd of 3). */
const inTasks = (over: Parameters<typeof lesson>[0] = {}) =>
  lesson({ id: 't2', courseId: 'u1', courseTitle: 'MICO360 Tasks User Training', title: 'Work on a task', position: 3, lessonCount: 7, prevLessonId: 't1', nextLessonId: 't3', steps: STEPS, module: { id: 'tk', title: 'Tasks', lessonIndex: 1, lessonCount: 3 }, ...over });
const modulePlayer = (api: ReturnType<typeof fakeLearner>, lessonId = 't2', state?: unknown, courseId = 'u1') =>
  renderOnSide(<LessonPlayer courseId={courseId} lessonId={lessonId} renderTitle={(t) => <h1>{t}</h1>} />, { api, path: `/training/courses/${courseId}/lessons/${lessonId}`, route: '/training/courses/:courseId/lessons/:lessonId', state });

/** A player that follows the address (not remounted per lesson): a jump re-renders the same player. */
function Follow() {
  const { courseId = '', lessonId = '' } = useParams();
  const navigate = useNavigate();
  return (
    <>
      <LessonPlayer courseId={courseId} lessonId={lessonId} renderTitle={(t) => <h1>{t}</h1>} />
      <button type="button" onClick={() => navigate(-1)}>
        Browser back
      </button>
    </>
  );
}

const panel = () => within(screen.getByRole('navigation', { name: 'In this module' }));
const bar = () => within(document.querySelector<HTMLElement>('[data-lesson-bar]')!);

let made: string[] = [];
let revoked: string[] = [];
beforeEach(() => {
  made = [];
  revoked = [];
  let n = 0;
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => {
    const url = `blob:test-${++n}`;
    made.push(url);
    return url;
  });
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation((u: string) => void revoked.push(u));
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
});
afterEach(() => vi.unstubAllGlobals());

describe('the lesson page’s header (1.23.36)', () => {
  it('breadcrumbs, the title, ONE line (kind · “Module 2 · Tasks — Lesson 2 of 3” · minutes) and ONE labelled progress bar', async () => {
    modulePlayer(fakeLearner({ course: vi.fn(async () => moduleDetail()), lesson: vi.fn(async () => inTasks()) }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Work on a task' })).toBeInTheDocument();
    const crumbs = within(screen.getByRole('navigation', { name: 'Breadcrumb' }));
    expect(crumbs.getByRole('link', { name: 'Learning Hub' })).toHaveAttribute('href', '/training');
    expect(crumbs.getByRole('link', { name: 'MICO360 Tasks User Training' })).toHaveAttribute('href', '/training/courses/u1?moduleId=tk');
    expect(crumbs.getByText('Tasks').closest('[aria-current="page"]')).not.toBeNull();
    await waitFor(() => expect(document.querySelector('[data-lesson-place]')).toHaveTextContent('Module 2 · Tasks — Lesson 2 of 3'));
    const line = document.querySelector<HTMLElement>('[data-lesson-line]')!;
    expect(line).toHaveTextContent('Step-by-step guide');
    expect(line).toHaveTextContent('8 min');
    expect(line.querySelector('svg')).not.toBeNull();
    // One bar on the page (the guide's steps are dots, not a second bar), named for screen readers.
    expect(screen.getAllByRole('progressbar')).toHaveLength(1);
    expect(screen.getByRole('progressbar', { name: 'Tasks: 1 of 3 lessons done' })).toHaveAttribute('aria-valuenow', '33');
    // The kind isn't said again on a line of its own (“Video · 2 min”).
    expect(document.querySelectorAll('[data-lesson-line]')).toHaveLength(1);
  });

  it('a video: the kind is the icon on the line (no “Video · 2 min” line under the title)', async () => {
    player(fakeLearner({ lesson: vi.fn(async () => lesson({ kind: 'VIDEO', title: 'Video: Welcome', minutes: 2, video: YT })) }));
    await waitFor(() => expect(document.querySelector('[data-lesson-place]')).toHaveTextContent('Lesson 2 of 4'));
    // Said for screen readers beside the icons, never as a visible word.
    expect(screen.queryAllByText('Video', { exact: true }).filter((el) => !el.closest('.sr-only'))).toEqual([]);
    // The header's one bar, and the video's own slim “Watched” bar under the player.
    expect(screen.getAllByRole('progressbar').map((b) => b.getAttribute('aria-label'))).toEqual(['Tasks basics: 1 of 4 lessons done', 'Watched']);
    expect(screen.getByText('Watch to the end to finish this lesson')).toBeInTheDocument();
  });
});

describe('“In this module” beside the lesson (1.23.36, 1024 px and wider)', () => {
  it('the module: its name, “1 of 3 done”, its lessons with their states, the main button and All modules', async () => {
    modulePlayer(fakeLearner({ course: vi.fn(async () => moduleDetail()), lesson: vi.fn(async () => inTasks({ steps: [STEPS[0]!] })) }));
    await screen.findByRole('navigation', { name: 'In this module' });
    expect(panel().getByRole('heading', { name: 'Tasks' })).toBeInTheDocument();
    expect(panel().getByText('1 of 3 done')).toBeInTheDocument();
    const items = within(panel().getByRole('list', { name: 'Lessons' })).getAllByRole('listitem');
    expect(items).toHaveLength(3);
    // Done (a tick, and said), current (marked), not started — each a link (jump freely: D4).
    expect(within(items[0]!).getByRole('link', { name: /Make a task/ })).toHaveAttribute('href', '/training/courses/u1/lessons/t1');
    expect(within(items[0]!).getByRole('link', { name: /Make a task/ })).toHaveAccessibleName(/done/);
    expect(within(items[1]!).getByRole('link', { name: /Work on a task/ })).toHaveAttribute('aria-current', 'page');
    expect(within(items[2]!).getByRole('link', { name: /Tasks quiz/ })).not.toHaveAttribute('aria-current');
    expect(panel().getByRole('link', { name: 'All modules' })).toHaveAttribute('href', '/training/courses/u1?moduleId=tk');
    // On the guide's one (last) step the main button finishes it: “Next: Tasks quiz”.
    expect(panel().getByRole('button', { name: 'Next: Tasks quiz' })).toBeInTheDocument();
    // No phone bar or sheet button on a computer.
    expect(document.querySelector('[data-lesson-bar]')).toBeNull();
    expect(screen.queryByRole('button', { name: /^Lessons in this module/ })).toBeNull();
  });

  it('an in-order course: a locked lesson shows a lock and is no link; hidden lessons never appear', async () => {
    player(fakeLearner({ lesson: vi.fn(async () => lesson({ steps: STEPS })) }));
    const nav = await screen.findByRole('navigation', { name: 'In this course' });
    const items = within(within(nav).getByRole('list', { name: 'Lessons' })).getAllByRole('listitem');
    expect(items.map((li) => li.textContent)).toEqual([expect.stringContaining('Welcome'), expect.stringContaining('Make a task'), expect.stringContaining('The cheat sheet'), expect.stringContaining('Check yourself')]);
    expect(within(items[2]!).queryByRole('link')).toBeNull();
    expect(items[2]).toHaveTextContent(/Locked/);
    expect(within(nav).getByText('1 of 4 done')).toBeInTheDocument();
    expect(within(nav).getByRole('link', { name: 'Course page' })).toHaveAttribute('href', '/training/courses/c1');
    // Before the guide's last step its main button is a plain way on — but the next lesson is locked: none.
    expect(within(nav).queryByRole('link', { name: /^Next/ })).toBeNull();
    expect(within(nav).queryByRole('button', { name: /^Next/ })).toBeNull();
  });

  it('jumping via the panel opens that lesson', async () => {
    modulePlayer(fakeLearner({ course: vi.fn(async () => moduleDetail()), lesson: vi.fn(async () => inTasks()) }));
    await screen.findByRole('navigation', { name: 'In this module' });
    await userEvent.click(within(panel().getByRole('list', { name: 'Lessons' })).getByRole('link', { name: /Tasks quiz/ }));
    expect(screen.getByTestId('where')).toHaveTextContent('/training/courses/u1/lessons/t3');
  });

  it('“Next: …” lands on the right lesson: a video goes on (secondary until watched, the main look once done)', async () => {
    const api = fakeLearner({ course: vi.fn(async () => moduleDetail()), lesson: vi.fn(async () => inTasks({ id: 'k1', kind: 'VIDEO', title: 'Video: the Kanban board', steps: [], nextLessonId: 'k2', module: { id: 'kb', title: 'Kanban board', lessonIndex: 0, lessonCount: 2 }, video: YT })) });
    modulePlayer(api, 'k1');
    const next = await screen.findByRole('link', { name: 'Next: Kanban board quiz' });
    expect(next).toHaveAttribute('href', '/training/courses/u1/lessons/k2');
    expect(next).toHaveAttribute('data-look', 'secondary');
    await userEvent.click(next);
    expect(screen.getByTestId('where')).toHaveTextContent('/training/courses/u1/lessons/k2');
  });

  it('a module’s last lesson, done: “Next module: Kanban board” opens its first lesson', async () => {
    const quiz = { ...QUIZ, attemptsUsed: 1, best: { scorePct: 100, passed: true }, lastAttemptId: 'a0' };
    modulePlayer(fakeLearner({ course: vi.fn(async () => moduleDetail()), lesson: vi.fn(async () => inTasks({ id: 't3', kind: 'QUIZ', title: 'Tasks quiz', steps: [], nextLessonId: 'k1', quiz, progress: { done: true, videoSeconds: 0, watchedPct: 0, stepIndex: 0 }, module: { id: 'tk', title: 'Tasks', lessonIndex: 2, lessonCount: 3 } })) }), 't3');
    const next = await screen.findByRole('link', { name: 'Next module: Kanban board' });
    expect(next).toHaveAttribute('data-look', 'primary');
    await userEvent.click(next);
    expect(screen.getByTestId('where')).toHaveTextContent('/training/courses/u1/lessons/k1');
  });

  it('a guide: Back / Next move between steps in the card; on the last step “Next: <lesson>” finishes it and opens the next', async () => {
    const api = fakeLearner({ course: vi.fn(async () => moduleDetail()), lesson: vi.fn(async () => inTasks({ progress: { done: false, videoSeconds: 0, watchedPct: 0, stepIndex: 1 } })) });
    api.complete.mockResolvedValue({ courseProgressPct: 40, courseCompleted: false, certificateId: null, nextLessonId: 't3', moduleDone: null });
    modulePlayer(api);
    const card = within(await screen.findByRole('region', { name: 'Press New task' }));
    expect(card.getByText('Step 2 of 3')).toBeInTheDocument();
    // Step dots instead of a second bar: each a button to its step.
    const dots = card.getByRole('list', { name: 'Steps' });
    expect(within(dots).getByRole('button', { name: 'Step 2: Press New task' })).toHaveAttribute('aria-current', 'step');
    await userEvent.click(within(dots).getByRole('button', { name: 'Step 1: Open My Tasks' }));
    expect(screen.getByRole('heading', { level: 2, name: 'Open My Tasks' })).toHaveFocus();
    expect(api.saveProgress).toHaveBeenLastCalledWith('t2', { stepIndex: 0 });
    // Before the last step the panel's main button is a plain way on (it doesn't finish the guide).
    expect(panel().getByRole('link', { name: 'Next: Tasks quiz' })).toHaveAttribute('data-look', 'secondary');
    const inCard = () => within(screen.getByRole('region', { name: /Open My Tasks|Press New task|Save it/ }));
    await userEvent.click(inCard().getByRole('button', { name: 'Next' }));
    await userEvent.click(inCard().getByRole('button', { name: 'Next' }));
    expect(inCard().queryByRole('button', { name: 'Next' })).toBeNull();
    expect(inCard().getByRole('button', { name: 'Back' })).toBeInTheDocument();
    await userEvent.click(inCard().getByRole('button', { name: 'Next: Tasks quiz' }));
    await waitFor(() => expect(api.complete).toHaveBeenCalledWith('t2'));
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/training/courses/u1/lessons/t3'));
  });

  it('the last lesson to do: Finish course → “Course completed” with the certificate, then Next (My learning)', async () => {
    const api = fakeLearner({
      course: vi.fn(async () => lastOne()),
      lesson: vi.fn(async () => lesson({ kind: 'DOCUMENT', document: { id: 'd1', name: 'Sheet.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', sizeBytes: 20_000, kind: 'DOCUMENT' }, nextLessonId: null })),
    });
    api.complete.mockResolvedValue({ courseProgressPct: 100, courseCompleted: true, certificateId: 'cert9', nextLessonId: null, moduleDone: null });
    player(api);
    await userEvent.click(await screen.findByRole('button', { name: 'Finish course' }));
    expect(await screen.findByRole('heading', { name: 'Course completed' })).toHaveFocus();
    await userEvent.click(screen.getByRole('button', { name: 'Download certificate (PDF)' }));
    await waitFor(() => expect(api.certificatePdf).toHaveBeenCalledWith('cert9'));
    // One way on: Next (My learning); the panel's button steps aside.
    expect(screen.getAllByRole('link', { name: /^Next/ })).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Finish course' })).toBeNull();
    await userEvent.click(screen.getByRole('link', { name: 'Next' }));
    expect(screen.getByTestId('where')).toHaveTextContent(/^\/training$/);
  });

  it('review I2: “Course completed” stays when the course comes back finished from the server', async () => {
    let finished = false;
    const api = fakeLearner({
      course: vi.fn(async () => (finished ? detail({ mine: { ...lastOne().mine, status: 'COMPLETED', progressPct: 100, completedAt: '2026-11-13T08:00:00.000Z' }, lessons: lastOne().lessons.map((l) => ({ ...l, done: true })) }) : lastOne())),
      lesson: vi.fn(async () => lesson({ steps: [STEPS[2]!], nextLessonId: null })),
    });
    api.complete.mockImplementation(async () => {
      finished = true;
      return { courseProgressPct: 100, courseCompleted: true, certificateId: null, nextLessonId: null, moduleDone: null };
    });
    player(api);
    await userEvent.click(within(await screen.findByRole('region', { name: 'Save it' })).getByRole('button', { name: 'Finish course' }));
    expect(await screen.findByRole('heading', { name: 'Course completed' })).toBeInTheDocument();
    await waitFor(() => expect(api.course.mock.calls.length).toBeGreaterThan(1));
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.getByRole('heading', { name: 'Course completed' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Next' })).toHaveAttribute('href', '/training');
  });

  it('a quiz that finishes the course: “Course completed” stays when the lesson is read again at 100%', async () => {
    let passed = false;
    const api = fakeLearner({
      course: vi.fn(async () => lastOne()),
      lesson: vi.fn(async () => lesson({ kind: 'QUIZ', title: 'Check yourself', nextLessonId: null, quiz: passed ? { ...QUIZ, attemptsUsed: 1, best: { scorePct: 100, passed: true } } : QUIZ, courseProgressPct: passed ? 100 : 75 })),
      startAttempt: vi.fn(async () => paper({ questions: [paper().questions[0]!] })),
    });
    api.submit.mockImplementation(async () => {
      passed = true;
      return result({ scorePct: 100, passed: true, answersShown: true, courseCompleted: true, certificateId: null, questions: [result().questions[0]!] });
    });
    player(api);
    await userEvent.click(await screen.findByRole('button', { name: 'Start quiz' }));
    await userEvent.click(await screen.findByRole('radio', { name: 'Top bar' }));
    await userEvent.click(screen.getByRole('button', { name: 'Hand in' }));
    expect(await screen.findByRole('heading', { name: 'Course completed' })).toBeInTheDocument();
    await waitFor(() => expect(api.lesson.mock.calls.length).toBeGreaterThan(1));
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.getByRole('heading', { name: 'Course completed' })).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: /^Next/ })).toHaveLength(1);
    expect(screen.getByRole('link', { name: 'Next' })).toHaveAttribute('href', '/training');
  });

  it('a quiz’s start page says what it covers: the module’s lessons before it', async () => {
    modulePlayer(fakeLearner({ course: vi.fn(async () => moduleDetail()), lesson: vi.fn(async () => inTasks({ id: 't3', kind: 'QUIZ', title: 'Tasks quiz', steps: [], nextLessonId: 'k1', quiz: { ...QUIZ, questionCount: 4 }, minutes: 5, module: { id: 'tk', title: 'Tasks', lessonIndex: 2, lessonCount: 3 } })) }), 't3');
    const covers = await screen.findByRole('list', { name: 'This quiz covers' });
    expect(within(covers).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Make a task', 'Work on a task']);
    expect(screen.getByRole('button', { name: 'Start quiz' })).toBeInTheDocument();
  });
});

describe('on a phone or tablet (under 1024 px, 1.23.36)', () => {
  beforeEach(() => windowWidth(375));

  it('“Lessons in this module · 2 of 3” opens the same list as a sheet; no panel beside the lesson', async () => {
    modulePlayer(fakeLearner({ course: vi.fn(async () => moduleDetail()), lesson: vi.fn(async () => inTasks()) }));
    const open = await screen.findByRole('button', { name: 'Lessons in this module · 2 of 3' });
    // 44 px on a touch screen: the important class (a plain min-h-11 loses to index.css's touch floor for buttons).
    expect(open.className).toContain('[@media(pointer:coarse)]:!min-h-11');
    expect(screen.queryByRole('navigation', { name: 'In this module' })).toBeNull();
    await userEvent.click(open);
    const sheet = within(screen.getByRole('dialog', { name: 'Tasks' }));
    expect(sheet.getByText('1 of 3 done')).toBeInTheDocument();
    expect(sheet.getAllByRole('link', { name: /Make a task|Work on a task|Tasks quiz/ })).toHaveLength(3);
    expect(sheet.getByRole('link', { name: 'All modules' })).toHaveAttribute('href', '/training/courses/u1?moduleId=tk');
    await userEvent.click(sheet.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(open).toHaveFocus();
  });

  it('the bar at the bottom: Back (the lesson before) and “Next: <title>”', async () => {
    modulePlayer(fakeLearner({ course: vi.fn(async () => moduleDetail()), lesson: vi.fn(async () => inTasks({ id: 'k1', kind: 'VIDEO', title: 'Video: the Kanban board', steps: [], prevLessonId: 't3', nextLessonId: 'k2', module: { id: 'kb', title: 'Kanban board', lessonIndex: 0, lessonCount: 2 }, video: YT })) }), 'k1');
    await screen.findByRole('button', { name: 'Lessons in this module · 1 of 2' });
    expect(bar().getByRole('link', { name: /^Back/ })).toHaveAttribute('href', '/training/courses/u1/lessons/t3');
    expect(bar().getByRole('link', { name: /^Back/ })).toHaveAccessibleName('Back: Tasks quiz');
    expect(bar().getByRole('link', { name: 'Next: Kanban board quiz' })).toHaveAttribute('href', '/training/courses/u1/lessons/k2');
    expect(screen.getAllByRole('link', { name: /^Next/ })).toHaveLength(1);
  });

  it('a guide: the bar holds its Back / Next (one set on the screen); the last step’s Next is the lesson’s', async () => {
    modulePlayer(fakeLearner({ course: vi.fn(async () => moduleDetail()), lesson: vi.fn(async () => inTasks()) }));
    await screen.findByRole('region', { name: 'Open My Tasks' });
    // Step 1: Back is the lesson before; Next the next step.
    await waitFor(() => expect(bar().getByRole('button', { name: 'Next' })).toBeInTheDocument());
    expect(bar().getByRole('link', { name: 'Back: Make a task' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Next' })).toHaveLength(1);
    await userEvent.click(bar().getByRole('button', { name: 'Next' }));
    expect(bar().getByRole('button', { name: 'Back' })).toBeInTheDocument();
    await userEvent.click(bar().getByRole('button', { name: 'Next' }));
    expect(bar().getByRole('button', { name: 'Next: Tasks quiz' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /^Next/ })).toHaveLength(1);
  });

  it('a document on a phone: Open full screen and Download; the bar’s Next marks it read and goes on', async () => {
    const win = { location: { href: '' }, close: vi.fn() };
    const open = vi.spyOn(window, 'open').mockReturnValue(win as unknown as Window);
    const PDF = { id: 'd1', name: 'Tasks guide.pdf', mimeType: 'application/pdf', sizeBytes: 3_600_000, kind: 'DOCUMENT' as const };
    const api = fakeLearner({ lesson: vi.fn(async () => lesson({ kind: 'DOCUMENT', document: PDF })) });
    player(api);
    await userEvent.click(await screen.findByRole('button', { name: 'Open full screen' }));
    expect(document.querySelector('iframe')).toBeNull();
    expect(open).toHaveBeenCalledWith('', '_blank');
    await waitFor(() => expect(win.location.href).toMatch(/^blob:test-/));
    expect(screen.getByRole('button', { name: 'Download' })).toBeInTheDocument();
    await userEvent.click(bar().getByRole('button', { name: 'Next: The cheat sheet' }));
    await waitFor(() => expect(api.complete).toHaveBeenCalledWith('l2'));
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/training/courses/c1/lessons/l3'));
  });
});

describe('the “… done.” note (1.23.36: never left over)', () => {
  it('arriving from the lesson before: one note that it is done', async () => {
    player(fakeLearner({ lesson: vi.fn(async () => lesson({ steps: STEPS })) }), 'l2', { lessonDone: 'Welcome' });
    expect(await screen.findByText('“Welcome” done.')).toBeInTheDocument();
  });

  it('cleared on lesson change, and not shown again when coming back', async () => {
    const api = fakeLearner({ course: vi.fn(async () => moduleDetail()), lesson: vi.fn(async (id: string) => inTasks({ id, title: id === 't1' ? 'Make a task' : id === 't3' ? 'Tasks quiz' : 'Work on a task' })) });
    renderOnSide(<Follow />, { api, path: '/training/courses/u1/lessons/t2', route: '/training/courses/:courseId/lessons/:lessonId', state: { lessonDone: 'Make a task' } });
    expect(await screen.findByText('“Make a task” done.')).toBeInTheDocument();
    await userEvent.click(within(await screen.findByRole('list', { name: 'Lessons' })).getByRole('link', { name: /Tasks quiz/ }));
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/training/courses/u1/lessons/t3'));
    await screen.findByRole('heading', { level: 1, name: 'Tasks quiz' });
    expect(screen.queryByText('“Make a task” done.')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Browser back' }));
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/training/courses/u1/lessons/t2'));
    await screen.findByRole('heading', { level: 1, name: 'Work on a task' });
    expect(screen.queryByText('“Make a task” done.')).toBeNull();
  });

  it('a quiz: gone once its result shows (no message from another lesson on the result page)', async () => {
    const api = fakeLearner({
      course: vi.fn(async () => moduleDetail()),
      lesson: vi.fn(async () => inTasks({ id: 't3', kind: 'QUIZ', title: 'Tasks quiz', steps: [], nextLessonId: 'k1', quiz: { ...QUIZ, attemptsUsed: 1, best: { scorePct: 100, passed: true }, lastAttemptId: 'a0' }, progress: { done: true, videoSeconds: 0, watchedPct: 0, stepIndex: 0 }, module: { id: 'tk', title: 'Tasks', lessonIndex: 2, lessonCount: 3 } })),
      result: vi.fn(async () => result({ scorePct: 100, passed: true, answersShown: true })),
    });
    modulePlayer(api, 't3', { lessonDone: 'Work on a task' });
    expect(await screen.findByText('“Work on a task” done.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'See your answers' }));
    expect(await screen.findByRole('heading', { level: 2, name: 'You passed — 100%' })).toBeInTheDocument();
    expect(screen.queryByText('“Work on a task” done.')).toBeNull();
  });
});

describe('module notes and old links (1.23.30)', () => {
  it('finishing a module’s last lesson: the next lesson’s page says “Module done: Tasks” (one note)', async () => {
    const api = fakeLearner({ course: vi.fn(async () => moduleDetail()), lesson: vi.fn(async () => inTasks({ steps: [STEPS[2]!] })) });
    api.complete.mockResolvedValue({ courseProgressPct: 66, courseCompleted: false, certificateId: null, nextLessonId: 't3', moduleDone: { id: 'tk', title: 'Tasks' } });
    const view = modulePlayer(api);
    await userEvent.click(within(await screen.findByRole('region', { name: 'Save it' })).getByRole('button', { name: 'Next: Tasks quiz' }));
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/training/courses/u1/lessons/t3'));
    view.unmount();
    modulePlayer(fakeLearner({ course: vi.fn(async () => moduleDetail()), lesson: vi.fn(async () => inTasks({ id: 'k1', title: 'Video: the Kanban board', module: { id: 'kb', title: 'Kanban board', lessonIndex: 0, lessonCount: 2 } })) }), 'k1', { lessonDone: 'Work on a task', moduleDone: 'Tasks' });
    expect(await screen.findByText(/^Module done:/)).toHaveTextContent('Module done: Tasks');
    expect(screen.queryByText('“Work on a task” done.')).toBeNull();
  });

  it('passing the quiz that finishes a module says “Module done” on its page', async () => {
    let passed = false;
    const c = moduleDetail();
    const api = fakeLearner({
      course: vi.fn(async () => (passed ? { ...c, modules: c.modules.map((m) => (m.id === 'tk' ? { ...m, status: 'DONE' as const, lessonsDone: 3, doneAt: '2026-11-13T08:00:00.000Z' } : m)) } : c)),
      lesson: vi.fn(async () => inTasks({ id: 't3', kind: 'QUIZ', title: 'Tasks quiz', steps: [], nextLessonId: 'k1', quiz: QUIZ, module: { id: 'tk', title: 'Tasks', lessonIndex: 2, lessonCount: 3 } })),
      startAttempt: vi.fn(async () => paper({ lessonId: 't3', courseId: 'u1', questions: [paper().questions[0]!] })),
    });
    api.submit.mockImplementation(async () => {
      passed = true;
      return result({ lessonId: 't3', courseId: 'u1', scorePct: 100, passed: true, answersShown: true, courseCompleted: false, certificateId: null, questions: [result().questions[0]!] });
    });
    modulePlayer(api, 't3');
    await waitFor(() => expect(document.querySelector('[data-lesson-place]')).toHaveTextContent('Module 2 · Tasks — Lesson 3 of 3'));
    expect(screen.queryByText(/^Module done/)).toBeNull();
    await userEvent.click(await screen.findByRole('button', { name: 'Start quiz' }));
    await userEvent.click(await screen.findByRole('radio', { name: 'Top bar' }));
    await userEvent.click(screen.getByRole('button', { name: 'Hand in' }));
    expect(await screen.findByText(/^Module done:/)).toHaveTextContent('Module done: Tasks');
    expect(screen.getAllByText(/^Module done/)).toHaveLength(1);
  });

  it('an old link (a lesson under its old short course): the lesson’s own course address replaces it', async () => {
    const api = fakeLearner({ course: vi.fn(async () => Promise.reject(new ApiError(404, 'COURSE_MOVED', 'Moved.', { courseId: 'u1', moduleId: 'tk' }))), lesson: vi.fn(async () => inTasks()) });
    modulePlayer(api, 't2', undefined, 'c1');
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/training/courses/u1/lessons/t2'));
  });

  it('an old link to a lesson that was removed as a duplicate: the one course at its module', async () => {
    const api = fakeLearner({ lesson: vi.fn(async () => Promise.reject(new ApiError(404, 'COURSE_MOVED', 'Moved.', { courseId: 'u1', moduleId: 'tk' }))) });
    modulePlayer(api, 'gone1', undefined, 'c1');
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/training/courses/u1?moduleId=tk'));
    expect(screen.queryByText('This course isn’t available to you.')).toBeNull();
  });

  it('a locked lesson says to finish the ones before it', async () => {
    player(fakeLearner({ lesson: vi.fn(async () => Promise.reject(new ApiError(409, 'LESSON_LOCKED', 'Finish the lessons before this one first.'))) }), 'l4');
    expect(await screen.findByText('Finish the lessons before this one first.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to the course' })).toHaveAttribute('href', '/training/courses/c1');
  });

  it('Report a problem: a small link, a note to the training team about this lesson', async () => {
    const api = fakeLearner({ lesson: vi.fn(async () => lesson({ steps: STEPS })) });
    player(api);
    await userEvent.click(await screen.findByRole('button', { name: 'Report a problem' }));
    const dialog = screen.getByRole('dialog', { name: 'Report a problem' });
    await userEvent.type(within(dialog).getByLabelText(/What’s wrong/), 'The button moved.');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Send report' }));
    await waitFor(() => expect(api.feedback).toHaveBeenCalledWith('c1', { kind: 'OUTDATED', lessonId: 'l2', body: 'The button moved.' }));
    expect(await within(dialog).findByText(/the training team will look at/)).toBeInTheDocument();
  });
});

describe('a guide’s pictures', () => {
  it('opens at the saved step; its picture fetched with the sign-in and shown from memory', async () => {
    const api = fakeLearner({ lesson: vi.fn(async () => lesson({ steps: STEPS, progress: { done: false, videoSeconds: 0, watchedPct: 0, stepIndex: 1 } })) });
    player(api);
    expect(await screen.findByText('Step 2 of 3')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByRole('heading', { level: 2, name: 'Open My Tasks' })).toHaveFocus();
    const img = await screen.findByRole('img', { name: 'The menu with My Tasks' });
    expect(img).toHaveAttribute('src', 'blob:test-1');
    expect(api.file).toHaveBeenCalledWith('img1');
    expect(screen.getByText('My Tasks', { selector: 'strong' })).toBeInTheDocument();
  });

  it('a picture enlarges with a tap or click (and closes again)', async () => {
    player(fakeLearner({ lesson: vi.fn(async () => lesson({ steps: STEPS })) }));
    await userEvent.click(await screen.findByRole('button', { name: 'Enlarge the picture: The menu with My Tasks' }));
    const big = screen.getByRole('dialog', { name: 'The menu with My Tasks' });
    expect(within(big).getByRole('img', { name: 'The menu with My Tasks' })).toHaveAttribute('src', 'blob:test-1');
    await userEvent.click(within(big).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('lets the step’s picture go when it closes', async () => {
    const view = player(fakeLearner({ lesson: vi.fn(async () => lesson({ steps: STEPS })) }));
    await screen.findByRole('img', { name: 'The menu with My Tasks' });
    view.unmount();
    expect(revoked).toEqual(made);
  });
});

describe('a document lesson on a computer', () => {
  const PDF = { id: 'd1', name: 'Tasks guide.pdf', mimeType: 'application/pdf', sizeBytes: 3_600_000, kind: 'DOCUMENT' as const };

  it('the PDF in the page (from memory), Download, and the panel’s “Next: …” marks it read and goes on', async () => {
    const api = fakeLearner({ lesson: vi.fn(async () => lesson({ kind: 'DOCUMENT', document: PDF })) });
    player(api);
    const frame = await screen.findByTitle('Tasks guide.pdf');
    expect(frame.tagName).toBe('IFRAME');
    expect(frame).toHaveAttribute('src', 'blob:test-1');
    expect(screen.queryByRole('button', { name: 'Open full screen' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Download' }));
    await waitFor(() => expect(api.file).toHaveBeenCalledTimes(2));
    await userEvent.click(within(screen.getByRole('navigation', { name: 'In this course' })).getByRole('button', { name: 'Next: The cheat sheet' }));
    await waitFor(() => expect(api.complete).toHaveBeenCalledWith('l2'));
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/training/courses/c1/lessons/l3'));
  });

  it('already read: “Done” on the header line', async () => {
    player(fakeLearner({ lesson: vi.fn(async () => lesson({ kind: 'DOCUMENT', document: PDF, progress: { done: true, videoSeconds: 0, watchedPct: 0, stepIndex: 0 } })) }));
    await screen.findByTitle('Tasks guide.pdf');
    expect(document.querySelector('[data-lesson-line]')).toHaveTextContent('Done');
  });
});
