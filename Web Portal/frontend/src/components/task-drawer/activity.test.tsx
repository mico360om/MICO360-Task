import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
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

describe('ActivityTimeline: guests and categories (1.24)', () => {
  it('words guest lines as guests (not external contacts) and shows category lines', () => {
    const history: DrawerActivity[] = [
      { id: 'g4', action: 'CATEGORY_REMOVED', actorName: 'Mona', createdAt: at(1), meta: { name: 'HSE', categoryId: 'k2' } },
      { id: 'g3', action: 'CATEGORY_ADDED', actorName: 'Mona', createdAt: at(50), meta: { name: 'Electrical', categoryId: 'k1' } },
      { id: 'g2', action: 'EXTERNAL_CONTACT_REMOVED', actorName: 'Omar', createdAt: at(100), meta: { name: 'Sara', company: null, guestId: 'g2' } },
      { id: 'g1', action: 'EXTERNAL_CONTACT_ADDED', actorName: 'Omar', createdAt: at(200), meta: { name: 'Ahmed', company: 'Acme', guestId: 'g1' } },
    ];
    render(<ActivityTimeline activity={history} />);
    const lines = within(screen.getByRole('list', { name: 'Activity' })).getAllByRole('listitem').map((li) => li.textContent);
    expect(lines[0]).toContain('Mona removed category HSE');
    expect(lines[1]).toContain('Mona added category Electrical');
    expect(lines[2]).toContain('Omar removed guest Sara');
    expect(lines[3]).toContain('Omar assigned guest Ahmed (Acme)');
    expect(screen.queryByText(/external contact/)).toBeNull();
  });
});
