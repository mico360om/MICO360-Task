import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { QuizInfo } from '../../api/training';
import { ApiError } from '../../lib/api-client';
import { QuizLesson } from './QuizLesson';
import { fakeLearner, lesson, paper, renderOnSide, result } from './training-fixtures';

/** A result before the right answers may be shown (review M9): right/wrong and the chosen answers' feedback only. */
const hiddenResult = (over: Parameters<typeof result>[0] = {}) =>
  result({
    answersShown: false,
    questions: result().questions.map((q) => ({
      ...q,
      explanation: null,
      options: q.options.map((o, i) => ({ ...o, correct: false, position: i, feedback: q.chosen.includes(o.id) ? o.feedback : null })),
    })),
    ...over,
  });

const QUIZ: QuizInfo = { passMark: 75, maxAttempts: 3, attemptsUsed: 0, timeLimitMinutes: null, questionCount: 4, best: null, openAttemptId: null, lastAttemptId: null, canStart: true, reason: null };
const quizLesson = (quiz: Partial<QuizInfo> = {}, over: Parameters<typeof lesson>[0] = {}) => lesson({ id: 'l4', kind: 'QUIZ', title: 'Check yourself', nextLessonId: null, quiz: { ...QUIZ, ...quiz }, ...over });
const take = (api: ReturnType<typeof fakeLearner>, onDone = vi.fn(), quiz: Partial<QuizInfo> = {}, over: Parameters<typeof lesson>[0] = {}) =>
  renderOnSide(<QuizLesson lesson={quizLesson(quiz, over)} onDone={onDone} />, { api, path: '/training/courses/c1/lessons/l4' });
const answerAll = async () => {
  await userEvent.click(await screen.findByRole('radio', { name: 'Top bar' }));
  await userEvent.click(screen.getByRole('button', { name: 'Next' }));
  await userEvent.click(screen.getByRole('checkbox', { name: 'Assignees' }));
  await userEvent.click(screen.getByRole('button', { name: 'Next' }));
  await userEvent.click(screen.getByRole('radio', { name: 'False' }));
  await userEvent.click(screen.getByRole('button', { name: 'Next' }));
};

afterEach(() => vi.useRealTimers());

