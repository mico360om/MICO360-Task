import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '../../lib/api-client';
import { LessonPlayer } from './LessonPlayer';
import { detail, fakeLearner, lesson, paper, renderOnSide, result } from './training-fixtures';
import { windowWidth } from '../../test/window-width';

const STEPS = [
  { id: 's1', position: 0, title: 'Open My Tasks', body: '<p>Choose <strong>My Tasks</strong> in the menu.</p>', image: { fileId: 'img1', alt: 'The menu with My Tasks' } },
  { id: 's2', position: 1, title: 'Press New task', body: '<p>It is at the top.</p>', image: null },
  { id: 's3', position: 2, title: 'Save it', body: null, image: null },
];

const player = (api: ReturnType<typeof fakeLearner>, lessonId = 'l2', state?: unknown) =>
  renderOnSide(<LessonPlayer courseId="c1" lessonId={lessonId} renderTitle={(t) => <h1>{t}</h1>} />, { api, path: `/training/courses/c1/lessons/${lessonId}`, route: '/training/courses/:courseId/lessons/:lessonId', state });
/** Every other lesson of the course done: this one finishes it. */
const lastOne = () => detail({ lessons: detail().lessons.map((l) => (l.id === 'l2' ? l : { ...l, done: true, locked: false })) });

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

