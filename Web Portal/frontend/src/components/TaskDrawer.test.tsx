import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TaskDrawer } from './TaskDrawer';
import type { ApiTask } from '../api/tasks';

const task: ApiTask = {
  id: 't1',
  key: 'MICO-1',
  title: 'Prepare monthly report',
  description: 'Gather figures and write it up.',
  projectId: 'p1',
  columnId: 'c1',
  position: 0,
  priority: 'HIGH',
  startDate: null,
  dueDate: null,
  progress: 40,
  completedAt: null,
  createdAt: '',
  updatedAt: '',
};

describe('TaskDrawer', () => {
  it('renders the task, checklist and comments', () => {
    render(
      <TaskDrawer
        task={task}
        checklist={[{ id: 'i1', text: 'Verify quotation', done: true }, { id: 'i2', text: 'Send it', done: false }]}
        comments={[{ id: 'c1', body: 'Started on this.', authorName: 'Omar Ahmed', createdAt: new Date().toISOString() }]}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByRole('dialog', { name: /MICO-1/ })).toBeInTheDocument();
    expect(screen.getByText('Prepare monthly report')).toBeInTheDocument();
    expect(screen.getByText('Gather figures and write it up.')).toBeInTheDocument();
    expect(screen.getByText('Verify quotation')).toBeInTheDocument();
    expect(screen.getByText('Started on this.')).toBeInTheDocument();
    // comment shows who + when
    expect(screen.getByText('Omar Ahmed')).toBeInTheDocument();
    expect(screen.getByText(/just now|ago/)).toBeInTheDocument();
    expect(screen.getByText(/50%/)).toBeInTheDocument(); // 1 of 2 checklist items done
  });

  it('deletes a task, offering a series option for recurring tasks', async () => {
    const onDelete = vi.fn();
    const { unmount } = render(<TaskDrawer task={task} checklist={[]} comments={[]} onDelete={onDelete} onClose={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: /delete task/i }));
    await userEvent.click(screen.getByRole('button', { name: /^Delete$/ }));
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onDelete.mock.calls[0]![0]).toBeUndefined();
    unmount();

    onDelete.mockClear();
    render(
      <TaskDrawer
        task={{ ...task, recurrenceRule: { freq: 'MONTHLY', interval: 1 } }}
        checklist={[]}
        comments={[]}
        onDelete={onDelete}
        onClose={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: /delete task/i }));
    await userEvent.click(screen.getByRole('button', { name: /entire series/i }));
    expect(onDelete).toHaveBeenCalledWith('series');
  });

  it('edits the task fields and saves via onSaveEdit (single-task scope by default)', async () => {
    const onSaveEdit = vi.fn();
    render(<TaskDrawer task={task} checklist={[]} comments={[]} onSaveEdit={onSaveEdit} onClose={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: /^edit$/i }));
    const titleInput = screen.getByLabelText(/^title$/i);
    await userEvent.clear(titleInput);
    await userEvent.type(titleInput, 'Reworked report');
    await userEvent.selectOptions(screen.getByLabelText(/^priority$/i), 'URGENT');
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }));
    expect(onSaveEdit).toHaveBeenCalledTimes(1);
    const [patch, scope] = onSaveEdit.mock.calls[0]!;
    expect(patch.title).toBe('Reworked report');
    expect(patch.priority).toBe('URGENT');
    expect(scope).toBeUndefined();
  });

  it('offers an "entire series" scope when editing a recurring task', async () => {
    const onSaveEdit = vi.fn();
    render(
      <TaskDrawer
        task={{ ...task, recurrenceRule: { freq: 'MONTHLY', interval: 1 } }}
        checklist={[]}
        comments={[]}
        onSaveEdit={onSaveEdit}
        onClose={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: /^edit$/i }));
    await userEvent.click(screen.getByLabelText(/entire series/i));
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }));
    expect(onSaveEdit).toHaveBeenCalledTimes(1);
    expect(onSaveEdit.mock.calls[0]![1]).toBe('series');
  });

  it('toggles a checklist item via its checkbox', async () => {
    const onToggleChecklistItem = vi.fn();
    render(
      <TaskDrawer
        task={task}
        checklist={[{ id: 'i1', text: 'Verify quotation', done: false }]}
        comments={[]}
        onToggleChecklistItem={onToggleChecklistItem}
        onClose={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByRole('checkbox', { name: /Verify quotation/i }));
    expect(onToggleChecklistItem).toHaveBeenCalledWith('i1', true);
  });

  it('adds a checklist item', async () => {
    const onAddChecklistItem = vi.fn();
    render(<TaskDrawer task={task} checklist={[]} comments={[]} onAddChecklistItem={onAddChecklistItem} onClose={vi.fn()} />);
    await userEvent.type(screen.getByPlaceholderText(/add an item/i), 'New step');
    await userEvent.click(screen.getByRole('button', { name: /add item/i }));
    expect(onAddChecklistItem).toHaveBeenCalledWith('New step');
  });

  it('requests AI checklist suggestions via onSuggestChecklist', async () => {
    const onSuggestChecklist = vi.fn().mockResolvedValue(undefined);
    render(<TaskDrawer task={task} checklist={[]} comments={[]} onAddChecklistItem={vi.fn()} onSuggestChecklist={onSuggestChecklist} onClose={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: /suggest steps/i }));
    expect(onSuggestChecklist).toHaveBeenCalledTimes(1);
  });

  it('does not offer AI suggestions when onSuggestChecklist is absent', () => {
    render(<TaskDrawer task={task} checklist={[]} comments={[]} onAddChecklistItem={vi.fn()} onClose={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /suggest steps/i })).not.toBeInTheDocument();
  });

  it('suggests a priority into the edit form via onSuggestPriority', async () => {
    const onSuggestPriority = vi.fn().mockResolvedValue({ priority: 'URGENT', reason: 'Due tomorrow and blocks two tasks.' });
    render(<TaskDrawer task={task} checklist={[]} comments={[]} onSaveEdit={vi.fn()} onSuggestPriority={onSuggestPriority} onClose={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: /^edit$/i }));
    await userEvent.click(screen.getByRole('button', { name: /suggest priority/i }));
    expect(onSuggestPriority).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(/Due tomorrow and blocks two tasks/)).toBeInTheDocument();
    expect((screen.getByLabelText(/^priority$/i) as HTMLSelectElement).value).toBe('URGENT');
  });

  it('posts a comment', async () => {
    const onAddComment = vi.fn();
    render(<TaskDrawer task={task} checklist={[]} comments={[]} onAddComment={onAddComment} onClose={vi.fn()} />);
    await userEvent.type(screen.getByPlaceholderText(/write a comment/i), 'Looks good');
    await userEvent.click(screen.getByRole('button', { name: /^comment$/i }));
    expect(onAddComment).toHaveBeenCalledWith('Looks good');
  });

  it('shows assignees and assigns / unassigns teammates', async () => {
    const onAssignUser = vi.fn();
    const onUnassignUser = vi.fn();
    render(
      <TaskDrawer
        task={task}
        checklist={[]}
        comments={[]}
        assignees={[{ id: 'u1', name: 'Ada Lovelace' }]}
        assignableUsers={[{ id: 'u2', name: 'Omar A' }]}
        onAssignUser={onAssignUser}
        onUnassignUser={onUnassignUser}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /remove Ada Lovelace/i }));
    expect(onUnassignUser).toHaveBeenCalledWith('u1');
    await userEvent.selectOptions(screen.getByLabelText(/assign a teammate/i), 'u2');
    await userEvent.click(screen.getByRole('button', { name: /^assign$/i }));
    expect(onAssignUser).toHaveBeenCalledWith('u2');
  });

  it('calls onClose when the close button is clicked', async () => {
    const onClose = vi.fn();
    render(<TaskDrawer task={task} checklist={[]} comments={[]} onClose={onClose} />);
    await userEvent.click(screen.getByRole('button', { name: /close/i }));
    expect(onClose).toHaveBeenCalled();
  });

  it('renders attachments as download links with a human-readable size', () => {
    render(
      <TaskDrawer
        task={task}
        checklist={[]}
        comments={[]}
        attachments={[{ id: 'a1', filename: 'spec.pdf', url: '/uploads/a1.pdf', sizeBytes: 2048 }]}
        onClose={vi.fn()}
      />,
    );
    const link = screen.getByRole('link', { name: /spec\.pdf/ });
    // Resolves to the uploads path + filename; the origin is absolute or same-origin depending on
    // VITE_API_URL (same-origin behind the task.mico360.com / dev proxy), so match the path suffix.
    expect(link.getAttribute('href')).toMatch(/\/uploads\/a1\.pdf$/);
    expect(screen.getByText(/2\.0 KB/)).toBeInTheDocument();
  });

  it('uploads a chosen file via onUploadFile', async () => {
    const onUploadFile = vi.fn();
    render(<TaskDrawer task={task} checklist={[]} comments={[]} attachments={[]} onUploadFile={onUploadFile} onClose={vi.fn()} />);
    const input = screen.getByLabelText(/attach a file/i) as HTMLInputElement;
    const file = new File(['data'], 'note.txt', { type: 'text/plain' });
    await userEvent.upload(input, file);
    expect(onUploadFile).toHaveBeenCalledWith(file);
  });

  it('removes an attachment via onDeleteAttachment', async () => {
    const onDeleteAttachment = vi.fn();
    render(
      <TaskDrawer
        task={task}
        checklist={[]}
        comments={[]}
        attachments={[{ id: 'a1', filename: 'spec.pdf', url: '/uploads/a1.pdf', sizeBytes: 10 }]}
        onDeleteAttachment={onDeleteAttachment}
        onClose={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: /remove spec\.pdf/i }));
    expect(onDeleteAttachment).toHaveBeenCalledWith('a1');
  });

  it('lets the user set recurrence when onSetRecurrence is provided', async () => {
    const onSetRecurrence = vi.fn();
    render(<TaskDrawer task={task} checklist={[]} comments={[]} onSetRecurrence={onSetRecurrence} onClose={vi.fn()} />);
    await userEvent.selectOptions(screen.getByLabelText(/^repeat$/i), 'MONTHLY');
    expect(onSetRecurrence).toHaveBeenCalledWith({ freq: 'MONTHLY', interval: 1 });
  });

  it('shows a recurrence badge when the task recurs', () => {
    render(
      <TaskDrawer
        task={{ ...task, recurrenceRule: { freq: 'WEEKLY', interval: 1, weekdays: [1, 3, 5] } }}
        checklist={[]}
        comments={[]}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText(/Repeats every week on Mon, Wed, Fri/)).toBeInTheDocument();
  });

  it('shows blocking dependencies with their task keys', () => {
    render(
      <TaskDrawer
        task={task}
        checklist={[]}
        comments={[]}
        dependencies={{
          blockedBy: [{ id: 't2', key: 'MICO-2', title: 'Do first' }],
          blocks: [{ id: 't3', key: 'MICO-3', title: 'Waits on us' }],
        }}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText(/MICO-2/)).toBeInTheDocument();
    expect(screen.getByText(/Do first/)).toBeInTheDocument();
    expect(screen.getByText(/MICO-3/)).toBeInTheDocument();
  });

  it('adds a blocker via onAddDependency', async () => {
    const onAddDependency = vi.fn();
    render(
      <TaskDrawer
        task={task}
        checklist={[]}
        comments={[]}
        dependencies={{ blockedBy: [], blocks: [] }}
        availableTasks={[{ id: 't2', key: 'MICO-2', title: 'Do first' }]}
        onAddDependency={onAddDependency}
        onClose={vi.fn()}
      />,
    );
    await userEvent.selectOptions(screen.getByLabelText(/add a blocking task/i), 't2');
    await userEvent.click(screen.getByRole('button', { name: /add blocker/i }));
    expect(onAddDependency).toHaveBeenCalledWith('t2');
  });

  it('removes a blocker via onRemoveDependency', async () => {
    const onRemoveDependency = vi.fn();
    render(
      <TaskDrawer
        task={task}
        checklist={[]}
        comments={[]}
        dependencies={{ blockedBy: [{ id: 't2', key: 'MICO-2', title: 'Do first' }], blocks: [] }}
        onRemoveDependency={onRemoveDependency}
        onClose={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: /remove blocker MICO-2/i }));
    expect(onRemoveDependency).toHaveBeenCalledWith('t2');
  });
});
