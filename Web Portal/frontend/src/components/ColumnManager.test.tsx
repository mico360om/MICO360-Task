import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ColumnManager } from './ColumnManager';
import type { ApiColumn } from '../api/columns';

const columns: ApiColumn[] = [
  { id: 'c1', projectId: 'p1', name: 'Backlog', category: 'BACKLOG', position: 0, color: '#948985', enabled: true },
  { id: 'c2', projectId: 'p1', name: 'Done', category: 'DONE', position: 1, color: '#2E7D53', enabled: true },
];

function setup(overrides = {}) {
  const handlers = { onAdd: vi.fn(), onRename: vi.fn(), onSetColor: vi.fn(), onToggleEnabled: vi.fn(), onDelete: vi.fn(), onMove: vi.fn(), ...overrides };
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
    expect(h.onAdd).toHaveBeenCalledWith('Review');
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
