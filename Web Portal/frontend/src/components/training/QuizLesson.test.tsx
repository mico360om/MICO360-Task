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
const quizLesson = (quiz: Partial<QuizInfo> = {}) => lesson({ id: 'l4', kind: 'QUIZ', title: 'Check yourself', quiz: { ...QUIZ, ...quiz } });
const take = (api: ReturnType<typeof fakeLearner>, onDone = vi.fn(), quiz: Partial<QuizInfo> = {}) => renderOnSide(<QuizLesson lesson={quizLesson(quiz)} onDone={onDone} />, { api });

afterEach(() => vi.useRealTimers());

describe('a quiz lesson', () => {
  it('the intro: pass mark, questions, time limit, attempts; Start opens the paper, one question at a time', async () => {
    const api = fakeLearner();
    take(api);
    expect(screen.getByText('75%')).toBeInTheDocument();
    expect(screen.getByText('4 questions')).toBeInTheDocument();
    expect(screen.getByText('None')).toBeInTheDocument();
    expect(screen.getByText('0 of 3 used')).toBeInTheDocument();
    expect(screen.getByText('3 attempts left')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Start quiz' }));
    expect(api.startAttempt).toHaveBeenCalledWith('l4');
    expect(await screen.findByText('Question 1 of 4')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Where is New task?' })).toBeInTheDocument();
    const dots = screen.getByRole('list', { name: 'Questions' });
    expect(within(dots).getAllByRole('button')).toHaveLength(4);
    expect(within(dots).getByRole('button', { name: 'Question 1, not answered' })).toHaveAttribute('aria-current', 'step');
  });

  it('answers are saved as they are given (single, several, true/false)', async () => {
    const api = fakeLearner();
    take(api);
    await userEvent.click(screen.getByRole('button', { name: 'Start quiz' }));
    await userEvent.click(await screen.findByRole('radio', { name: 'Top bar' }));
    expect(screen.getByRole('button', { name: 'Question 1, answered' })).toBeInTheDocument();
    await waitFor(() => expect(api.saveAnswers).toHaveBeenCalled(), { timeout: 3000 });
    expect(api.saveAnswers).toHaveBeenLastCalledWith('a1', { qs: ['o1'], qm: [], qt: [], qo: ['p3', 'p1', 'p2'] });
    await userEvent.click(screen.getByRole('button', { name: 'Next question' }));
    expect(screen.getByText('Choose all that apply.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Assignees' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Due day' }));
    await userEvent.click(screen.getByRole('button', { name: 'Next question' }));
    await userEvent.click(screen.getByRole('radio', { name: 'False' }));
    await waitFor(() => expect(api.saveAnswers).toHaveBeenLastCalledWith('a1', expect.objectContaining({ qm: ['o3', 'o4'], qt: ['o7'] })), { timeout: 3000 });
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
    // At the top now: focus moves to its Move down (its Move up is off).
    expect(screen.getByRole('button', { name: 'Move “Open the form” down' })).toHaveFocus();
    expect(screen.getByText('Moved “Open the form” to place 1 of 3.')).toBeInTheDocument();
    screen.getByRole('button', { name: 'Move “Save” down' }).focus();
    await userEvent.keyboard(' ');
    expect(items()).toEqual(['Open the form', 'Type a title', 'Save']);
    expect(screen.getByRole('button', { name: 'Move “Save” up' })).toHaveFocus();
    await waitFor(() => expect(api.saveAnswers).toHaveBeenLastCalledWith('a1', { qo: ['p1', 'p2', 'p3'] }), { timeout: 3000 });
  });

  it('handing in with questions unanswered asks first; before passing, right/wrong and your answers’ feedback — not which are right (review M9); Try again', async () => {
    const api = fakeLearner({ submit: vi.fn(async () => hiddenResult()) });
    const onDone = vi.fn();
    take(api, onDone);
    await userEvent.click(screen.getByRole('button', { name: 'Start quiz' }));
    await userEvent.click(await screen.findByRole('radio', { name: 'Top bar' }));
    await userEvent.click(screen.getByRole('button', { name: 'Hand in' }));
    const ask = screen.getByRole('alertdialog', { name: 'Hand in with 2 questions unanswered?' });
    await userEvent.click(within(ask).getByRole('button', { name: 'Hand in' }));
    await waitFor(() => expect(api.submit).toHaveBeenCalledWith('a1', { qs: ['o1'], qm: [], qt: [], qo: ['p3', 'p1', 'p2'] }));
    const heading = await screen.findByRole('heading', { level: 2, name: 'Not passed this time — 50%' });
    expect(heading).toHaveFocus();
    expect(screen.getByText(/1 of 2 right · pass mark 75% · 2 attempts left/)).toBeInTheDocument();
    expect(screen.getByText('The right answers are shown once you pass or have no attempts left.')).toBeInTheDocument();
    const first = screen.getByRole('article', { name: 'Where is New task?' });
    expect(within(first).getByText('Right')).toBeInTheDocument();
    expect(within(first).getByText('Your answer')).toBeInTheDocument();
    expect(within(first).getByText('Yes — on every page.')).toBeInTheDocument();
    expect(screen.queryByText('Right answer')).toBeNull();
    const order = screen.getByRole('article', { name: 'Put the steps in order.' });
    expect(within(order).getByText('Wrong')).toBeInTheDocument();
    expect(within(within(order).getByText('Your order').parentElement!).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Type a title', 'Open the form', 'Save']);
    expect(within(order).queryByText('The right order')).toBeNull();
    expect(screen.queryByText(/^Why:/)).toBeNull();
    expect(onDone).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(api.startAttempt).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('Question 1 of 4')).toBeInTheDocument();
  });

  it('no attempts left: the right answers, every answer’s feedback and the explanation are shown', async () => {
    const api = fakeLearner({ submit: vi.fn(async () => result({ answersShown: true, attemptsLeft: 0 })) });
    take(api);
    await userEvent.click(screen.getByRole('button', { name: 'Start quiz' }));
    await userEvent.click(await screen.findByRole('radio', { name: 'Footer' }));
    await userEvent.click(screen.getByRole('button', { name: 'Hand in' }));
    await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Hand in' }));
    const first = await screen.findByRole('article', { name: 'Where is New task?' });
    expect(within(first).getByText('Right answer')).toBeInTheDocument();
    expect(within(first).getByText('Yes — on every page.')).toBeInTheDocument();
    expect(screen.queryByText('The right answers are shown once you pass or have no attempts left.')).toBeNull();
    const order = screen.getByRole('article', { name: 'Put the steps in order.' });
    expect(within(within(order).getByText('The right order').parentElement!).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Open the form', 'Type a title', 'Save']);
    expect(within(order).getByText('Open it first, then type, then save.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  });

  it('unlimited attempts: the right answers once passed', async () => {
    const api = fakeLearner({ submit: vi.fn(async () => hiddenResult({ attemptsLeft: null })) });
    take(api, vi.fn(), { maxAttempts: null });
    await userEvent.click(screen.getByRole('button', { name: 'Start quiz' }));
    await userEvent.click(await screen.findByRole('radio', { name: 'Top bar' }));
    await userEvent.click(screen.getByRole('button', { name: 'Hand in' }));
    await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Hand in' }));
    expect(await screen.findByText('The right answers are shown once you pass.')).toBeInTheDocument();
  });

  it('passing finishes the lesson (and no Try again once the attempts are used)', async () => {
    const api = fakeLearner({ submit: vi.fn(async () => result({ scorePct: 100, passed: true, answersShown: true, attemptsLeft: 0, courseCompleted: true, certificateId: 'cert1' })) });
    const onDone = vi.fn();
    take(api, onDone);
    await userEvent.click(screen.getByRole('button', { name: 'Start quiz' }));
    await userEvent.click(await screen.findByRole('button', { name: 'All questions on one page' }));
    expect(screen.getAllByText(/^Question \d of 4$/)).toHaveLength(4);
    await userEvent.click(screen.getByRole('radio', { name: 'Top bar' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Assignees' }));
    await userEvent.click(screen.getByRole('radio', { name: 'False' }));
    await userEvent.click(screen.getByRole('button', { name: 'Hand in' }));
    expect(await screen.findByRole('heading', { level: 2, name: 'You passed — 100%' })).toBeInTheDocument();
    expect(onDone).toHaveBeenCalledWith(expect.objectContaining({ courseCompleted: true, certificateId: 'cert1' }));
    // Passed: which answers are right is shown.
    expect(screen.getAllByText('Right answer').length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  });

  it('a time limit: the countdown, said at one minute, handed in by itself at 0', async () => {
    vi.useFakeTimers();
    const now = Date.now();
    const api = fakeLearner({ startAttempt: vi.fn(async () => paper({ deadlineAt: new Date(now + 61_500).toISOString(), answers: { qs: ['o2'] } })) });
    take(api, vi.fn(), { timeLimitMinutes: 10 });
    expect(screen.getByText('10 min')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Start quiz' }));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    // The saved draft is back.
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
    await userEvent.click(await screen.findByRole('radio', { name: 'Top bar' }));
    await userEvent.click(screen.getByRole('button', { name: 'Hand in' }));
    await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Hand in' }));
    expect(await screen.findByText('Time ran out — your saved answers were handed in.')).toBeInTheDocument();
    expect(api.result).toHaveBeenCalledWith('a1');
  });

  it('an open attempt resumes; the last result can be read; no attempts left says why', async () => {
    const api = fakeLearner();
    const one = take(api, vi.fn(), { openAttemptId: 'a1', attemptsUsed: 1 });
    expect(screen.getByRole('button', { name: 'Resume quiz' })).toBeInTheDocument();
    one.unmount();
    take(api, vi.fn(), { attemptsUsed: 3, canStart: false, reason: 'No attempts left for this quiz.', lastAttemptId: 'a0', best: { scorePct: 50, passed: false } });
    expect(screen.queryByRole('button', { name: /Start quiz|Try again/ })).toBeNull();
    expect(screen.getByText('No attempts left for this quiz.')).toBeInTheDocument();
    expect(screen.getByText(/Your best score:/)).toHaveTextContent('Your best score: 50% — not passed yet.');
    await userEvent.click(screen.getByRole('button', { name: 'See your last result' }));
    expect(api.result).toHaveBeenCalledWith('a0');
    expect(await screen.findByRole('heading', { level: 2, name: 'Not passed this time — 50%' })).toBeInTheDocument();
  });
});
