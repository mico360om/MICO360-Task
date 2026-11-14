import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FeedbackTab } from './FeedbackTab';
import { fakeTrainingApi, feedbackItem, type FakeTrainingApi } from './test-api';
import { renderManage } from './test-render';
import { ApiError } from '../../../lib/api-client';

let api: FakeTrainingApi;
const fake = vi.hoisted(() => ({ api: null as FakeTrainingApi | null }));
vi.mock('../../../api/training', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../api/training')>()),
  trainingApi: (await import('./test-api')).followFake(() => fake.api),
}));

const ITEMS = [
  feedbackItem({ id: 'q-open', kind: 'QUESTION', body: 'How do I move a task to another project?', byName: 'Sam Shared' }),
  feedbackItem({ id: 'q-done', kind: 'QUESTION', body: 'Can I undo a delete?', status: 'ANSWERED', answer: 'Yes, from the Recycle Bin.', answeredAt: '2026-11-04T08:00:00.000Z', byName: 'Omar Ahmed' }),
  feedbackItem({ id: 'o1', kind: 'OUTDATED', lessonId: 'l2', lessonTitle: 'Make a task', body: 'The button moved to the top bar.' }),
  feedbackItem({ id: 'o2', kind: 'OUTDATED', lessonId: 'l3', lessonTitle: 'Board columns', body: 'Old picture', status: 'FIXED' }),
  feedbackItem({ id: 'r1', kind: 'RATING', rating: 5, body: 'Clear and short.', byName: 'Sam Shared' }),
  feedbackItem({ id: 'r2', kind: 'RATING', rating: 4, body: null, byName: 'Omar Ahmed' }),
  feedbackItem({ id: 'r3', kind: 'RATING', courseId: 'c2', courseTitle: 'Meetings basics', rating: 2, body: 'Too long', byName: 'Lina' }),
];

beforeEach(() => {
  api = fake.api = fakeTrainingApi();
  api.feedbackList.mockResolvedValue({ items: ITEMS });
});

describe('Training Center → Feedback', () => {
  it('a rating row keeps a real basis for its words, so they never shrink to one letter a line beside the stars', async () => {
    renderManage(<FeedbackTab />);
    const ratings = await screen.findByRole('region', { name: 'Ratings' });
    const body = within(ratings).getByText('Clear and short.').closest('[data-feedback-body]')!;
    expect(body.className).toContain('flex-[1_1_10rem]');
    expect(body.className).not.toMatch(/(^|\s)flex-1(\s|$)/);
  });

  it('questions (open ones can be answered, answered ones show the answer), problems reported and ratings', async () => {
    renderManage(<FeedbackTab />);
    const questions = await screen.findByRole('region', { name: 'Questions' });
    const open = within(questions).getByText('How do I move a task to another project?').closest('li')!;
    expect(within(open).getByText(/Tasks basics · Sam Shared/)).toBeInTheDocument();
    expect(within(open).getByRole('textbox', { name: 'Your answer to Sam Shared' })).toBeInTheDocument();
    const answered = within(questions).getByText('Can I undo a delete?').closest('li')!;
    expect(within(answered).getByText('Yes, from the Recycle Bin.')).toBeInTheDocument();
    expect(within(answered).getByText('Answered')).toBeInTheDocument();
    expect(within(answered).queryByRole('textbox')).toBeNull();

    // 12 Nov: “Report a problem” (was “Report outdated”): the words follow.
    expect(screen.queryByText(/Outdated/)).toBeNull();
    expect(screen.getByRole('option', { name: 'Problems' })).toBeInTheDocument();
    const outdated = screen.getByRole('region', { name: 'Problems reported' });
    const o1 = within(outdated).getByText('The button moved to the top bar.').closest('li')!;
    expect(within(o1).getByText(/Lesson: Make a task/)).toBeInTheDocument();
    expect(within(o1).getByRole('button', { name: 'Mark fixed' })).toBeInTheDocument();
    const o2 = within(outdated).getByText('Old picture').closest('li')!;
    expect(within(o2).getByText('Fixed')).toBeInTheDocument();
    expect(within(o2).queryByRole('button', { name: 'Mark fixed' })).toBeNull();

    const ratings = screen.getByRole('region', { name: 'Ratings' });
    const tasks = within(ratings).getByRole('heading', { name: 'Tasks basics' }).closest('li')!;
    expect(within(tasks).getByText('4.5 average · 2 ratings')).toBeInTheDocument();
    expect(within(tasks).getByText('Clear and short.')).toBeInTheDocument();
    expect(within(tasks).getAllByRole('img', { name: /of 5 stars/ }).map((s) => s.getAttribute('aria-label'))).toEqual(['5 of 5 stars', '5 of 5 stars', '4 of 5 stars']);
    const meetings = within(ratings).getByRole('heading', { name: 'Meetings basics' }).closest('li')!;
    expect(within(meetings).getByText('2 average · 1 rating')).toBeInTheDocument();
  });

  it('answers a question: the asker is told, and it shows as answered', async () => {
    api.answer.mockResolvedValue(feedbackItem({ id: 'q-open', kind: 'QUESTION', status: 'ANSWERED', answer: 'Use Move in its ⋯ menu.' }));
    renderManage(<FeedbackTab />);
    const box = await screen.findByRole('textbox', { name: 'Your answer to Sam Shared' });
    const item = box.closest('li')!;
    await userEvent.click(within(item).getByRole('button', { name: 'Send answer' }));
    expect(within(item).getByText('Write an answer first.')).toBeInTheDocument();
    await userEvent.type(box, 'Use Move in its ⋯ menu.');
    await userEvent.click(within(item).getByRole('button', { name: 'Send answer' }));
    await waitFor(() => expect(api.answer).toHaveBeenCalledWith('q-open', 'Use Move in its ⋯ menu.'));
    expect(await screen.findByText('Answer sent. Sam Shared is told.')).toBeInTheDocument();
    expect(api.feedbackList.mock.calls.length).toBeGreaterThan(1);
  });

  it('a refused answer says why and keeps the words', async () => {
    api.answer.mockRejectedValue(new ApiError(400, 'VALIDATION', 'That answer is too long.'));
    renderManage(<FeedbackTab />);
    const box = await screen.findByRole('textbox', { name: 'Your answer to Sam Shared' });
    await userEvent.type(box, 'Long words');
    await userEvent.click(within(box.closest('li')!).getByRole('button', { name: 'Send answer' }));
    expect(await screen.findByText(/That answer is too long\./)).toBeInTheDocument();
    expect(box).toHaveValue('Long words');
  });

  it('Mark fixed', async () => {
    renderManage(<FeedbackTab />);
    const outdated = await screen.findByRole('region', { name: 'Problems reported' });
    await userEvent.click(within(outdated).getByRole('button', { name: 'Mark fixed' }));
    await waitFor(() => expect(api.markFixed).toHaveBeenCalledWith('o1'));
  });

  it('filters by kind and status on the server', async () => {
    renderManage(<FeedbackTab />);
    await screen.findByRole('region', { name: 'Questions' });
    expect(api.feedbackList).toHaveBeenLastCalledWith({ kind: '', status: '' });
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Kind' }), 'QUESTION');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Status' }), 'OPEN');
    await waitFor(() => expect(api.feedbackList).toHaveBeenLastCalledWith({ kind: 'QUESTION', status: 'OPEN' }));
    expect(screen.queryByRole('region', { name: 'Ratings' })).toBeNull();
  });
});
