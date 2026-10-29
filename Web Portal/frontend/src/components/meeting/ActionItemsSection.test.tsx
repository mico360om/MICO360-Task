import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { render, screen } from '@testing-library/react';
import { ActionItemsSection } from './ActionItemsSection';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const item = {
  id: 'ai1', meetingId: 'm1', agendaItemId: null, sourceNoteId: null, projectId: null, description: 'Book the conference room', assigneeId: 'u1',
  priority: 'LOW', status: 'OPEN', dueDate: null, progress: 0, completedAt: null, taskId: null, createdById: 'u1', createdAt: '', updatedAt: '',
};

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => (String(url).endsWith('/meetings/m1/action-items') ? json({ data: [item] }) : json({ data: [] }))));
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function renderIt() {
  render(
    <MemoryRouter>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ActionItemsSection meetingId="m1" directory={[{ id: 'u1', username: 'aisha', firstName: 'Aisha', lastName: 'Khan', avatarUrl: null }]} canEdit pollMs={false} timeZone="Asia/Muscat" />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe('Meeting page: action items', () => {
  // The section's width depends on the page around it (beside the side column on a laptop, full width
  // on a tablet), so its controls wrap by the room they really have: owner + due date, then priority +
  // status — never a fixed four-column row that squeezed the owner to one letter at 768–1279px.
  it('keeps the owner readable: each row’s controls wrap in pairs by the room they have', async () => {
    renderIt();
    const owner = await screen.findByRole('button', { name: /owner of book the conference room/i });
    const ownerBox = owner.closest('.relative')!;
    expect(ownerBox.className).toMatch(/flex-\[1_1_12rem\]/);
    const pair = ownerBox.parentElement!;
    expect(pair).toContainElement(screen.getByLabelText(/due date for book the conference room/i));
    expect(pair.className).toMatch(/flex-wrap/);
    const other = screen.getByLabelText(/priority for book the conference room/i).parentElement!;
    expect(other).toContainElement(screen.getByLabelText(/status for book the conference room/i));
    expect(other.parentElement).toBe(pair.parentElement);
    expect(pair.parentElement!.className).toMatch(/flex-wrap/);
  });

  it('wraps the new item’s owner, date, priority and Add the same way', async () => {
    renderIt();
    const owner = await screen.findByRole('button', { name: /owner of the new item/i });
    expect(owner.closest('.relative')!.className).toMatch(/flex-\[1_1_12rem\]/);
    expect(owner.closest('.relative')!.parentElement).toContainElement(screen.getByLabelText('Due date of the new item'));
  });
});
