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
const take = (api: ReturnType<typeof fakeLearner>, onDone = vi.fn(), quiz: Partial<QuizInfo> = {}, over: Parameters<typeof lesson>[0] = {}, covers: string[] = []) =>
  renderOnSide(<QuizLesson lesson={quizLesson(quiz, over)} onDone={onDone} covers={covers} />, { api, path: '/training/courses/c1/lessons/l4' });
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
  it('the start page (1.23.36): what to expect — questions, pass mark, tries, minutes — what it covers, then Start quiz', async () => {
    const api = fakeLearner();
    take(api, vi.fn(), {}, { minutes: 3 }, ['Find your way around', 'Video: Getting started']);
    const facts = within(screen.getByRole('list', { name: 'About this quiz' }));
    expect(facts.getAllByRole('listitem').map((li) => li.textContent)).toEqual(['4 questions', 'Pass mark 75%', '3 tries left', 'About 3 min']);
    const covers = within(screen.getByRole('list', { name: 'This quiz covers' }));
    expect(covers.getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Find your way around', 'Video: Getting started']);
    expect(screen.getByText('This quiz covers:')).toBeInTheDocument();
    for (const gone of ['Time limit', 'None', 'Attempts', '0 of 3 used']) expect(screen.queryByText(gone)).toBeNull();
    // No way on or back inside the quiz: the lesson's panel (or the phone's bar) holds it.
    expect(document.querySelector('[data-lesson-footer]')).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
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
    // A small ring with the score — and no stray mark on it (1.23.36: the pass mark is said in words beside it).
    const ring = screen.getByRole('img', { name: 'Score 50%, pass mark 75%' });
    expect(ring).toHaveTextContent('50%');
    expect(ring.querySelector('[data-ring-arc]')!.getAttribute('class')).toContain('stroke-danger');
    expect(ring.querySelector('[data-ring-mark]')).toBeNull();
    expect(ring.querySelectorAll('line')).toHaveLength(0);
    // No footer bar inside the quiz (the lesson's panel or bar holds the way on).
    expect(document.querySelector('[data-lesson-footer]')).toBeNull();
    const wrong = screen.getByRole('list', { name: 'Wrong answers' });
    expect(within(wrong).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Put the steps in order.']);
    expect(screen.queryByText('Right answer')).toBeNull();
    expect(screen.queryByText('The right order')).toBeNull();
    expect(screen.queryByRole('button', { name: /you got right/ })).toBeNull();
    expect(onDone).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(api.startAttempt).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('Question 1 of 4')).toBeInTheDocument();
  });

  it('passed and the course finished: the score, Course completed with the certificate, then Next (My learning); no Try again', async () => {
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
    // The right answer is folded (one click shows the ones they got right).
    expect(screen.queryByRole('article', { name: 'Where is New task?' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Show the 1 you got right' }));
    expect(within(screen.getByRole('article', { name: 'Where is New task?' })).getByText('Right answer')).toBeInTheDocument();
    // Next: the course is finished → My learning (where Up next is), under Course completed.
    expect(screen.getAllByRole('link')).toHaveLength(1);
    await userEvent.click(screen.getByRole('link', { name: 'Next' }));
    expect(screen.getByTestId('where')).toHaveTextContent(/^\/training$/);
  });

  it('passed with lessons after it: no Course completed, and the way on is the lesson’s (no link inside the quiz)', async () => {
    const api = fakeLearner({ submit: vi.fn(async () => result({ scorePct: 100, passed: true, answersShown: true, courseCompleted: false })) });
    const onDone = vi.fn();
    take(api, onDone, {}, { nextLessonId: 'l5' });
    await userEvent.click(screen.getByRole('button', { name: 'Start quiz' }));
    await answerAll();
    await userEvent.click(screen.getByRole('button', { name: 'Hand in' }));
    expect(await screen.findByRole('heading', { level: 2, name: 'You passed — 100%' })).toBeInTheDocument();
    expect(onDone).toHaveBeenCalledWith(expect.objectContaining({ courseCompleted: false, nextLessonId: 'l5' }));
    expect(screen.queryByRole('heading', { name: 'Course completed' })).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('the review (1.23.36): wrong answers first and open; the right ones folded under “Show the N you got right”, all at once', async () => {
    const r = result();
    const third = { ...r.questions[0]!, id: 'q3', prompt: 'Which button saves?', chosen: ['o9'], options: [{ id: 'o9', text: 'Save', correct: true, position: 0, feedback: null }], explanation: 'Save keeps it.' };
    const api = fakeLearner({ submit: vi.fn(async () => result({ scorePct: 67, passed: false, answersShown: true, attemptsLeft: 0, questions: [r.questions[0]!, r.questions[1]!, third] })) });
    take(api);
    await userEvent.click(screen.getByRole('button', { name: 'Start quiz' }));
    await answerAll();
    await userEvent.click(screen.getByRole('button', { name: 'Hand in' }));
    await screen.findByRole('heading', { level: 2, name: 'Not passed this time — 67%' });
    // The wrong one, open, keeps its own number and its “Why”.
    const wrong = within(screen.getByRole('list', { name: 'Answers you got wrong' }));
    expect(wrong.getAllByRole('article').map((a) => a.querySelector('h3')!.textContent)).toEqual(['Put the steps in order.']);
    expect(wrong.getByText(/Question 2/)).toBeInTheDocument();
    expect(wrong.getByText('Open it first, then type, then save.')).toBeInTheDocument();
    // The right ones: folded, then all at once, in their order, with their numbers.
    const show = screen.getByRole('button', { name: 'Show the 2 you got right' });
    expect(show).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('article', { name: 'Where is New task?' })).toBeNull();
    await userEvent.click(show);
    expect(screen.getByRole('button', { name: 'Hide the 2 you got right' })).toHaveAttribute('aria-expanded', 'true');
    const right = within(screen.getByRole('list', { name: 'Answers you got right' }));
    expect(right.getAllByRole('article').map((a) => a.querySelector('h3')!.textContent)).toEqual(['Where is New task?', 'Which button saves?']);
    expect(right.getByText(/Question 1/)).toBeInTheDocument();
    expect(right.getByText(/Question 3/)).toBeInTheDocument();
    expect(right.getByText('Save keeps it.')).toBeInTheDocument();
    // Wrong ones come first on the page.
    const firstWrong = screen.getByRole('article', { name: 'Put the steps in order.' });
    const firstRight = screen.getByRole('article', { name: 'Where is New task?' });
    expect(firstWrong.compareDocumentPosition(firstRight) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('every answer right: just “Show the N you got right”', async () => {
    const all = result({ scorePct: 100, passed: true, answersShown: true, questions: [result().questions[0]!] });
    const api = fakeLearner({ submit: vi.fn(async () => all) });
    take(api);
    await userEvent.click(screen.getByRole('button', { name: 'Start quiz' }));
    await answerAll();
    await userEvent.click(screen.getByRole('button', { name: 'Hand in' }));
    await screen.findByRole('heading', { level: 2, name: 'You passed — 100%' });
    expect(screen.getByText('1 of 1 right · pass mark 75%')).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Answers you got wrong' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Show the 1 you got right' })).toBeInTheDocument();
  });

  it('back on a quiz already passed: “You passed” and See your answers — no Try again', async () => {
    const api = fakeLearner({ result: vi.fn(async () => result({ scorePct: 100, passed: true, answersShown: true })) });
    const onActivity = vi.fn();
    renderOnSide(<QuizLesson lesson={quizLesson({ attemptsUsed: 1, best: { scorePct: 100, passed: true }, lastAttemptId: 'a0' }, { nextLessonId: 'l5' })} onDone={vi.fn()} onActivity={onActivity} />, { api, path: '/training/courses/c1/lessons/l4' });
    expect(screen.getByText('You passed with 100%.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Start quiz|Try again/ })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'See your answers' }));
    expect(api.result).toHaveBeenCalledWith('a0');
    expect(onActivity).toHaveBeenCalled();
    expect(await screen.findByRole('article', { name: 'Put the steps in order.' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Show the 1 you got right' }));
    expect(screen.getByRole('article', { name: 'Where is New task?' })).toBeInTheDocument();
  });

  it('no attempts left: the right answers can be seen; no Try again', async () => {
    const api = fakeLearner({ submit: vi.fn(async () => result({ answersShown: true, attemptsLeft: 0 })) });
    take(api);
    await userEvent.click(screen.getByRole('button', { name: 'Start quiz' }));
    await answerAll();
    await userEvent.click(screen.getByRole('button', { name: 'Hand in' }));
    expect(await screen.findByText('1 of 2 right · pass mark 75% · no tries left')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
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
    expect(within(screen.getByRole('list', { name: 'About this quiz' })).getByText('10 min to answer')).toBeInTheDocument();
    expect(screen.getByText(/The clock starts when you start/)).toBeInTheDocument();
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
