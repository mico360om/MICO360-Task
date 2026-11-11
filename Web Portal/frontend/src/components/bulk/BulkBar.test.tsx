import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BulkBar } from './BulkBar';
import { bulkBarActions, type BarContext } from '../../lib/bulk-words';
import { windowWidth } from '../../test/window-width';

const ctx = (over: Partial<BarContext> = {}): BarContext => ({
  count: 12,
  projectIds: ['p1'],
  unknownProject: false,
  isAdmin: false,
  managedProjectIds: [],
  move: { canMove: true, reason: null },
  merge: null,
  ...over,
});

afterEach(() => vi.unstubAllGlobals());

describe('BulkBar (computer)', () => {
  it('always says how many are selected — and how many the filters hide', () => {
    windowWidth(1440);
    const { rerender } = render(<BulkBar count={12} hidden={0} actions={bulkBarActions(ctx())} onAction={vi.fn()} onClear={vi.fn()} />);
    expect(screen.getByText('12 selected')).toBeInTheDocument();
    rerender(<BulkBar count={12} hidden={3} actions={bulkBarActions(ctx())} onAction={vi.fn()} onClear={vi.fn()} />);
    expect(screen.getByText('12 selected (3 hidden by filters)')).toBeInTheDocument();
  });

  it('each action is a button; the rest are under "More actions"', async () => {
    windowWidth(1440);
    const onAction = vi.fn();
    render(<BulkBar count={12} hidden={0} actions={bulkBarActions(ctx({ isAdmin: true }))} onAction={onAction} onClear={vi.fn()} />);
    const bar = screen.getByRole('region', { name: 'Bulk actions' });
    for (const name of ['Status', 'Priority', 'Assign', 'Due date', 'Project']) expect(within(bar).getByRole('button', { name })).toBeInTheDocument();
    await userEvent.click(within(bar).getByRole('button', { name: 'Status' }));
    expect(onAction).toHaveBeenLastCalledWith('status');
    await userEvent.click(within(bar).getByRole('button', { name: 'More actions' }));
    const menu = screen.getByRole('menu', { name: 'More actions' });
    expect(within(menu).getAllByRole('menuitem').map((m) => m.textContent)).toEqual(['Reassign', 'Unassign', 'Category', 'Guests', 'Duplicate', 'Archive', 'Delete']);
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Delete' }));
    expect(onAction).toHaveBeenLastCalledWith('delete');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('an employee’s menu has no Archive, Unarchive or Delete', async () => {
    windowWidth(1440);
    render(<BulkBar count={2} hidden={0} actions={bulkBarActions(ctx({ count: 2 }))} onAction={vi.fn()} onClear={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'More actions' }));
    const items = within(screen.getByRole('menu')).getAllByRole('menuitem').map((m) => m.textContent);
    expect(items).not.toContain('Archive');
    expect(items).not.toContain('Delete');
  });

  it('an unavailable action says why and does nothing (several projects: no Category)', async () => {
    windowWidth(1440);
    const onAction = vi.fn();
    render(<BulkBar count={2} hidden={0} actions={bulkBarActions(ctx({ count: 2, projectIds: ['p1', 'p2'] }))} onAction={onAction} onClear={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'More actions' }));
    const category = screen.getByRole('menuitem', { name: /Category/ });
    expect(category).toHaveAttribute('aria-disabled', 'true');
    expect(category).toHaveTextContent('Select tasks of one project to change their categories.');
    await userEvent.click(category);
    expect(onAction).not.toHaveBeenCalled();
  });

  it('more than 500: says the limit; every action is unavailable; Clear still works', async () => {
    windowWidth(1440);
    const onAction = vi.fn();
    const onClear = vi.fn();
    render(<BulkBar count={501} hidden={0} actions={bulkBarActions(ctx({ count: 501 }))} onAction={onAction} onClear={onClear} />);
    expect(screen.getByText('Bulk changes take up to 500 tasks at a time', { selector: '[data-bulk-limit]' })).toBeVisible();
    const status = screen.getByRole('button', { name: 'Status' });
    expect(status).toHaveAttribute('aria-disabled', 'true');
    expect(status).toHaveAccessibleDescription('Bulk changes take up to 500 tasks at a time');
    await userEvent.click(status);
    expect(onAction).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Clear selection' }));
    expect(onClear).toHaveBeenCalled();
  });
});

describe('BulkBar (phone)', () => {
  it('a compact bar "12 selected · Actions" opens a sheet with the same actions (44px rows), Escape closes it', async () => {
    windowWidth(375);
    const onAction = vi.fn();
    render(<BulkBar count={12} hidden={0} actions={bulkBarActions(ctx({ isAdmin: true }))} onAction={onAction} onClear={vi.fn()} />);
    expect(screen.getByText('12 selected')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Status' })).not.toBeInTheDocument();
    const open = screen.getByRole('button', { name: 'Actions' });
    await userEvent.click(open);
    const sheet = screen.getByRole('dialog', { name: 'Actions for 12 tasks' });
    const rows = within(sheet).getAllByRole('button').filter((b) => b.dataset.bulkAction);
    expect(rows.map((b) => b.dataset.bulkAction)).toEqual(['status', 'priority', 'assign', 'reassign', 'unassign', 'dueDate', 'project', 'category', 'guests', 'duplicate', 'archive', 'delete']);
    for (const r of rows) expect(r.className).toContain('min-h-11');
    // Focus is in the sheet, and stays there.
    expect(sheet.contains(document.activeElement)).toBe(true);
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(open).toHaveFocus();
    await userEvent.click(open);
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Priority' }));
    expect(onAction).toHaveBeenCalledWith('priority');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('Clear selection is in the sheet too', async () => {
    windowWidth(375);
    const onClear = vi.fn();
    render(<BulkBar count={3} hidden={1} actions={bulkBarActions(ctx({ count: 3 }))} onAction={vi.fn()} onClear={onClear} />);
    expect(screen.getByText('3 selected (1 hidden by filters)')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Actions' }));
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Clear selection' }));
    expect(onClear).toHaveBeenCalled();
  });
});