describe('the lesson player (12 Nov §4)', () => {
  it('a guide: the breadcrumbs and one progress sign, “Step 1 of 3” with a thin bar — no “Lesson n of N”, no course bar, no Previous / Next row', async () => {
    player(fakeLearner({ lesson: vi.fn(async () => lesson({ steps: STEPS })) }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Make a task' })).toBeInTheDocument();
    const crumbs = within(screen.getByRole('navigation', { name: 'Breadcrumb' }));
    expect(crumbs.getByRole('link', { name: 'Learning Hub' })).toHaveAttribute('href', '/training');
    expect(crumbs.getByRole('link', { name: 'Tasks basics' })).toHaveAttribute('href', '/training/courses/c1');
    expect(crumbs.getByText('Make a task').closest('[aria-current="page"]')).not.toBeNull();
    expect(screen.getByText('Step 1 of 3')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Step 1 of 3' })).toBeInTheDocument();
    expect(screen.queryByText(/Lesson \d of \d/)).toBeNull();
    expect(screen.queryByRole('progressbar', { name: /Course progress/ })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Previous lesson' })).toBeNull();
    expect(screen.queryByRole('navigation', { name: 'Steps' })).toBeNull();
    expect(screen.getAllByRole('button', { name: /^(Next|Next step|Next lesson|Finish course)$/ })).toHaveLength(1);
  });

  it('a video lesson: “Lesson 2 of 4” and one Next lesson', async () => {
    player(fakeLearner({ lesson: vi.fn(async () => lesson({ kind: 'VIDEO', video: { provider: 'YOUTUBE', videoId: 'v1', embedUrl: 'https://www.youtube-nocookie.com/embed/v1', watchUrl: 'https://www.youtube.com/watch?v=v1' } })) }));
    expect(await screen.findByText('Lesson 2 of 4')).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'Next lesson' })).toHaveLength(1);
    expect(screen.getByRole('link', { name: 'Next lesson' })).toHaveAttribute('href', '/training/courses/c1/lessons/l3');
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

  it('the last lesson to do: Finish course → “Course completed” with the certificate, then Next (My learning)', async () => {
    const api = fakeLearner({
      course: vi.fn(async () => lastOne()),
      lesson: vi.fn(async () => lesson({ kind: 'DOCUMENT', document: { id: 'd1', name: 'Sheet.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', sizeBytes: 20_000, kind: 'DOCUMENT' }, nextLessonId: null })),
    });
    api.complete.mockResolvedValue({ courseProgressPct: 100, courseCompleted: true, certificateId: 'cert9', nextLessonId: null });
    player(api);
    await userEvent.click(await screen.findByRole('button', { name: 'Finish course' }));
    expect(await screen.findByRole('heading', { name: 'Course completed' })).toHaveFocus();
    await userEvent.click(screen.getByRole('button', { name: 'Download certificate (PDF)' }));
    await waitFor(() => expect(api.certificatePdf).toHaveBeenCalledWith('cert9'));
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
      return { courseProgressPct: 100, courseCompleted: true, certificateId: null, nextLessonId: null };
    });
    player(api);
    await userEvent.click(await screen.findByRole('button', { name: 'Finish course' }));
    expect(await screen.findByRole('heading', { name: 'Course completed' })).toBeInTheDocument();
    await waitFor(() => expect(api.course.mock.calls.length).toBeGreaterThan(1));
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.getByRole('heading', { name: 'Course completed' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Next' })).toHaveAttribute('href', '/training');
  });

  it('a quiz that finishes the course: “Course completed” stays when the lesson is read again at 100%', async () => {
    let passed = false;
    const quizInfo = { passMark: 70, maxAttempts: null, attemptsUsed: 0, timeLimitMinutes: null, questionCount: 1, best: null, openAttemptId: null, lastAttemptId: null, canStart: true, reason: null };
    const api = fakeLearner({
      course: vi.fn(async () => lastOne()),
      lesson: vi.fn(async () => lesson({ kind: 'QUIZ', title: 'Check yourself', nextLessonId: null, quiz: passed ? { ...quizInfo, attemptsUsed: 1, best: { scorePct: 100, passed: true } } : quizInfo, courseProgressPct: passed ? 100 : 75 })),
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
    expect(screen.getByRole('link', { name: 'Next' })).toHaveAttribute('href', '/training');
  });

  it('arriving from the lesson before: one note that it is done', async () => {
    player(fakeLearner({ lesson: vi.fn(async () => lesson({ steps: STEPS })) }), 'l2', { lessonDone: 'Welcome' });
    expect(await screen.findByText('“Welcome” done.')).toBeInTheDocument();
  });
});

describe('a guide lesson', () => {
  it('opens at the saved step, saves each move; one Next — on the last step “Next lesson” finishes it and opens the next', async () => {
    const api = fakeLearner({ lesson: vi.fn(async () => lesson({ steps: STEPS, progress: { done: false, videoSeconds: 0, watchedPct: 0, stepIndex: 1 } })) });
    player(api);
    expect(await screen.findByText('Step 2 of 3')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Press New task' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByRole('heading', { level: 2, name: 'Open My Tasks' })).toHaveFocus();
    expect(api.saveProgress).toHaveBeenLastCalledWith('l2', { stepIndex: 0 });
    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull();
    // Its picture, fetched with the sign-in and shown from memory.
    const img = await screen.findByRole('img', { name: 'The menu with My Tasks' });
    expect(img).toHaveAttribute('src', 'blob:test-1');
    expect(api.file).toHaveBeenCalledWith('img1');
    expect(screen.getByText('My Tasks', { selector: 'strong' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(api.saveProgress).toHaveBeenLastCalledWith('l2', { stepIndex: 2 });
    expect(screen.queryByRole('button', { name: 'Next' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Next lesson' }));
    await waitFor(() => expect(api.complete).toHaveBeenCalledWith('l2'));
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/training/courses/c1/lessons/l3'));
  });

  it('the last guide of a course reads “Finish course”', async () => {
    player(fakeLearner({ course: vi.fn(async () => lastOne()), lesson: vi.fn(async () => lesson({ steps: [STEPS[2]!], nextLessonId: null })) }));
    expect(await screen.findByRole('button', { name: 'Finish course' })).toBeInTheDocument();
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

describe('a document lesson', () => {
  const PDF = { id: 'd1', name: 'Tasks guide.pdf', mimeType: 'application/pdf', sizeBytes: 3_600_000, kind: 'DOCUMENT' as const };

  it('on a desktop: the PDF in the page (from memory), Download, and one Next lesson that finishes it', async () => {
    const api = fakeLearner({ lesson: vi.fn(async () => lesson({ kind: 'DOCUMENT', document: PDF })) });
    player(api);
    const frame = await screen.findByTitle('Tasks guide.pdf');
    expect(frame.tagName).toBe('IFRAME');
    expect(frame).toHaveAttribute('src', 'blob:test-1');
    expect(screen.queryByRole('button', { name: 'Open full screen' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Download' }));
    await waitFor(() => expect(api.file).toHaveBeenCalledTimes(2));
    await userEvent.click(screen.getByRole('button', { name: 'Next lesson' }));
    await waitFor(() => expect(api.complete).toHaveBeenCalledWith('l2'));
  });

  it('on a phone: Open full screen and Download instead of the frame', async () => {
    windowWidth(375);
    try {
      const win = { location: { href: '' }, close: vi.fn() };
      const open = vi.spyOn(window, 'open').mockReturnValue(win as unknown as Window);
      const api = fakeLearner({ lesson: vi.fn(async () => lesson({ kind: 'DOCUMENT', document: PDF })) });
      player(api);
      await userEvent.click(await screen.findByRole('button', { name: 'Open full screen' }));
      expect(document.querySelector('iframe')).toBeNull();
      expect(open).toHaveBeenCalledWith('', '_blank');
      await waitFor(() => expect(win.location.href).toMatch(/^blob:test-/));
      expect(screen.getByRole('button', { name: 'Download' })).toBeInTheDocument();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
