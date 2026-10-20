import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
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
  it('tints the header’s status with the status colour', () => {
    const { rerender } = render(<TaskDrawer task={{ ...task, columnCategory: 'DONE' }} checklist={[]} comments={[]} onClose={vi.fn()} />);
    const pill = () => within(screen.getByTestId('task-header')).getByTestId('status-pill');
    expect(pill()).toHaveTextContent('Done');
    expect(pill().getAttribute('style')).toContain('--c-cat-done');
    rerender(<TaskDrawer task={{ ...task, columnCategory: 'BLOCKED' }} checklist={[]} comments={[]} onClose={vi.fn()} />);
    expect(pill()).toHaveTextContent('Blocked');
    expect(pill().getAttribute('style')).toContain('--c-cat-blocked');
  });

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

  it('offers the series choices on an earlier copy too (the rule lives on the newest copy)', async () => {
    const onDelete = vi.fn();
    const onSaveEdit = vi.fn();
    const copy = { ...task, recurrenceRule: null, recurrenceParentId: 'origin', recurrenceNextId: 'later' };
    render(<TaskDrawer task={copy} checklist={[]} comments={[]} onDelete={onDelete} onSaveEdit={onSaveEdit} onSetRecurrence={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText(/part of a repeating series/i)).toBeInTheDocument();
    // An earlier copy can't start a second series: no repeat editor, a pointer to the newest copy.
    expect(screen.queryByLabelText(/^repeat$/i)).not.toBeInTheDocument();
    expect(screen.getByText(/change the repeat on its newest copy/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /delete task/i }));
    await userEvent.click(screen.getByRole('button', { name: /entire series/i }));
    expect(onDelete).toHaveBeenCalledWith('series');
  });

  it('the newest copy can turn its repeat back on after it was switched off', async () => {
    const onSetRecurrence = vi.fn();
    const newest = { ...task, recurrenceRule: null, recurrenceParentId: 'origin', recurrenceNextId: null };
    render(<TaskDrawer task={newest} checklist={[]} comments={[]} onSetRecurrence={onSetRecurrence} onClose={vi.fn()} />);
    await userEvent.selectOptions(screen.getByLabelText(/^repeat$/i), 'WEEKLY');
    expect(onSetRecurrence).toHaveBeenCalledWith({ freq: 'WEEKLY', interval: 1 });
  });

  it('previews the next dates of the repeat from the task’s due date', () => {
    render(
      <TaskDrawer
        task={{ ...task, dueDate: '2026-10-01T00:00:00.000Z', recurrenceRule: { freq: 'WEEKLY', interval: 1 } }}
        checklist={[]}
        comments={[]}
        onSetRecurrence={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText(/^Next:/)).toHaveTextContent('Next: Thu, Oct 8 · Thu, Oct 15 · Thu, Oct 22');
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

  it('does not offer AI suggestions when onSuggestChecklist is absent', () => {
    render(<TaskDrawer task={task} checklist={[]} comments={[]} onAddChecklistItem={vi.fn()} onClose={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /suggest steps/i })).not.toBeInTheDocument();
  });

  it('posts a comment', async () => {
    const onAddComment = vi.fn();
    render(<TaskDrawer task={task} checklist={[]} comments={[]} onAddComment={onAddComment} onClose={vi.fn()} />);
    await userEvent.type(screen.getByPlaceholderText(/write a comment/i), 'Looks good');
    await userEvent.click(screen.getByRole('button', { name: /^comment$/i }));
    expect(onAddComment).toHaveBeenCalledWith('Looks good');
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

  it('saves a document under its own name; a picture opens for viewing', () => {
    render(
      <TaskDrawer
        task={task}
        checklist={[]}
        comments={[]}
        attachments={[
          { id: 'a1', filename: 'notes.txt', url: '/uploads/46304f6b.txt', sizeBytes: 20 },
          { id: 'a2', filename: 'photo.png', url: '/uploads/9c1d.png', sizeBytes: 2048 },
        ]}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByRole('link', { name: /notes\.txt/ })).toHaveAttribute('download', 'notes.txt');
    expect(screen.getByRole('link', { name: /photo\.png/ })).not.toHaveAttribute('download');
  });

  it('previews a text file in the panel, as plain text', async () => {
    const fetchMock = vi.fn(async () => new Response('a,b\n<b>1</b>,2', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    render(
      <TaskDrawer
        task={task}
        checklist={[]}
        comments={[]}
        attachments={[{ id: 'a1', filename: 'figures.csv', url: '/uploads/a1.csv', sizeBytes: 14, mimeType: 'text/csv' }]}
        onClose={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Preview figures.csv' }));
    const preview = await screen.findByRole('dialog', { name: 'Preview of figures.csv' });
    // Shown as text, never as markup.
    expect(await within(preview).findByText(/<b>1<\/b>,2/)).toBeInTheDocument();
    expect(within(preview).getByRole('link', { name: /download/i })).toHaveAttribute('download', 'figures.csv');
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Preview of figures.csv' })).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: /MICO-1/ })).toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it('previews a PDF in an embedded viewer', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Blob(['%PDF-1.4']), { status: 200 })));
    const created = vi.fn(() => 'blob:preview');
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: created, revokeObjectURL: vi.fn() }));
    render(
      <TaskDrawer
        task={task}
        checklist={[]}
        comments={[]}
        attachments={[{ id: 'a1', filename: 'quote.pdf', url: '/uploads/a1.pdf', sizeBytes: 9, mimeType: 'application/pdf' }]}
        onClose={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Preview quote.pdf' }));
    const preview = await screen.findByRole('dialog', { name: 'Preview of quote.pdf' });
    await waitFor(() => expect(within(preview).getByTitle('PDF: quote.pdf')).toHaveAttribute('src', 'blob:preview'));
    vi.unstubAllGlobals();
  });

  it('offers no preview for a file it can’t show (an old .doc, or Office files when previews aren’t wired)', () => {
    render(
      <TaskDrawer
        task={task}
        checklist={[]}
        comments={[]}
        attachments={[{ id: 'a1', filename: 'old.doc', url: '/uploads/a1.doc', sizeBytes: 9 }, { id: 'a2', filename: 'brief.docx', url: '/uploads/a2.docx', sizeBytes: 9 }]}
        onClose={vi.fn()}
      />,
    );
    expect(screen.queryByRole('button', { name: /preview old\.doc/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /preview brief\.docx/i })).not.toBeInTheDocument();
  });

  it('previews Word, Excel and PowerPoint files as text', async () => {
    const previews: Record<string, unknown> = {
      d: { kind: 'document', paragraphs: ['Quarterly report', 'مراجعة الميزانية'], truncated: false },
      x: { kind: 'sheet', sheets: [{ name: 'Budget', rows: [['Item', 'Cost'], ['Venue', '1200']], truncated: false }, { name: 'Notes', rows: [['Approved']], truncated: true }] },
      p: { kind: 'slides', slides: [{ number: 1, lines: ['Launch plan'] }, { number: 2, lines: ['Budget'] }], truncated: false },
    };
    const onPreview = vi.fn(async (id: string) => previews[id] as never);
    render(
      <TaskDrawer
        task={task}
        checklist={[]}
        comments={[]}
        attachments={[
          { id: 'd', filename: 'brief.docx', url: '/uploads/d.docx', sizeBytes: 9 },
          { id: 'x', filename: 'budget.xlsx', url: '/uploads/x.xlsx', sizeBytes: 9 },
          { id: 'p', filename: 'deck.pptx', url: '/uploads/p.pptx', sizeBytes: 9 },
        ]}
        onPreviewAttachment={onPreview}
        onClose={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Preview brief.docx' }));
    let dlg = await screen.findByRole('dialog', { name: 'Preview of brief.docx' });
    expect(await within(dlg).findByText('Quarterly report')).toBeInTheDocument();
    expect(within(dlg).getByText('مراجعة الميزانية')).toHaveAttribute('dir', 'auto');
    await userEvent.click(within(dlg).getByRole('button', { name: 'Close preview' }));

    await userEvent.click(screen.getByRole('button', { name: 'Preview budget.xlsx' }));
    dlg = await screen.findByRole('dialog', { name: 'Preview of budget.xlsx' });
    const table = await within(dlg).findByRole('table', { name: 'Budget' });
    expect(within(table).getByRole('cell', { name: 'Venue' })).toBeInTheDocument();
    await userEvent.click(within(dlg).getByRole('tab', { name: 'Notes' }));
    expect(within(dlg).getByRole('table', { name: 'Notes' })).toBeInTheDocument();
    expect(within(dlg).getByText(/only the first rows/i)).toBeInTheDocument();
    await userEvent.click(within(dlg).getByRole('button', { name: 'Close preview' }));

    await userEvent.click(screen.getByRole('button', { name: 'Preview deck.pptx' }));
    dlg = await screen.findByRole('dialog', { name: 'Preview of deck.pptx' });
    expect(await within(dlg).findByRole('heading', { name: 'Slide 2' })).toBeInTheDocument();
    expect(within(dlg).getByText('Launch plan')).toBeInTheDocument();
    expect(onPreview.mock.calls.map((c) => c[0])).toEqual(['d', 'x', 'p']);
  });

  it('says why an Office preview failed and still offers the download', async () => {
    render(
      <TaskDrawer
        task={task}
        checklist={[]}
        comments={[]}
        attachments={[{ id: 'd', filename: 'broken.docx', url: '/uploads/d.docx', sizeBytes: 9 }]}
        onPreviewAttachment={async () => { throw new Error('The file looks damaged and can’t be previewed.'); }}
        onClose={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Preview broken.docx' }));
    const dlg = await screen.findByRole('dialog', { name: 'Preview of broken.docx' });
    expect(await within(dlg).findByText(/looks damaged/i)).toBeInTheDocument();
    expect(within(dlg).getByRole('link', { name: /download/i })).toBeInTheDocument();
  });

  it('Escape closes the open Export menu only — not the whole drawer', async () => {
    const drawerEscapes = vi.fn();
    const { container } = render(
      <div>
        <TaskDrawer task={task} checklist={[]} comments={[]} onClose={vi.fn()} onExport={async () => {}} />
      </div>,
    );
    // Stands in for the drawer's own Escape handler, which listens on an element around it.
    container.firstElementChild!.addEventListener('keydown', (e) => { if ((e as KeyboardEvent).key === 'Escape') drawerEscapes(); });

    const button = screen.getByRole('button', { name: 'Export' });
    await userEvent.click(button);
    const item = screen.getByRole('menuitem', { name: 'PDF' });
    item.focus();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(drawerEscapes).not.toHaveBeenCalled();
    expect(button).toHaveFocus();

    // With the menu closed, Escape belongs to the drawer again.
    await userEvent.keyboard('{Escape}');
    expect(drawerEscapes).toHaveBeenCalledTimes(1);
  });

  it('closes the Export menu when something else is clicked', async () => {
    render(<TaskDrawer task={task} checklist={[]} comments={[]} onClose={vi.fn()} onExport={async () => {}} />);
    await userEvent.click(screen.getByRole('button', { name: 'Export' }));
    expect(screen.getByRole('menu')).toBeInTheDocument();
    await userEvent.click(screen.getByText('Prepare monthly report'));
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('removes a checklist item', async () => {
    const onRemove = vi.fn();
    render(
      <TaskDrawer
        task={task}
        checklist={[{ id: 'i1', text: 'Verify quotation', done: true }, { id: 'i2', text: 'Send it', done: false }]}
        comments={[]}
        onToggleChecklistItem={vi.fn()}
        onRemoveChecklistItem={onRemove}
        onClose={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Remove “Send it” from the checklist' }));
    expect(onRemove).toHaveBeenCalledWith('i2');
  });

  describe('comments', () => {
    const comments = [
      { id: 'c1', body: 'Mine, with a typo', authorName: 'Ada Lovelace', createdAt: new Date().toISOString(), canEdit: true, canDelete: true },
      { id: 'c2', body: 'Someone else’s comment', authorName: 'Omar Ahmed', createdAt: new Date().toISOString() },
    ];

    it('lets you edit your own comment', async () => {
      const onEdit = vi.fn(async () => {});
      render(<TaskDrawer task={task} checklist={[]} comments={comments} onEditComment={onEdit} onDeleteComment={vi.fn()} onClose={vi.fn()} />);
      await userEvent.click(screen.getByRole('button', { name: 'Edit your comment' }));
      const box = screen.getByLabelText('Edit comment');
      expect(box).toHaveValue('Mine, with a typo');
      await userEvent.clear(box);
      await userEvent.type(box, 'Mine, corrected');
      await userEvent.click(screen.getByRole('button', { name: 'Save comment' }));
      expect(onEdit).toHaveBeenCalledWith('c1', 'Mine, corrected');
      await waitFor(() => expect(screen.queryByLabelText('Edit comment')).not.toBeInTheDocument());
    });

    it('keeps the editor open with the reason when the save fails, and never saves an empty comment', async () => {
      const onEdit = vi.fn(async () => { throw new Error('Couldn’t save the comment.'); });
      render(<TaskDrawer task={task} checklist={[]} comments={comments} onEditComment={onEdit} onDeleteComment={vi.fn()} onClose={vi.fn()} />);
      await userEvent.click(screen.getByRole('button', { name: 'Edit your comment' }));
      await userEvent.clear(screen.getByLabelText('Edit comment'));
      expect(screen.getByRole('button', { name: 'Save comment' })).toBeDisabled();
      await userEvent.type(screen.getByLabelText('Edit comment'), 'Second try');
      await userEvent.click(screen.getByRole('button', { name: 'Save comment' }));
      expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t save the comment.');
      expect(screen.getByLabelText('Edit comment')).toHaveValue('Second try');
    });

    it('deletes your own comment only after asking', async () => {
      const onDelete = vi.fn();
      render(<TaskDrawer task={task} checklist={[]} comments={comments} onEditComment={vi.fn()} onDeleteComment={onDelete} onClose={vi.fn()} />);
      await userEvent.click(screen.getByRole('button', { name: 'Delete your comment' }));
      expect(onDelete).not.toHaveBeenCalled();
      await userEvent.click(screen.getByRole('button', { name: 'Keep' }));
      await userEvent.click(screen.getByRole('button', { name: 'Delete your comment' }));
      await userEvent.click(screen.getByRole('button', { name: 'Yes, delete' }));
      expect(onDelete).toHaveBeenCalledWith('c1');
    });

    it('offers neither on someone else’s comment', () => {
      render(<TaskDrawer task={task} checklist={[]} comments={[comments[1]!]} onEditComment={vi.fn()} onDeleteComment={vi.fn()} onClose={vi.fn()} />);
      expect(screen.queryByRole('button', { name: /edit your comment|delete your comment|delete comment/i })).not.toBeInTheDocument();
    });
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

  it('shows an action error passed by the container', async () => {
    const onDismissError = vi.fn();
    render(<TaskDrawer task={task} checklist={[]} comments={[]} actionError="That file is too large to upload." onDismissError={onDismissError} onClose={vi.fn()} />);
    expect(screen.getByRole('alert')).toHaveTextContent('That file is too large to upload.');
    await userEvent.click(screen.getByRole('button', { name: /dismiss/i }));
    expect(onDismissError).toHaveBeenCalled();
  });

  it('does not show a completed task as overdue, and uses the company-zone calendar day', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-30T10:00:00Z'));
    try {
      const { unmount } = render(<TaskDrawer task={{ ...task, dueDate: '2026-09-30T00:00:00.000Z', columnCategory: 'TODO', completedAt: null }} timeZone="Asia/Muscat" checklist={[]} comments={[]} onClose={vi.fn()} />);
      expect(screen.queryByText(/overdue/i)).not.toBeInTheDocument(); // due today, not overdue at 14:00 Muscat
      expect(within(screen.getByTestId('task-header')).getByText('Sep 30, 2026')).toBeInTheDocument();
      unmount();
      render(<TaskDrawer task={{ ...task, dueDate: '2026-09-01T00:00:00.000Z', columnCategory: 'DONE', completedAt: '2026-09-02T00:00:00.000Z' }} timeZone="Asia/Muscat" checklist={[]} comments={[]} onClose={vi.fn()} />);
      expect(screen.queryByText(/overdue/i)).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('marks user text (title, description, comments) dir="auto" for Arabic', () => {
    render(
      <TaskDrawer
        task={{ ...task, title: 'مهمة جديدة', description: 'وصف المهمة' }}
        checklist={[]}
        comments={[{ id: 'c1', body: 'تعليق', authorName: 'سارة' }]}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByRole('heading', { name: 'مهمة جديدة' })).toHaveAttribute('dir', 'auto');
    expect(screen.getByText('وصف المهمة')).toHaveAttribute('dir', 'auto');
    expect(screen.getByText('تعليق')).toHaveAttribute('dir', 'auto');
  });

  describe('@mentions in comments', () => {
    const people = [
      { id: 'u2', username: 'flowa.main', name: 'Main FLOW-A' },
      { id: 'u3', username: 'omar', name: 'Omar Ahmed' },
    ];

    it('suggests people as you type an @mention, and Enter puts the name in', async () => {
      const onAddComment = vi.fn();
      render(<TaskDrawer task={task} checklist={[]} comments={[]} mentionable={people} onAddComment={onAddComment} onClose={vi.fn()} />);
      const box = screen.getByPlaceholderText(/write a comment/i);
      await userEvent.type(box, 'Please check @fl');
      const list = screen.getByRole('listbox', { name: /mention someone/i });
      const options = within(list).getAllByRole('option');
      expect(options).toHaveLength(1);
      expect(options[0]).toHaveTextContent('Main FLOW-A');
      expect(options[0]).toHaveTextContent('@flowa.main');
      expect(options[0]).toHaveAttribute('aria-selected', 'true');
      expect(box).toHaveAttribute('aria-activedescendant', options[0]!.id);
      await userEvent.keyboard('{Enter}');
      expect(box).toHaveValue('Please check @flowa.main ');
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
      await userEvent.type(box, 'thanks');
      await userEvent.click(screen.getByRole('button', { name: /^comment$/i }));
      expect(onAddComment).toHaveBeenCalledWith('Please check @flowa.main thanks');
    });

    it('picks a suggestion with the arrow keys or a click', async () => {
      render(<TaskDrawer task={task} checklist={[]} comments={[]} mentionable={people} onAddComment={vi.fn()} onClose={vi.fn()} />);
      const box = screen.getByPlaceholderText(/write a comment/i);
      await userEvent.type(box, '@');
      expect(screen.getAllByRole('option')).toHaveLength(2);
      await userEvent.keyboard('{ArrowDown}');
      expect(screen.getByRole('option', { name: /Omar Ahmed/ })).toHaveAttribute('aria-selected', 'true');
      await userEvent.keyboard('{Enter}');
      expect(box).toHaveValue('@omar ');
      await userEvent.type(box, 'and @ma');
      await userEvent.click(screen.getByRole('option', { name: /Main FLOW-A/ }));
      expect(box).toHaveValue('@omar and @flowa.main ');
      expect(box).toHaveFocus();
    });

    it('keeps the caret after the inserted name, even when typing on straight away', async () => {
      render(<TaskDrawer task={task} checklist={[]} comments={[]} mentionable={people} onAddComment={vi.fn()} onClose={vi.fn()} />);
      const box = screen.getByPlaceholderText(/write a comment/i);
      await userEvent.type(box, 'hi @om');
      await userEvent.keyboard('{Enter}', { delay: null });
      await userEvent.keyboard('ab', { delay: null });
      await new Promise((resolve) => setTimeout(resolve, 50)); // let any pending frame run
      await userEvent.keyboard('c');
      expect(box).toHaveValue('hi @omar abc');
    });

    it('says so when nobody matches, and Enter then just types a new line', async () => {
      render(<TaskDrawer task={task} checklist={[]} comments={[]} mentionable={people} onAddComment={vi.fn()} onClose={vi.fn()} />);
      const box = screen.getByPlaceholderText(/write a comment/i);
      await userEvent.type(box, '@zz');
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
      expect(screen.getByRole('status')).toHaveTextContent('No one on this project matches “@zz”.');
      await userEvent.keyboard('{Enter}');
      expect(box).toHaveValue('@zz\n');
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });

    it('stays quiet while the people to suggest are not there (loading, or the list failed)', async () => {
      render(<TaskDrawer task={task} checklist={[]} comments={[]} mentionable={[]} onAddComment={vi.fn()} onClose={vi.fn()} />);
      await userEvent.type(screen.getByPlaceholderText(/write a comment/i), '@om');
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    });

    it('Escape closes the suggestions, not the drawer', async () => {
      const outerEscape = vi.fn();
      render(
        <div ref={(el) => el?.addEventListener('keydown', (e) => { if (e.key === 'Escape') outerEscape(); })}>
          <TaskDrawer task={task} checklist={[]} comments={[]} mentionable={people} onAddComment={vi.fn()} onClose={vi.fn()} />
        </div>,
      );
      const box = screen.getByPlaceholderText(/write a comment/i);
      await userEvent.type(box, '@fl');
      expect(screen.getByRole('listbox')).toBeInTheDocument();
      await userEvent.keyboard('{Escape}');
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
      expect(outerEscape).not.toHaveBeenCalled();
      expect(box).toHaveValue('@fl');
      // with the list closed, Escape goes on to the drawer as usual
      await userEvent.keyboard('{Escape}');
      expect(outerEscape).toHaveBeenCalledTimes(1);
    });

    it('suggests people while editing a comment too', async () => {
      const onEditComment = vi.fn();
      render(
        <TaskDrawer
          task={task}
          checklist={[]}
          comments={[{ id: 'c1', body: 'Done.', authorName: 'Ada', canEdit: true }]}
          mentionable={people}
          onEditComment={onEditComment}
          onClose={vi.fn()}
        />,
      );
      await userEvent.click(screen.getByRole('button', { name: /edit your comment/i }));
      const box = screen.getByRole('textbox', { name: /edit comment/i });
      await userEvent.type(box, ' cc @om');
      await userEvent.keyboard('{Enter}');
      expect(box).toHaveValue('Done. cc @omar ');
    });

    it('highlights mentions of real people in comments, showing who they are on hover', () => {
      render(
        <TaskDrawer
          task={task}
          checklist={[]}
          comments={[{ id: 'c1', body: 'Over to @flowa.main. Ask @nobody or mail omar@x.com', authorName: 'Ada' }]}
          mentionable={people}
          onClose={vi.fn()}
        />,
      );
      const mention = screen.getByTitle('Main FLOW-A');
      expect(mention).toHaveTextContent(/^@flowa\.main$/);
      // only real people are marked: not an unknown name, not an email address
      expect(screen.queryByTitle(/nobody|omar/i)).not.toBeInTheDocument();
      expect(screen.getByText(/Ask @nobody or mail omar@x\.com/)).toBeInTheDocument();
    });
  });
});

describe('TaskDrawer — the meeting a task was created from', () => {
  const fromMeeting = (meeting: ApiTask['meeting']): ApiTask => ({ ...task, meetingId: 'm1', meeting });
  const show = (t: ApiTask) =>
    render(
      <MemoryRouter>
        <TaskDrawer task={t} timeZone="Asia/Muscat" checklist={[]} comments={[]} onClose={vi.fn()} />
      </MemoryRouter>,
    );

  it('links to the meeting, by its title and day', () => {
    show(fromMeeting({ id: 'm1', title: 'Weekly review', startAt: '2026-10-12T05:00:00.000Z', canView: true }));
    const link = within(screen.getByTestId('task-header')).getByRole('link', { name: /from meeting: weekly review/i });
    expect(link).toHaveAttribute('href', '/meetings/m1');
    expect(link).toHaveTextContent(/Mon/);
    expect(link).toHaveTextContent(/\b12\b.*Oct|Oct.*\b12\b/); // "Mon 12 Oct" or "Mon, Oct 12", by locale
  });

  it('says only that there is a meeting when the viewer may not see it', () => {
    show(fromMeeting({ id: 'm1', title: null, startAt: null, canView: false }));
    const header = within(screen.getByTestId('task-header'));
    expect(header.getByText(/from a meeting you’re not part of/i)).toBeInTheDocument();
    expect(header.queryByRole('link', { name: /meeting/i })).toBeNull();
  });

  it('shows no meeting for a task made anywhere else, or whose meeting is gone', () => {
    const { unmount } = show(task);
    expect(screen.queryByText(/meeting/i)).toBeNull();
    unmount();
    show({ ...task, meetingId: 'm1', meeting: null });
    expect(screen.queryByText(/meeting/i)).toBeNull();
  });
});
