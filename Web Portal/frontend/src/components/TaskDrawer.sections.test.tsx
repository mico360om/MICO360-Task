import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, within, fireEvent, act } from '@testing-library/react';
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
  columnCategory: 'TODO',
  position: 0,
  priority: 'HIGH',
  startDate: null,
  dueDate: null,
  progress: 40,
  completedAt: null,
  createdAt: '',
  updatedAt: '',
};

/** A promise the test settles by hand, to see the in-between (saving / uploading) states. */
function deferred<T = void>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('TaskDrawer header', () => {
  it('shows the reference, status, priority and due date up top', () => {
    render(<TaskDrawer task={{ ...task, dueDate: '2099-01-15T00:00:00.000Z' }} checklist={[]} comments={[]} onClose={vi.fn()} />);
    const header = screen.getByTestId('task-header');
    expect(within(header).getByText('MICO-1')).toBeInTheDocument();
    expect(within(header).getByText('To Do')).toBeInTheDocument();
    expect(within(header).getByText('High')).toBeInTheDocument();
    expect(within(header).getByText('Jan 15, 2099')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Prepare monthly report' })).toBeInTheDocument();
  });

  it('keeps watching and exporting in a “More actions” menu too (the one shown on small screens)', async () => {
    const onExport = vi.fn(async () => {});
    const onToggleWatch = vi.fn();
    render(<TaskDrawer task={task} checklist={[]} comments={[]} onExport={onExport} onToggleWatch={onToggleWatch} watching={false} onClose={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'More actions' }));
    const menu = screen.getByRole('menu', { name: 'More actions' });
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Export as Excel' }));
    expect(onExport).toHaveBeenCalledWith('xlsx');
    await userEvent.click(screen.getByRole('button', { name: 'More actions' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Watch this task' }));
    expect(onToggleWatch).toHaveBeenCalledTimes(1);
  });
});

describe('TaskDrawer: its project, and moving it to another one', () => {
  it('names its project in the header, and the keys it had before it moved', () => {
    render(<TaskDrawer task={{ ...task, key: 'OPS-17', formerKeys: ['RIG-4'] }} project={{ id: 'p1', name: 'Operations', color: '#123456' }} checklist={[]} comments={[]} onClose={vi.fn()} />);
    const header = screen.getByTestId('task-header');
    expect(within(header).getByText('Operations')).toBeInTheDocument();
    expect(within(header).getByText('OPS-17')).toBeInTheDocument();
    expect(within(header).getByText('Formerly RIG-4')).toBeInTheDocument();
  });

  it('offers “Move to another project…” in More actions, on every screen size, and gives focus back to the menu button', async () => {
    const onMoveToProject = vi.fn();
    render(<TaskDrawer task={task} checklist={[]} comments={[]} onMoveToProject={onMoveToProject} onClose={vi.fn()} />);
    const more = screen.getByRole('button', { name: 'More actions' });
    // Not the phone-only menu any more: it holds an action the header has no button for.
    expect(more.closest('.sm\\:hidden')).toBeNull();
    await userEvent.click(more);
    await userEvent.click(within(screen.getByRole('menu', { name: 'More actions' })).getByRole('menuitem', { name: 'Move to another project…' }));
    expect(onMoveToProject).toHaveBeenCalledTimes(1);
    expect(more).toHaveFocus();
  });

  it('when it can’t be moved, the item says why, in words, and does nothing', async () => {
    const onMoveToProject = vi.fn();
    const why = 'To move it, you need to manage both Rig Inspection and the project it goes to.';
    render(<TaskDrawer task={task} checklist={[]} comments={[]} onMoveToProject={onMoveToProject} moveUnavailable={why} onClose={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'More actions' }));
    const item = screen.getByRole('menuitem', { name: /Move to another project…/ });
    expect(item).toHaveAttribute('aria-disabled', 'true');
    expect(item).toHaveTextContent(why);
    await userEvent.click(item);
    expect(onMoveToProject).not.toHaveBeenCalled();
  });
});

describe('TaskDrawer inline editing', () => {
  it('renames the task in place: Enter saves and says so', async () => {
    const onSaveEdit = vi.fn(async () => {});
    render(<TaskDrawer task={task} checklist={[]} comments={[]} onSaveEdit={onSaveEdit} onClose={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Edit title' }));
    const input = screen.getByRole('textbox', { name: 'Title' });
    expect(input).toHaveValue('Prepare monthly report');
    expect(input).toHaveAttribute('maxLength', '191');
    await userEvent.clear(input);
    await userEvent.type(input, 'Reworked report{Enter}');
    expect(onSaveEdit).toHaveBeenCalledWith({ title: 'Reworked report' }, undefined);
    expect(await screen.findByText('Saved')).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Title' })).not.toBeInTheDocument();
  });

  it('Escape drops a title edit; an empty title is never saved', async () => {
    const onSaveEdit = vi.fn(async () => {});
    render(<TaskDrawer task={task} checklist={[]} comments={[]} onSaveEdit={onSaveEdit} onClose={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Edit title' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Title' }), ' draft{Escape}');
    expect(onSaveEdit).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { level: 2, name: 'Prepare monthly report' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Edit title' }));
    await userEvent.clear(screen.getByRole('textbox', { name: 'Title' }));
    await userEvent.keyboard('{Enter}');
    expect(onSaveEdit).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('A title is required.');
  });

  it('shows “Saving…”, then keeps your text and the reason when the save fails', async () => {
    const first = deferred();
    const onSaveEdit = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValueOnce(undefined);
    render(<TaskDrawer task={task} checklist={[]} comments={[]} onSaveEdit={onSaveEdit} onClose={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Edit title' }));
    const input = screen.getByRole('textbox', { name: 'Title' });
    await userEvent.clear(input);
    await userEvent.type(input, 'My edited title{Enter}');
    expect(screen.getByText('Saving…')).toBeInTheDocument();
    await act(async () => first.reject(new Error('Title is too long.')));
    expect(await screen.findByRole('alert')).toHaveTextContent('Title is too long.');
    expect(screen.getByRole('textbox', { name: 'Title' })).toHaveValue('My edited title');
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(screen.queryByRole('textbox', { name: 'Title' })).not.toBeInTheDocument());
  });

  it('edits the description in place (Save, or Escape to cancel), and offers to add one when empty', async () => {
    const onSaveEdit = vi.fn(async () => {});
    const { unmount } = render(<TaskDrawer task={task} checklist={[]} comments={[]} onSaveEdit={onSaveEdit} onClose={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Edit description' }));
    const box = screen.getByRole('textbox', { name: 'Description' });
    await userEvent.type(box, ' Due Friday.');
    await userEvent.click(screen.getByRole('button', { name: 'Save description' }));
    expect(onSaveEdit).toHaveBeenCalledWith({ description: 'Gather figures and write it up. Due Friday.' }, undefined);
    await waitFor(() => expect(screen.queryByRole('textbox', { name: 'Description' })).not.toBeInTheDocument());
    unmount();

    render(<TaskDrawer task={{ ...task, description: null }} checklist={[]} comments={[]} onSaveEdit={onSaveEdit} onClose={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Add a description' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Description' }), 'Draft{Escape}');
    expect(screen.queryByRole('textbox', { name: 'Description' })).not.toBeInTheDocument();
    expect(onSaveEdit).toHaveBeenCalledTimes(1);
  });

  it('changes priority straight away and shows it saved', async () => {
    const onSaveEdit = vi.fn(async () => {});
    render(<TaskDrawer task={task} checklist={[]} comments={[]} onSaveEdit={onSaveEdit} onClose={vi.fn()} />);
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Priority' }), 'URGENT');
    expect(onSaveEdit).toHaveBeenCalledWith({ priority: 'URGENT' }, undefined);
    expect(await screen.findByText('Saved')).toBeInTheDocument();
  });

  it('sets and clears the due date, and flags an overdue one', async () => {
    const onSaveEdit = vi.fn(async () => {});
    const { unmount } = render(<TaskDrawer task={{ ...task, dueDate: '2099-01-15T00:00:00.000Z' }} checklist={[]} comments={[]} onSaveEdit={onSaveEdit} onClose={vi.fn()} />);
    const input = screen.getByLabelText('Due date');
    expect(input).toHaveValue('2099-01-15');
    fireEvent.change(input, { target: { value: '2099-02-01' } });
    expect(onSaveEdit).toHaveBeenCalledWith({ dueDate: '2099-02-01' }, undefined);
    await userEvent.click(screen.getByRole('button', { name: 'Clear due date' }));
    expect(onSaveEdit).toHaveBeenLastCalledWith({ dueDate: null }, undefined);
    expect(screen.queryByText('Overdue')).not.toBeInTheDocument();
    unmount();

    render(<TaskDrawer task={{ ...task, dueDate: '2020-01-15T00:00:00.000Z' }} checklist={[]} comments={[]} onSaveEdit={onSaveEdit} onClose={vi.fn()} />);
    expect(screen.getAllByText('Overdue').length).toBeGreaterThan(0);
    expect(screen.getByLabelText('Due date')).toHaveAttribute('aria-invalid', 'true');
  });

  it('changes status through the project’s columns and reports a failure', async () => {
    const onChangeStatus = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('You don’t have permission to do that.'));
    render(
      <TaskDrawer
        task={task}
        checklist={[]}
        comments={[]}
        statusColumns={[
          { id: 'c1', name: 'To Do', category: 'TODO' },
          { id: 'c2', name: 'In Progress', category: 'IN_PROGRESS' },
          { id: 'c3', name: 'Done', category: 'DONE' },
        ]}
        onChangeStatus={onChangeStatus}
        onClose={vi.fn()}
      />,
    );
    const status = screen.getByRole('combobox', { name: 'Status' });
    await userEvent.selectOptions(status, 'c2');
    expect(onChangeStatus).toHaveBeenCalledWith('c2');
    expect(await screen.findByText('Saved')).toBeInTheDocument();
    await userEvent.selectOptions(status, 'c3');
    expect(await screen.findByRole('alert')).toHaveTextContent('You don’t have permission to do that.');
  });

  it('applies edits to the whole series when you choose so', async () => {
    const onSaveEdit = vi.fn(async () => {});
    render(<TaskDrawer task={{ ...task, recurrenceRule: { freq: 'MONTHLY', interval: 1 } }} checklist={[]} comments={[]} onSaveEdit={onSaveEdit} onClose={vi.fn()} />);
    await userEvent.click(screen.getByRole('radio', { name: 'Entire series' }));
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Priority' }), 'LOW');
    expect(onSaveEdit).toHaveBeenCalledWith({ priority: 'LOW' }, 'series');
  });

  it('suggests a priority for you to review before it is applied', async () => {
    const onSaveEdit = vi.fn(async () => {});
    const onSuggestPriority = vi.fn().mockResolvedValue({ priority: 'URGENT', reason: 'Due tomorrow and blocks two tasks.' });
    render(<TaskDrawer task={task} checklist={[]} comments={[]} onSaveEdit={onSaveEdit} onSuggestPriority={onSuggestPriority} onClose={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: /suggest priority/i }));
    expect(await screen.findByText(/Due tomorrow and blocks two tasks/)).toBeInTheDocument();
    expect(onSaveEdit).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Apply Urgent' }));
    expect(onSaveEdit).toHaveBeenCalledWith({ priority: 'URGENT' }, undefined);
  });

  it('says so when the AI agrees with the current priority, with nothing to apply', async () => {
    const onSaveEdit = vi.fn(async () => {});
    const onSuggestPriority = vi.fn().mockResolvedValue({ priority: 'HIGH', reason: 'Important but not urgent.' });
    render(<TaskDrawer task={task} checklist={[]} comments={[]} onSaveEdit={onSaveEdit} onSuggestPriority={onSuggestPriority} onClose={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: /suggest priority/i }));
    expect(await screen.findByText(/AI agrees/i)).toBeInTheDocument();
    expect(screen.getByText(/Important but not urgent/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Apply/ })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(screen.queryByText(/AI agrees/i)).not.toBeInTheDocument();
    expect(onSaveEdit).not.toHaveBeenCalled();
  });

  it('assigns from a searchable list (only people not yet on it) and unassigns', async () => {
    const onAssignUser = vi.fn(async () => {});
    const onUnassignUser = vi.fn(async () => {});
    render(
      <TaskDrawer
        task={task}
        checklist={[]}
        comments={[]}
        assignees={[{ id: 'u1', name: 'Ada Lovelace' }]}
        assignableUsers={[
          { id: 'u1', name: 'Ada Lovelace' },
          { id: 'u2', name: 'Omar Ahmed' },
          { id: 'u3', name: 'Bilal Khan' },
        ]}
        onAssignUser={onAssignUser}
        onUnassignUser={onUnassignUser}
        onClose={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Add assignee' }));
    const search = screen.getByRole('combobox', { name: 'Find a teammate' });
    expect(within(screen.getByRole('listbox')).queryByRole('option', { name: /Ada/ })).not.toBeInTheDocument();
    await userEvent.type(search, 'om');
    expect(screen.getAllByRole('option')).toHaveLength(1);
    await userEvent.keyboard('{Enter}');
    expect(onAssignUser).toHaveBeenCalledWith('u2');
    await userEvent.click(screen.getByRole('button', { name: 'Remove Ada Lovelace' }));
    expect(onUnassignUser).toHaveBeenCalledWith('u1');
  });
});

describe('TaskDrawer checklist', () => {
  const items = [
    { id: 'i1', text: 'Verify quotation', done: true },
    { id: 'i2', text: 'Send it', done: false },
  ];

  it('shows progress as a count and a bar', () => {
    render(<TaskDrawer task={task} checklist={items} comments={[]} onClose={vi.fn()} />);
    expect(screen.getByText('1 of 2 done')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Checklist progress' })).toHaveAttribute('aria-valuenow', '50');
  });

  it('ticks an item at once, before the server answers (and the count follows)', async () => {
    const onToggleChecklistItem = vi.fn();
    render(<TaskDrawer task={task} checklist={items} comments={[]} onToggleChecklistItem={onToggleChecklistItem} onClose={vi.fn()} />);
    await userEvent.click(screen.getByRole('checkbox', { name: 'Send it' }));
    expect(onToggleChecklistItem).toHaveBeenCalledWith('i2', true);
    expect(screen.getByRole('checkbox', { name: 'Send it' })).toBeChecked();
    expect(screen.getByText('2 of 2 done')).toBeInTheDocument();
  });

  it('puts the tick back and says why when it could not be saved', async () => {
    const onToggleChecklistItem = vi.fn().mockRejectedValue(new Error('You don’t have permission to do that.'));
    render(<TaskDrawer task={task} checklist={items} comments={[]} onToggleChecklistItem={onToggleChecklistItem} onClose={vi.fn()} />);
    await userEvent.click(screen.getByRole('checkbox', { name: 'Send it' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('You don’t have permission to do that.');
    expect(screen.getByRole('checkbox', { name: 'Send it' })).not.toBeChecked();
    expect(screen.getByText('1 of 2 done')).toBeInTheDocument();
  });

  it('adds with Enter and keeps the box ready for the next one; pasting lines adds each', async () => {
    const onAddChecklistItem = vi.fn(async (_text: string) => {});
    render(<TaskDrawer task={task} checklist={[]} comments={[]} onAddChecklistItem={onAddChecklistItem} onClose={vi.fn()} />);
    const input = screen.getByRole('textbox', { name: 'Add a checklist item' });
    await userEvent.type(input, 'New step{Enter}');
    expect(onAddChecklistItem).toHaveBeenCalledWith('New step');
    await waitFor(() => expect(input).toHaveValue(''));
    expect(input).toHaveFocus();
    await userEvent.paste('Collect figures\nDraft report\n\n');
    await waitFor(() => expect(onAddChecklistItem).toHaveBeenCalledTimes(3));
    expect(onAddChecklistItem.mock.calls.map((c) => c[0])).toEqual(['New step', 'Collect figures', 'Draft report']);
  });

  it('renames an item in place', async () => {
    const onRenameChecklistItem = vi.fn(async () => {});
    render(<TaskDrawer task={task} checklist={items} comments={[]} onToggleChecklistItem={vi.fn()} onRenameChecklistItem={onRenameChecklistItem} onClose={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Edit “Send it”' }));
    const input = screen.getByRole('textbox', { name: 'Checklist item' });
    await userEvent.clear(input);
    await userEvent.type(input, 'Send it today{Enter}');
    expect(onRenameChecklistItem).toHaveBeenCalledWith('i2', 'Send it today');
  });

  it('reorders with the keyboard on an item’s handle and says where it went', async () => {
    const onReorderChecklist = vi.fn(async () => {});
    render(<TaskDrawer task={task} checklist={items} comments={[]} onToggleChecklistItem={vi.fn()} onReorderChecklist={onReorderChecklist} onClose={vi.fn()} />);
    screen.getByRole('button', { name: 'Reorder “Verify quotation”' }).focus();
    await userEvent.keyboard('{ArrowDown}');
    expect(onReorderChecklist).toHaveBeenCalledWith(['i2', 'i1']);
    expect(screen.getByText('“Verify quotation” moved to position 2 of 2.')).toBeInTheDocument();
  });

  it('reorders by dragging an item onto another', () => {
    const onReorderChecklist = vi.fn(async () => {});
    render(<TaskDrawer task={task} checklist={items} comments={[]} onToggleChecklistItem={vi.fn()} onReorderChecklist={onReorderChecklist} onClose={vi.fn()} />);
    const rows = screen.getAllByTestId('checklist-item');
    fireEvent.dragStart(rows[1]!, { dataTransfer: { setData: () => {}, effectAllowed: 'move' } });
    fireEvent.dragOver(rows[0]!, { dataTransfer: { dropEffect: 'move' } });
    fireEvent.drop(rows[0]!, { dataTransfer: {} });
    expect(onReorderChecklist).toHaveBeenCalledWith(['i2', 'i1']);
  });

  it('suggests steps with AI for review: you pick which to add', async () => {
    const onAddChecklistItem = vi.fn(async (_text: string) => {});
    const onSuggestChecklist = vi.fn().mockResolvedValue(['Collect figures', 'Draft report', 'Send for review']);
    render(<TaskDrawer task={task} checklist={[]} comments={[]} onAddChecklistItem={onAddChecklistItem} onSuggestChecklist={onSuggestChecklist} onClose={vi.fn()} />);
    const button = screen.getByRole('button', { name: /suggest steps/i });
    expect(button).toHaveTextContent(/AI/);
    await userEvent.click(button);
    const review = await screen.findByRole('group', { name: 'Suggested steps' });
    expect(onAddChecklistItem).not.toHaveBeenCalled();
    await userEvent.click(within(review).getByRole('checkbox', { name: 'Draft report' }));
    await userEvent.click(within(review).getByRole('button', { name: 'Add 2 steps' }));
    await waitFor(() => expect(onAddChecklistItem).toHaveBeenCalledTimes(2));
    expect(onAddChecklistItem.mock.calls.map((c) => c[0])).toEqual(['Collect figures', 'Send for review']);
    await waitFor(() => expect(screen.queryByRole('group', { name: 'Suggested steps' })).not.toBeInTheDocument());
  });

  it('discards suggestions without adding any, and explains a failed suggestion', async () => {
    const onAddChecklistItem = vi.fn();
    const onSuggestChecklist = vi.fn().mockResolvedValueOnce(['One']).mockRejectedValueOnce(new Error('AI is not configured.'));
    render(<TaskDrawer task={task} checklist={[]} comments={[]} onAddChecklistItem={onAddChecklistItem} onSuggestChecklist={onSuggestChecklist} onClose={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: /suggest steps/i }));
    await userEvent.click(await screen.findByRole('button', { name: 'Discard' }));
    expect(screen.queryByRole('group', { name: 'Suggested steps' })).not.toBeInTheDocument();
    expect(onAddChecklistItem).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: /suggest steps/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent('AI is not configured.');
  });
});

describe('TaskDrawer comments', () => {
  it('keeps your draft and says why when a comment could not be posted', async () => {
    const onAddComment = vi.fn().mockRejectedValueOnce(new Error('Couldn’t post the comment.')).mockResolvedValueOnce(undefined);
    render(<TaskDrawer task={task} checklist={[]} comments={[]} onAddComment={onAddComment} onClose={vi.fn()} />);
    const box = screen.getByPlaceholderText(/write a comment/i);
    await userEvent.type(box, 'Looks good');
    await userEvent.click(screen.getByRole('button', { name: /^comment$/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t post the comment.');
    expect(box).toHaveValue('Looks good');
    // Ctrl+Enter posts too
    await userEvent.type(box, '{Control>}{Enter}{/Control}');
    await waitFor(() => expect(box).toHaveValue(''));
    expect(onAddComment).toHaveBeenLastCalledWith('Looks good');
  });

  it('marks an edited comment', () => {
    render(<TaskDrawer task={task} checklist={[]} comments={[{ id: 'c1', body: 'Fixed', authorName: 'Ada', createdAt: new Date().toISOString(), edited: true }]} onClose={vi.fn()} />);
    expect(screen.getByText('(edited)')).toBeInTheDocument();
  });
});

describe('TaskDrawer activity', () => {
  const actors = ['Aisha Khan', 'Omar Ahmed'];
  const activity = Array.from({ length: 8 }, (_, i) => ({
    id: `a${i}`,
    action: 'MOVED',
    actorName: actors[i % 2]!,
    createdAt: new Date(Date.now() - i * 60_000).toISOString(),
    meta: { from: `Stage ${i + 1}`, to: `Stage ${i}` },
  }));

  it('is a compact timeline, newest first, with old and new status, and Load more', async () => {
    render(<TaskDrawer task={task} checklist={[]} comments={[]} activity={activity} onClose={vi.fn()} />);
    const list = screen.getByRole('list', { name: 'Activity' });
    let rows = within(list).getAllByRole('listitem');
    expect(rows).toHaveLength(5);
    expect(rows[0]).toHaveTextContent('Aisha Khan moved this task');
    expect(rows[0]).toHaveTextContent('Stage 1→Stage 0');
    await userEvent.click(screen.getByRole('button', { name: 'Load more' }));
    rows = within(list).getAllByRole('listitem');
    expect(rows).toHaveLength(8);
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
  });

  it('collapses one person’s run of moves into a single line', () => {
    render(
      <TaskDrawer
        task={task}
        checklist={[]}
        comments={[]}
        activity={[
          { id: 'a3', action: 'COMPLETED', actorName: 'Omar Ahmed', createdAt: new Date().toISOString(), meta: { from: 'In Progress', to: 'Done' } },
          { id: 'a2', action: 'MOVED', actorName: 'Omar Ahmed', createdAt: new Date().toISOString(), meta: { from: 'To Do', to: 'In Progress' } },
        ]}
        onClose={vi.fn()}
      />,
    );
    const rows = within(screen.getByRole('list', { name: 'Activity' })).getAllByRole('listitem');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveTextContent('Omar Ahmed completed this task');
    expect(rows[0]).toHaveTextContent('To Do→In Progress→Done');
  });
});

describe('TaskDrawer attachments', () => {
  it('uploads chosen files and shows each one’s progress', async () => {
    const upload = deferred();
    let report: (fraction: number) => void = () => {};
    const onUploadFile = vi.fn((_file: File, onProgress?: (fraction: number) => void) => {
      report = onProgress ?? (() => {});
      return upload.promise;
    });
    render(<TaskDrawer task={task} checklist={[]} comments={[]} attachments={[]} onUploadFile={onUploadFile} onClose={vi.fn()} />);
    const file = new File(['data'], 'note.txt', { type: 'text/plain' });
    await userEvent.upload(screen.getByLabelText('Attach files'), file);
    expect(onUploadFile).toHaveBeenCalledWith(file, expect.any(Function));
    act(() => report(0.4));
    expect(screen.getByRole('progressbar', { name: 'Uploading note.txt' })).toHaveAttribute('aria-valuenow', '40');
    await act(async () => upload.resolve());
    await waitFor(() => expect(screen.queryByRole('progressbar', { name: 'Uploading note.txt' })).not.toBeInTheDocument());
  });

  it('takes files dropped on it, and says why one failed', async () => {
    const onUploadFile = vi.fn().mockRejectedValue(new Error('That file is too large to upload.'));
    render(<TaskDrawer task={task} checklist={[]} comments={[]} attachments={[]} onUploadFile={onUploadFile} onClose={vi.fn()} />);
    const zone = screen.getByTestId('attachment-dropzone');
    const file = new File(['x'], 'big.zip', { type: 'application/zip' });
    fireEvent.dragEnter(zone, { dataTransfer: { types: ['Files'] } });
    expect(zone).toHaveAttribute('data-dragging', 'true');
    fireEvent.drop(zone, { dataTransfer: { files: [file], types: ['Files'] } });
    expect(onUploadFile).toHaveBeenCalledWith(file, expect.any(Function));
    expect(await screen.findByRole('alert')).toHaveTextContent('big.zip: That file is too large to upload.');
  });

  /** What a paste event carries: the files, and the text if any. */
  const clipboard = (files: File[], text = '') => ({
    files,
    items: files.map((f) => ({ kind: 'file', type: f.type, getAsFile: () => f })),
    types: [...(files.length ? ['Files'] : []), ...(text ? ['text/plain'] : [])],
    getData: (type: string) => (type === 'text/plain' ? text : ''),
  });
  const screenshot = () => new File(['png-bytes'], 'image.png', { type: 'image/png' });

  it('a screenshot pasted anywhere in the task (Ctrl+V) is attached, named by when it was pasted', async () => {
    const onUploadFile = vi.fn(() => new Promise<void>(() => {}));
    render(<TaskDrawer task={task} checklist={[]} comments={[]} attachments={[]} onUploadFile={onUploadFile} onClose={vi.fn()} />);
    fireEvent.paste(screen.getByRole('dialog', { name: 'Task MICO-1' }), { clipboardData: clipboard([screenshot()]) });
    expect(onUploadFile).toHaveBeenCalledTimes(1);
    const sent = (onUploadFile.mock.calls[0] as unknown as [File])[0];
    expect(sent.name).toMatch(/^Pasted image \d{4}-\d{2}-\d{2} \d{2}\.\d{2}\.\d{2}\.png$/);
    expect(sent.type).toBe('image/png');
    expect(await screen.findByRole('progressbar', { name: `Uploading ${sent.name}` })).toBeInTheDocument();
  });

  it('a screenshot pasted while writing a comment is attached to the task', async () => {
    const onUploadFile = vi.fn(async () => {});
    render(<TaskDrawer task={task} checklist={[]} comments={[]} attachments={[]} onUploadFile={onUploadFile} onAddComment={vi.fn()} onClose={vi.fn()} />);
    fireEvent.paste(screen.getByRole('textbox', { name: 'Add a comment' }), { clipboardData: clipboard([screenshot()]) });
    expect(onUploadFile).toHaveBeenCalledTimes(1);
  });

  it('text pasted into the comment box stays text, even when the clipboard also holds a picture of it', async () => {
    const onUploadFile = vi.fn(async () => {});
    render(<TaskDrawer task={task} checklist={[]} comments={[]} attachments={[]} onUploadFile={onUploadFile} onAddComment={vi.fn()} onClose={vi.fn()} />);
    fireEvent.paste(screen.getByRole('textbox', { name: 'Add a comment' }), { clipboardData: clipboard([screenshot()], 'Qty\tPrice') });
    expect(onUploadFile).not.toHaveBeenCalled();
  });

  it('a paste outside the task, or of text alone, attaches nothing', async () => {
    const onUploadFile = vi.fn(async () => {});
    render(
      <>
        <input aria-label="Elsewhere" />
        <TaskDrawer task={task} checklist={[]} comments={[]} attachments={[]} onUploadFile={onUploadFile} onClose={vi.fn()} />
      </>,
    );
    fireEvent.paste(screen.getByLabelText('Elsewhere'), { clipboardData: clipboard([screenshot()]) });
    fireEvent.paste(screen.getByRole('dialog', { name: 'Task MICO-1' }), { clipboardData: clipboard([], 'just text') });
    expect(onUploadFile).not.toHaveBeenCalled();
  });

  it('says a picture can be pasted', () => {
    render(<TaskDrawer task={task} checklist={[]} comments={[]} attachments={[]} onUploadFile={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByTestId('attachment-dropzone')).toHaveTextContent(/paste a picture \((Ctrl\+V|⌘V)\)/);
  });

  it('says pictures are made smaller to save space', () => {
    render(<TaskDrawer task={task} checklist={[]} comments={[]} attachments={[]} onUploadFile={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByTestId('attachment-dropzone')).toHaveTextContent('pictures are made smaller to save space');
  });

  it('previews pictures and lets you delete only what you may, after confirming', async () => {
    const onDeleteAttachment = vi.fn(async () => {});
    render(
      <TaskDrawer
        task={task}
        checklist={[]}
        comments={[]}
        attachments={[
          { id: 'a1', filename: 'photo.png', url: '/uploads/a1.png', sizeBytes: 2048, mimeType: 'image/png', canDelete: true },
          { id: 'a2', filename: 'spec.pdf', url: '/uploads/a2.pdf', sizeBytes: 10, mimeType: 'application/pdf', canDelete: false },
        ]}
        onDeleteAttachment={onDeleteAttachment}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByRole('img', { name: 'photo.png' })).toHaveAttribute('src', expect.stringMatching(/\/uploads\/a1\.png$/));
    expect(screen.queryByRole('button', { name: 'Delete spec.pdf' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Delete photo.png' }));
    expect(onDeleteAttachment).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Yes, delete' }));
    expect(onDeleteAttachment).toHaveBeenCalledWith('a1');
  });
});

describe('TaskDrawer dependencies', () => {
  it('shows each blocker’s status and how many are still open', () => {
    render(
      <TaskDrawer
        task={task}
        checklist={[]}
        comments={[]}
        dependencies={{
          blockedBy: [
            { id: 't2', key: 'MICO-2', title: 'Do first', statusName: 'In Progress', statusCategory: 'IN_PROGRESS', done: false },
            { id: 't4', key: 'MICO-4', title: 'Approved', statusName: 'Done', statusCategory: 'DONE', done: true },
          ],
          blocks: [],
        }}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText('In Progress')).toBeInTheDocument();
    expect(screen.getByText('Waiting on 1 open task')).toBeInTheDocument();
  });

  it('adds a blocker from a searchable list that never offers this task or one it blocks', async () => {
    const onAddDependency = vi.fn(async () => {});
    render(
      <TaskDrawer
        task={task}
        checklist={[]}
        comments={[]}
        dependencies={{ blockedBy: [], blocks: [{ id: 't3', key: 'MICO-3', title: 'Waits on us' }] }}
        availableTasks={[
          { id: 't1', key: 'MICO-1', title: 'Prepare monthly report' },
          { id: 't2', key: 'MICO-2', title: 'Do first' },
          { id: 't3', key: 'MICO-3', title: 'Waits on us' },
        ]}
        onAddDependency={onAddDependency}
        onClose={vi.fn()}
      />,
    );
    const search = screen.getByRole('combobox', { name: 'Add a blocking task' });
    await userEvent.type(search, 'mico');
    const options = screen.getAllByRole('option');
    expect(options.map((o) => o.textContent)).toEqual([expect.stringContaining('MICO-2')]);
    await userEvent.click(options[0]!);
    expect(onAddDependency).toHaveBeenCalledWith('t2');
  });

  it('says when no task matches — as a message, never as an empty list', async () => {
    render(
      <TaskDrawer
        task={task}
        checklist={[]}
        comments={[]}
        dependencies={{ blockedBy: [], blocks: [] }}
        availableTasks={[{ id: 't2', key: 'MICO-2', title: 'Do first' }]}
        onAddDependency={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    const search = screen.getByRole('combobox', { name: 'Add a blocking task' });
    await userEvent.type(search, 'zzz');
    expect(screen.getByText(/No task matches/)).toBeInTheDocument();
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(search).not.toHaveAttribute('aria-controls');
  });

  it('says why a blocker could not be added (e.g. it would make a circular chain)', async () => {
    const onAddDependency = vi.fn().mockRejectedValue(new Error('That dependency would create a circular chain.'));
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
    await userEvent.type(screen.getByRole('combobox', { name: 'Add a blocking task' }), 'MICO-2{Enter}');
    expect(await screen.findByRole('alert')).toHaveTextContent('That dependency would create a circular chain.');
  });
});

describe('TaskDrawer reading order', () => {
  it('reads (and tabs) in the order a phone shows it: description, details, checklist, comments, activity', () => {
    render(
      <TaskDrawer
        task={task}
        checklist={[]}
        comments={[]}
        activity={[{ id: 'a1', action: 'CREATED', actorName: 'Ada', createdAt: new Date().toISOString() }]}
        dependencies={{ blockedBy: [], blocks: [] }}
        onClose={vi.fn()}
      />,
    );
    const order = ['Description', 'Details', 'Attachments', 'Dependencies', 'Checklist', 'Comments', 'Activity'].map(
      (name) => screen.getByRole('heading', { level: 3, name: new RegExp(`^${name}`) }),
    );
    for (let i = 1; i < order.length; i++) {
      expect(order[i - 1]!.compareDocumentPosition(order[i]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
  });
});

describe('TaskDrawer empty states', () => {
  it('says what to do when a section is empty', () => {
    render(
      <TaskDrawer
        task={task}
        checklist={[]}
        comments={[]}
        attachments={[]}
        dependencies={{ blockedBy: [], blocks: [] }}
        assignees={[]}
        onAddChecklistItem={vi.fn()}
        onUploadFile={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText('No steps yet — break the work down below.')).toBeInTheDocument();
    expect(screen.getByText('No comments yet. Start the conversation.')).toBeInTheDocument();
    expect(screen.getByText('Nothing is blocking this task.')).toBeInTheDocument();
    expect(screen.getByText('Unassigned')).toBeInTheDocument();
  });
});
