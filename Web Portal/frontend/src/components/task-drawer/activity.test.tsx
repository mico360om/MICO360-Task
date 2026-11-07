import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ActivityTimeline, type DrawerActivity } from './activity';

const at = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000).toISOString();
const rows: DrawerActivity[] = [
  { id: 'h3', action: 'CHECKLIST_LIST_REMOVED', actorName: 'Khurram', createdAt: at(1), meta: { listId: 'l1', title: 'Plumbing', count: 2, batchId: 'b-list' } },
  { id: 'h2', action: 'CHECKLIST_REMOVED', actorName: 'Khurram', createdAt: at(2), meta: { itemId: 'i1', text: 'Wiring', count: 4, batchId: 'b-item' } },
  { id: 'h1', action: 'CHECKLIST_REMOVED', actorName: 'Khurram', createdAt: at(3), meta: { itemId: 'i2', text: 'Old', count: 1, batchId: 'b-gone' } },
];

describe('ActivityTimeline: deleted checklist items can be restored from the history (1.23.3)', () => {
  it('offers Restore on a delete while its batch can still be restored, and only then', async () => {
    const onRestore = vi.fn(async () => {});
    render(<ActivityTimeline activity={rows} restorable={new Set(['b-list', 'b-item'])} onRestore={onRestore} />);
    expect(screen.getByText('deleted the checklist “Plumbing” (2 items)')).toBeInTheDocument();
    const buttons = screen.getAllByRole('button', { name: /^Restore/ });
    expect(buttons.map((b) => b.getAttribute('aria-label'))).toEqual(['Restore the checklist “Plumbing”', 'Restore “Wiring” and its 3 sub-items']);
    await userEvent.click(buttons[1]!);
    expect(onRestore).toHaveBeenCalledWith('b-item');
  });

  it('says why a restore failed', async () => {
    const onRestore = vi.fn(async () => {
      throw new Error('That checklist has 500 items: nothing more fits.');
    });
    render(<ActivityTimeline activity={rows} restorable={new Set(['b-item'])} onRestore={onRestore} />);
    await userEvent.click(screen.getByRole('button', { name: /^Restore “Wiring”/ }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('That checklist has 500 items: nothing more fits.'));
  });

  it('shows no Restore without a way to restore', () => {
    render(<ActivityTimeline activity={rows} restorable={new Set(['b-item'])} />);
    expect(screen.queryByRole('button', { name: /^Restore/ })).toBeNull();
  });
});
