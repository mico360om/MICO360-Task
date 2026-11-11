import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '../../lib/api-client';
import { LessonPlayer } from './LessonPlayer';
import { fakeLearner, lesson, renderOnSide } from './training-fixtures';
import { windowWidth } from '../../test/window-width';

const STEPS = [
  { id: 's1', position: 0, title: 'Open My Tasks', body: '<p>Choose <strong>My Tasks</strong> in the menu.</p>', image: { fileId: 'img1', alt: 'The menu with My Tasks' } },
  { id: 's2', position: 1, title: 'Press New task', body: '<p>It is at the top.</p>', image: null },
  { id: 's3', position: 2, title: 'Save it', body: null, image: null },
];

const player = (api: ReturnType<typeof fakeLearner>, lessonId = 'l2') =>
  renderOnSide(<LessonPlayer courseId="c1" lessonId={lessonId} renderTitle={(t) => <h1>{t}</h1>} />, { api, path: `/training/courses/c1/lessons/${lessonId}`, route: '/training/courses/:courseId/lessons/:lessonId' });

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

describe('the lesson player', () => {
  it('the course, “Lesson n of N”, the course’s progress and Previous / Next', async () => {
    player(fakeLearner({ lesson: vi.fn(async () => lesson({ steps: STEPS })) }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Make a task' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Tasks basics' })).toHaveAttribute('href', '/training/courses/c1');
    expect(await screen.findByText('Lesson 2 of 4')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: /Course progress/ })).toBeInTheDocument();
    const nav = screen.getByRole('navigation', { name: 'Lessons' });
    expect(within(nav).getByRole('link', { name: 'Previous lesson' })).toHaveAttribute('href', '/training/courses/c1/lessons/l1');
    expect(within(nav).getByRole('link', { name: 'Next lesson' })).toHaveAttribute('href', '/training/courses/c1/lessons/l3');
  });

  it('a locked lesson says to finish the ones before it', async () => {
    player(fakeLearner({ lesson: vi.fn(async () => Promise.reject(new ApiError(409, 'LESSON_LOCKED', 'Finish the lessons before this one first.'))) }), 'l4');
    expect(await screen.findByText('Finish the lessons before this one first.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to the course' })).toHaveAttribute('href', '/training/courses/c1');
  });

  it('Report outdated: a note to the training team about this lesson', async () => {
    const api = fakeLearner({ lesson: vi.fn(async () => lesson({ steps: STEPS })) });
    player(api);
    await userEvent.click(await screen.findByRole('button', { name: 'Report outdated' }));
    const dialog = screen.getByRole('dialog', { name: 'Report outdated' });
    await userEvent.type(within(dialog).getByLabelText(/What’s out of date/), 'The button moved.');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Send report' }));
    await waitFor(() => expect(api.feedback).toHaveBeenCalledWith('c1', { kind: 'OUTDATED', lessonId: 'l2', body: 'The button moved.' }));
    expect(await within(dialog).findByText(/the training team will look at/)).toBeInTheDocument();
  });

  it('finishing the last lesson: “Course completed”, with the certificate to download', async () => {
    const api = fakeLearner({ lesson: vi.fn(async () => lesson({ kind: 'DOCUMENT', document: { id: 'd1', name: 'Sheet.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', sizeBytes: 20_000, kind: 'DOCUMENT' }, nextLessonId: null })) });
    api.complete.mockResolvedValue({ courseProgressPct: 100, courseCompleted: true, certificateId: 'cert9', nextLessonId: null });
    player(api);
    await userEvent.click(await screen.findByRole('button', { name: 'Done' }));
    expect(await screen.findByRole('heading', { name: 'Course completed' })).toHaveFocus();
    await userEvent.click(screen.getByRole('button', { name: 'Download certificate (PDF)' }));
    await waitFor(() => expect(api.certificatePdf).toHaveBeenCalledWith('cert9'));
  });
});

describe('a guide lesson', () => {
  it('opens at the saved step, saves each move, and Done on the last step finishes it', async () => {
    const api = fakeLearner({ lesson: vi.fn(async () => lesson({ steps: STEPS, progress: { done: false, videoSeconds: 0, watchedPct: 0, stepIndex: 1 } })) });
    player(api);
    expect(await screen.findByText('Step 2 of 3')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Press New task' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByRole('heading', { level: 2, name: 'Open My Tasks' })).toHaveFocus();
    expect(api.saveProgress).toHaveBeenLastCalledWith('l2', { stepIndex: 0 });
    // Its picture, fetched with the sign-in and shown from memory.
    const img = await screen.findByRole('img', { name: 'The menu with My Tasks' });
    expect(img).toHaveAttribute('src', 'blob:test-1');
    expect(api.file).toHaveBeenCalledWith('img1');
    expect(screen.getByText('My Tasks', { selector: 'strong' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Next step' }));
    await userEvent.click(screen.getByRole('button', { name: 'Next step' }));
    expect(api.saveProgress).toHaveBeenLastCalledWith('l2', { stepIndex: 2 });
    expect(screen.queryByRole('button', { name: 'Next step' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(api.complete).toHaveBeenCalledWith('l2'));
    expect(await screen.findByText('Lesson done.')).toBeInTheDocument();
    // Next lesson after it.
    expect(screen.getAllByRole('link', { name: 'Next lesson' })[0]).toHaveAttribute('href', '/training/courses/c1/lessons/l3');
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

  it('on a desktop: the PDF in the page (from memory), Download, and Done', async () => {
    const api = fakeLearner({ lesson: vi.fn(async () => lesson({ kind: 'DOCUMENT', document: PDF })) });
    player(api);
    const frame = await screen.findByTitle('Tasks guide.pdf');
    expect(frame.tagName).toBe('IFRAME');
    expect(frame).toHaveAttribute('src', 'blob:test-1');
    expect(screen.queryByRole('button', { name: 'Open full screen' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Download' }));
    await waitFor(() => expect(api.file).toHaveBeenCalledTimes(2));
    await userEvent.click(screen.getByRole('button', { name: 'Done' }));
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
