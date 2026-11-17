import { describe, it, expect, vi } from 'vitest';
import { cleanup, render, screen, fireEvent, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ColumnManager } from './ColumnManager';
import type { ApiColumn } from '../api/columns';

const columns: ApiColumn[] = [
  { id: 'c1', projectId: 'p1', name: 'Backlog', category: 'BACKLOG', position: 0, color: '#948985', enabled: true },
  { id: 'c2', projectId: 'p1', name: 'Done', category: 'DONE', position: 1, color: '#2E7D53', enabled: true },
];

function setup(overrides = {}) {
  const handlers = { onAdd: vi.fn(), onRename: vi.fn(), onToggleEnabled: vi.fn(), onDelete: vi.fn(), onMove: vi.fn(), ...overrides };
  render(<ColumnManager columns={columns} {...handlers} />);
  return handlers;
}

describe('ColumnManager', () => {
  it('lists the columns', () => {
    setup();
    expect(screen.getByDisplayValue('Backlog')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Done')).toBeInTheDocument();
  });

  it('renames a column on change/blur', () => {
    const h = setup();
    const input = screen.getByDisplayValue('Backlog');
    fireEvent.change(input, { target: { value: 'To do' } });
    fireEvent.blur(input);
    expect(h.onRename).toHaveBeenCalledWith('c1', 'To do');
  });

  it('adds a new column', async () => {
    const h = setup();
    await userEvent.type(screen.getByLabelText(/add a column/i), 'Review');
    await userEvent.click(screen.getByRole('button', { name: /add column/i }));
    expect(h.onAdd).toHaveBeenCalledWith('Review', 'TODO'); // s137: a new column's status starts as To Do
  });

  it('toggles a column enabled', async () => {
    const h = setup();
    await userEvent.click(screen.getByRole('checkbox', { name: /enable Backlog/i }));
    expect(h.onToggleEnabled).toHaveBeenCalledWith('c1', false);
  });

  it('deletes a column only after confirmation', async () => {
    const h = setup();
    await userEvent.click(screen.getByRole('button', { name: /delete Done/i }));
    expect(h.onDelete).not.toHaveBeenCalled(); // a confirm step appears first
    await userEvent.click(screen.getByRole('button', { name: /^delete$/i }));
    expect(h.onDelete).toHaveBeenCalledWith('c2');
  });

  it('cancels a deletion without removing the column', async () => {
    const h = setup();
    await userEvent.click(screen.getByRole('button', { name: /delete Backlog/i }));
    await userEvent.click(screen.getByRole('button', { name: /cancel deleting Backlog/i }));
    expect(h.onDelete).not.toHaveBeenCalled();
  });

  it('reorders a column', async () => {
    const h = setup();
    await userEvent.click(screen.getByRole('button', { name: /move Done up/i }));
    expect(h.onMove).toHaveBeenCalledWith('c2', 'up');
  });

  it('changes a column’s mapped status', async () => {
    const onSetCategory = vi.fn();
    setup({ onSetCategory });
    await userEvent.selectOptions(screen.getByLabelText(/status of Backlog/i), 'TODO');
    expect(onSetCategory).toHaveBeenCalledWith('c1', 'TODO');
  });
});

describe('one colour scheme (1.23.8): a column wears its status kind’s colour', () => {
  it('has no colour picker; its mark is the kind’s colour (whatever it was once given), named', () => {
    setup();
    expect(screen.queryByLabelText(/^Colour /)).toBeNull();
    expect(document.querySelector('input[type="color"]')).toBeNull();
    const backlog = screen.getByRole('img', { name: 'Backlog: Backlog colour' });
    expect(backlog).toHaveClass('bg-status-backlog');
    expect(screen.getByRole('img', { name: 'Done: Done colour' })).toHaveClass('bg-status-done');
  });

  it('says the colour follows the status', () => {
    setup();
    expect(screen.getByText('Colours follow the status')).toBeInTheDocument(); // s137: the header's hint
  });
});

// s137: a compact Columns table — Name · Status · Tasks · Visible · ↑↓ · Delete, task counts, a guarded Delete, add with a status.
describe('Columns table (1.23.37)', () => {
  const counted = [
    { ...columns[0]!, taskCount: 3 },
    { ...columns[1]!, taskCount: 0 },
  ];
  const show = (cols = counted, extra = {}) => {
    const h = { onAdd: vi.fn(), onRename: vi.fn(), onToggleEnabled: vi.fn(), onDelete: vi.fn(), onMove: vi.fn(), onSetCategory: vi.fn(), ...extra };
    render(<ColumnManager columns={cols} {...h} />);
    return h;
  };

  it('has a header row with the labels and two hints', () => {
    show();
    const head = screen.getByTestId('columns-head');
    expect(head).toHaveTextContent(/Name.*Status.*Tasks.*Visible/);
    expect(screen.getByText('Colours follow the status')).toBeInTheDocument();
    expect(screen.getByText('Hidden columns keep their tasks')).toBeInTheDocument();
  });

  it('shows each column’s task count', () => {
    show();
    expect(within(screen.getByRole('listitem', { name: 'Backlog' })).getByText('3 tasks', { selector: '.sr-only' })).toBeInTheDocument();
    expect(within(screen.getByRole('listitem', { name: 'Done' })).getByText('0 tasks', { selector: '.sr-only' })).toBeInTheDocument();
  });

  it('a column with tasks can’t be deleted, and says why ("Move its 3 tasks first")', async () => {
    const h = show();
    const del = screen.getByRole('button', { name: 'Delete Backlog' });
    expect(del).toHaveAttribute('aria-disabled', 'true');
    expect(del).toHaveAccessibleDescription('Move its 3 tasks first');
    await userEvent.click(del);
    expect(screen.queryByRole('button', { name: /^delete$/i })).toBeNull();
    expect(h.onDelete).not.toHaveBeenCalled();
    expect(within(screen.getByRole('listitem', { name: 'Backlog' })).getByText('Move its 3 tasks first', { selector: '[role="status"] *, [role="status"]' })).toBeInTheDocument();
    // An empty column still deletes after its confirmation.
    expect(screen.getByRole('button', { name: 'Delete Done' })).not.toHaveAttribute('aria-disabled');
  });

  it('one task reads in the singular; a project’s only column can’t go', () => {
    show([{ ...columns[0]!, taskCount: 1 }, { ...columns[1]!, taskCount: 0 }]);
    expect(screen.getByRole('button', { name: 'Delete Backlog' })).toHaveAccessibleDescription('Move its 1 task first');
    cleanup();
    show([{ ...columns[0]!, taskCount: 0 }]);
    expect(screen.getByRole('button', { name: 'Delete Backlog' })).toHaveAccessibleDescription('A project needs at least one column');
  });

  it('adds a column with its status chosen at once', async () => {
    const h = show();
    await userEvent.type(screen.getByLabelText(/add a column/i), 'In Review');
    await userEvent.selectOptions(screen.getByLabelText('Status of the new column'), 'REVIEW');
    await userEvent.click(screen.getByRole('button', { name: 'Add column' }));
    expect(h.onAdd).toHaveBeenCalledWith('In Review', 'REVIEW');
    expect(screen.getByLabelText(/add a column/i)).toHaveValue('');
  });

  it('keeps the table to about 960 px', () => {
    show();
    expect(screen.getByTestId('columns-table').className).toMatch(/max-w-\[960px\]/);
  });
});
