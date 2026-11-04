import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { TaskNoticeToast } from './TaskNoticeToast';
import { showTaskNotice, taskCreatedNotice, taskSavedNotice, useTaskNotice } from '../lib/task-notice';

function Where() {
  return <div data-testid="where">{useLocation().search}</div>;
}
const renderHost = () =>
  render(
    <MemoryRouter initialEntries={['/board?project=p1']}>
      <TaskNoticeToast />
      <Where />
    </MemoryRouter>,
  );

beforeEach(() => useTaskNotice.setState({ notice: null }));
afterEach(() => vi.useRealTimers());

describe('the task notice (1.22.3): "Task MICO-143 created" with Open', () => {
  it('words: created with the form, saved when an offline one syncs; several saved at once are listed', () => {
    expect(taskCreatedNotice({ id: 't1', key: 'MICO-143' })).toEqual({ text: 'Task MICO-143 created', taskId: 't1', key: 'MICO-143' });
    expect(taskSavedNotice([{ id: 't1', key: 'MICO-143' }])).toEqual({ text: 'Task MICO-143 saved', taskId: 't1', key: 'MICO-143' });
    expect(taskSavedNotice([{ id: 't1', key: 'MICO-143' }, { id: 't2', key: 'MICO-144' }])).toEqual({ text: 'Tasks MICO-143 and MICO-144 saved', taskId: null, key: null });
    expect(taskSavedNotice([{ id: 't1', key: 'A-1' }, { id: 't2', key: 'A-2' }, { id: 't3', key: 'A-3' }])).toEqual({ text: 'Tasks A-1, A-2 and A-3 saved', taskId: null, key: null });
    expect(taskSavedNotice([])).toBeNull();
  });

  it('shows the words (the number as plain text in the sentence) and Open opens the task in the panel', async () => {
    renderHost();
    act(() => showTaskNotice(taskCreatedNotice({ id: 't1', key: 'MICO-143' })));
    const toast = screen.getByRole('status');
    expect(toast).toHaveTextContent('Task MICO-143 created');
    expect(toast.querySelector('[data-task-key]')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Open MICO-143' }));
    expect(screen.getByTestId('where')).toHaveTextContent('?project=p1&task=t1');
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('several saved at once: no Open; Dismiss closes it', async () => {
    renderHost();
    act(() => showTaskNotice(taskSavedNotice([{ id: 't1', key: 'A-1' }, { id: 't2', key: 'A-2' }])));
    expect(screen.getByRole('status')).toHaveTextContent('Tasks A-1 and A-2 saved');
    expect(screen.queryByRole('button', { name: /^Open/ })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('goes away on its own after a while', () => {
    vi.useFakeTimers();
    renderHost();
    act(() => showTaskNotice(taskCreatedNotice({ id: 't1', key: 'MICO-143' })));
    expect(screen.getByRole('status')).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(8000));
    expect(screen.queryByRole('status')).toBeNull();
  });
});