describe('a quiz lesson (12 Nov §5)', () => {
  it('the start: one line (questions, pass mark, tries) and Start quiz — no fact tiles, no “Time limit: None”', async () => {
    const api = fakeLearner();
    take(api);
    expect(screen.getByText('4 questions · pass with 75% · 3 tries left')).toBeInTheDocument();
    for (const gone of ['Pass mark', 'Time limit', 'None', 'Attempts', '0 of 3 used']) expect(screen.queryByText(gone)).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Start quiz' }));
    expect(api.startAttempt).toHaveBeenCalledWith('l4');
    expect(await screen.findByText('Question 1 of 4')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Where is New task?' })).toBeInTheDocument();
    const dots = screen.getByRole('list', { name: 'Questions' });
    expect(within(dots).getAllByRole('button')).toHaveLength(4);
    expect(within(dots).getByRole('button', { name: 'Question 1, not answered' })).toHaveAttribute('aria-current', 'step');
    // One question a page: no “All questions on one page”.
    expect(screen.queryByRole('button', { name: /All questions on one page/ })).toBeNull();
  });

  it('one question a page with Back / Next; Hand in only on the last question or once all are answered; answers saved as given', async () => {
    const api = fakeLearner();
    take(api);
    await userEvent.click(screen.getByRole('button', { name: 'Start quiz' }));
    expect(await screen.findByRole('button', { name: 'Next' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Hand in' })).toBeNull();
    await userEvent.click(screen.getByRole('radio', { name: 'Top bar' }));
    expect(screen.getByRole('button', { name: 'Question 1, answered' })).toBeInTheDocument();
    await waitFor(() => expect(api.saveAnswers).toHaveBeenLastCalledWith('a1', { qs: ['o1'], qm: [], qt: [], qo: ['p3', 'p1', 'p2'] }), { timeout: 3000 });
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByText('Choose all that apply.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByRole('heading', { level: 2, name: 'Where is New task?' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Assignees' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Due day' }));
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    await userEvent.click(screen.getByRole('radio', { name: 'False' }));
    // Every question answered (put-in-order always is): Hand in shows, before the last page.
    expect(screen.getByRole('button', { name: 'Hand in' })).toBeInTheDocument();
    await waitFor(() => expect(api.saveAnswers).toHaveBeenLastCalledWith('a1', expect.objectContaining({ qm: ['o3', 'o4'], qt: ['o7'] })), { timeout: 3000 });
  });

  it('the last question shows Hand in; with questions unanswered it asks first', async () => {
    const api = fakeLearner({ submit: vi.fn(async () => hiddenResult()) });
    take(api);
    await userEvent.click(screen.getByRole('button', { name: 'Start quiz' }));
    await userEvent.click(await screen.findByRole('radio', { name: 'Top bar' }));
    await userEvent.click(screen.getByRole('button', { name: 'Question 4, answered' }));
    await userEvent.click(screen.getByRole('button', { name: 'Hand in' }));
    const ask = screen.getByRole('alertdialog', { name: 'Hand in with 2 questions unanswered?' });
    await userEvent.click(within(ask).getByRole('button', { name: 'Hand in' }));
    await waitFor(() => expect(api.submit).toHaveBeenCalledWith('a1', { qs: ['o1'], qm: [], qt: [], qo: ['p3', 'p1', 'p2'] }));
  });

  it('not passed: the score, which questions were wrong (not the right answers), and Try again', async () => {
    const api = fakeLearner({ submit: vi.fn(async () => hiddenResult()) });
    const onDone = vi.fn();
    take(api, onDone);
    await userEvent.click(screen.getByRole('button', { name: 'Start quiz' }));
    await answerAll();
    await userEvent.click(screen.getByRole('button', { name: 'Hand in' }));
    const heading = await screen.findByRole('heading', { level: 2, name: 'Not passed this time — 50%' });
    expect(heading).toHaveFocus();
    expect(screen.getByText('1 of 2 right · pass mark 75% · 2 tries left')).toBeInTheDocument();
    // 13 Nov new look: a small ring with the score, the pass mark as a notch on it.
    const ring = screen.getByRole('img', { name: 'Score 50%, pass mark 75%' });
    expect(ring).toHaveTextContent('50%');
    expect(ring.querySelector('[data-ring-arc]')!.getAttribute('class')).toContain('stroke-danger');
    expect(ring.querySelector('[data-ring-mark]')).not.toBeNull();
    // Not passed: no way on yet (the bar holds only the lesson before).
    const bar = within(document.querySelector<HTMLElement>('[data-lesson-footer]')!);
    expect(bar.getAllByRole('link').map((l) => l.textContent)).toEqual(['Previous lesson']);
    const wrong = screen.getByRole('list', { name: 'Wrong answers' });
    expect(within(wrong).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Put the steps in order.']);
    expect(screen.queryByText('Right answer')).toBeNull();
    expect(screen.queryByText('The right order')).toBeNull();
    expect(screen.queryByRole('button', { name: 'See your answers' })).toBeNull();
    expect(onDone).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(api.startAttempt).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('Question 1 of 4')).toBeInTheDocument();
  });

  it('passed and the course finished: the score, Course completed with the certificate, then Next; the answers folded; no Try again', async () => {
    const api = fakeLearner({ submit: vi.fn(async () => result({ scorePct: 100, passed: true, answersShown: true, attemptsLeft: 2, courseCompleted: true, certificateId: 'cert1' })) });
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:x');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    const onDone = vi.fn();
    take(api, onDone);
    await userEvent.click(screen.getByRole('button', { name: 'Start quiz' }));
    await answerAll();
    await userEvent.click(screen.getByRole('button', { name: 'Hand in' }));
    const score = await screen.findByRole('heading', { level: 2, name: 'You passed — 100%' });
    expect(onDone).toHaveBeenCalledWith(expect.objectContaining({ courseCompleted: true, certificateId: 'cert1' }));
    expect(screen.getByRole('img', { name: 'Score 100%, pass mark 75%' }).querySelector('[data-ring-arc]')!.getAttribute('class')).toContain('stroke-success');
    const done = screen.getByRole('heading', { name: 'Course completed' });
    expect(score.compareDocumentPosition(done) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Download certificate (PDF)' }));
    await waitFor(() => expect(api.certificatePdf).toHaveBeenCalledWith('cert1'));
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
    // The answers are folded behind “See your answers”.
    expect(screen.queryByRole('article', { name: 'Where is New task?' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'See your answers' }));
    expect(within(screen.getByRole('article', { name: 'Where is New task?' })).getByText('Right answer')).toBeInTheDocument();
    // Next: the course is finished → My learning (where Up next is), at the end of the footer bar.
    expect(within(document.querySelector<HTMLElement>('[data-lesson-footer]')!).getByRole('link', { name: 'Next' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('link', { name: 'Next' }));
    expect(screen.getByTestId('where')).toHaveTextContent(/^\/training$/);
  });

  it('passed with lessons after it: Next lesson', async () => {
    const api = fakeLearner({ submit: vi.fn(async () => result({ scorePct: 100, passed: true, answersShown: true, courseCompleted: false })) });
    take(api, vi.fn(), {}, { nextLessonId: 'l5' });
    await userEvent.click(screen.getByRole('button', { name: 'Start quiz' }));
    await answerAll();
    await userEvent.click(screen.getByRole('button', { name: 'Hand in' }));
    expect(await screen.findByRole('link', { name: 'Next lesson' })).toHaveAttribute('href', '/training/courses/c1/lessons/l5');
    expect(screen.queryByRole('heading', { name: 'Course completed' })).toBeNull();
  });

  it('back on a quiz already passed: “You passed”, See your answers and Next — no Try again', async () => {
    const api = fakeLearner({ result: vi.fn(async () => result({ scorePct: 100, passed: true, answersShown: true })) });
    take(api, vi.fn(), { attemptsUsed: 1, best: { scorePct: 100, passed: true }, lastAttemptId: 'a0' }, { nextLessonId: 'l5' });
    expect(screen.getByText('You passed with 100%.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Start quiz|Try again/ })).toBeNull();
    expect(screen.getByRole('link', { name: 'Next lesson' })).toHaveAttribute('href', '/training/courses/c1/lessons/l5');
    await userEvent.click(screen.getByRole('button', { name: 'See your answers' }));
    expect(api.result).toHaveBeenCalledWith('a0');
    expect(await screen.findByRole('article', { name: 'Where is New task?' })).toBeInTheDocument();
  });

  it('no attempts left: the right answers can be seen; no Try again', async () => {
    const api = fakeLearner({ submit: vi.fn(async () => result({ answersShown: true, attemptsLeft: 0 })) });
    take(api);
    await userEvent.click(screen.getByRole('button', { name: 'Start quiz' }));
    await answerAll();
    await userEvent.click(screen.getByRole('button', { name: 'Hand in' }));
    expect(await screen.findByText('1 of 2 right · pass mark 75% · no tries left')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'See your answers' }));
    const order = screen.getByRole('article', { name: 'Put the steps in order.' });
    expect(within(within(order).getByText('The right order').parentElement!).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Open the form', 'Type a title', 'Save']);
    expect(within(order).getByText('Open it first, then type, then save.')).toBeInTheDocument();
  });

  it('put-in-order with the keyboard: Move up / Move down, focus stays on the item, the move is said', async () => {
    const api = fakeLearner({ startAttempt: vi.fn(async () => paper({ questions: [paper().questions[3]!] })) });
    take(api);
    await userEvent.click(screen.getByRole('button', { name: 'Start quiz' }));
    const items = () => within(screen.getByText('Save').closest('ol')!).getAllByRole('listitem').map((li) => li.textContent?.replace(/^\d+\./, ''));
    expect(await screen.findByText(/Move up and Move down/)).toBeInTheDocument();
    expect(items()).toEqual(['Save', 'Open the form', 'Type a title']);
    screen.getByRole('button', { name: 'Move “Open the form” up' }).focus();
    await userEvent.keyboard('{Enter}');
    expect(items()).toEqual(['Open the form', 'Save', 'Type a title']);
    expect(screen.getByRole('button', { name: 'Move “Open the form” down' })).toHaveFocus();
    expect(screen.getByText('Moved “Open the form” to place 1 of 3.')).toBeInTheDocument();
    await waitFor(() => expect(api.saveAnswers).toHaveBeenLastCalledWith('a1', { qo: ['p1', 'p3', 'p2'] }), { timeout: 3000 });
  });

  it('a time limit: said on the start line; the countdown, said at one minute, handed in by itself at 0', async () => {
    vi.useFakeTimers();
    const now = Date.now();
    const api = fakeLearner({ startAttempt: vi.fn(async () => paper({ deadlineAt: new Date(now + 61_500).toISOString(), answers: { qs: ['o2'] } })) });
    take(api, vi.fn(), { timeLimitMinutes: 10 });
    expect(screen.getByText('4 questions · pass with 75% · 3 tries left · 10 min to answer')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Start quiz' }));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByRole('radio', { name: 'Footer' })).toBeChecked();
    expect(screen.getByText('1:02')).toBeInTheDocument();
    act(() => void vi.advanceTimersByTime(2_000));
    expect(screen.getByText('1:00')).toBeInTheDocument();
    expect(screen.getByText('One minute left.')).toBeInTheDocument();
    expect(api.submit).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(60_000);
      await Promise.resolve();
    });
    expect(api.submit).toHaveBeenCalledTimes(1);
    expect(api.submit).toHaveBeenCalledWith('a1', expect.objectContaining({ qs: ['o2'] }));
  });

  it('handed in already by the server (time up): its result is shown', async () => {
    const api = fakeLearner({ submit: vi.fn(async () => Promise.reject(new ApiError(409, 'TIME_UP', 'Time is up — your saved answers were handed in.'))) });
    api.result.mockResolvedValue(result({ timedOut: true }));
    take(api);
    await userEvent.click(screen.getByRole('button', { name: 'Start quiz' }));
    await answerAll();
    await userEvent.click(screen.getByRole('button', { name: 'Hand in' }));
    expect(await screen.findByText('Time ran out — your saved answers were handed in.')).toBeInTheDocument();
    expect(api.result).toHaveBeenCalledWith('a1');
  });

  it('an open attempt resumes; tried before: the best score and Try again; no attempts left says why', async () => {
    const api = fakeLearner();
    const one = take(api, vi.fn(), { openAttemptId: 'a1', attemptsUsed: 1 });
    expect(screen.getByRole('button', { name: 'Resume quiz' })).toBeInTheDocument();
    one.unmount();
    const two = take(api, vi.fn(), { attemptsUsed: 1, lastAttemptId: 'a0', best: { scorePct: 50, passed: false } });
    expect(screen.getByText('Your best so far: 50%.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    two.unmount();
    take(api, vi.fn(), { attemptsUsed: 3, canStart: false, reason: 'No attempts left.', lastAttemptId: 'a0', best: { scorePct: 50, passed: false } });
    expect(screen.queryByRole('button', { name: /Start quiz|Try again/ })).toBeNull();
    expect(screen.getByText('No attempts left.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'See your last result' }));
    expect(api.result).toHaveBeenCalledWith('a0');
    expect(await screen.findByRole('heading', { level: 2, name: 'Not passed this time — 50%' })).toBeInTheDocument();
  });
});
