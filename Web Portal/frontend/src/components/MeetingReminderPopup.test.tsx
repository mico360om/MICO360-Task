import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { MeetingReminderPopup } from './MeetingReminderPopup';
import { useAuthStore } from '../stores/auth-store';
import { NOTIFICATIONS_KEY, UNREAD_COUNT_KEY } from '../api/notifications';

type Handler = (...a: unknown[]) => void;
const handlers: Record<string, Handler> = {};
vi.mock('socket.io-client', () => ({
  io: () => ({ connected: false, on: (ev: string, cb: Handler) => { handlers[ev] = cb; }, emit: () => {}, connect: () => {}, disconnect: () => {} }),
}));

let posts: string[] = [];
beforeEach(() => {
  posts = [];
  for (const k of Object.keys(handlers)) delete handlers[k];
  useAuthStore.getState().setSession({ user: { id: 'me', email: 'me@x', username: 'me', roles: ['EMPLOYEE'] }, accessToken: 'at', refreshToken: 'rt' });
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if ((init?.method ?? 'GET') !== 'GET') posts.push(`${init?.method} ${String(url)}`);
    return new Response(JSON.stringify({ data: {} }), { status: 200, headers: { 'content-type': 'application/json' } });
  }));
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  useAuthStore.setState({ user: null, accessToken: null, refreshToken: null, isAuthenticated: false });
});

function Where() {
  return <p data-testid="where">{useLocation().pathname}</p>;
}
function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(qc, 'invalidateQueries');
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/dashboard']}>
        <MeetingReminderPopup />
        <Routes>
          <Route path="*" element={<Where />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  const refreshed = (key: readonly unknown[]) => invalidate.mock.calls.some(([arg]) => JSON.stringify((arg as { queryKey?: unknown }).queryKey) === JSON.stringify(key));
  return { refreshed };
}
const reminder = {
  id: 'n1',
  type: 'MEETING_REMINDER',
  title: 'Meeting in 15 minutes: Core switch go-live review',
  body: '09:00–10:00 · OXY HQ – Meeting room 2 · Join online',
  entityType: 'meeting',
  entityId: 'm1',
  createdAt: '2026-10-31T04:45:00.000Z',
};

describe('MeetingReminderPopup: a meeting reminder pops up on the open website', () => {
  it('shows the reminder at once, and the bell is refreshed', () => {
    const { refreshed } = mount();
    act(() => handlers['notification:new']?.(reminder));
    expect(screen.getByText('Meeting in 15 minutes: Core switch go-live review')).toBeInTheDocument();
    expect(screen.getByText('09:00–10:00 · OXY HQ – Meeting room 2 · Join online')).toBeInTheDocument();
    expect(refreshed(UNREAD_COUNT_KEY)).toBe(true);
    expect(refreshed(NOTIFICATIONS_KEY)).toBe(true);
  });

  it('Open meeting reads it and opens the meeting', async () => {
    mount();
    act(() => handlers['notification:new']?.(reminder));
    await userEvent.click(screen.getByRole('button', { name: 'Open meeting' }));
    expect(screen.getByTestId('where')).toHaveTextContent('/meetings/m1');
    expect(posts.some((p) => p.includes('/notifications/n1/read'))).toBe(true);
    expect(screen.queryByText('Meeting in 15 minutes: Core switch go-live review')).not.toBeInTheDocument();
  });

  it('Dismiss takes it off the screen (it stays in the bell, unread)', async () => {
    mount();
    act(() => handlers['notification:new']?.(reminder));
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss: Meeting in 15 minutes: Core switch go-live review' }));
    expect(screen.queryByText('Meeting in 15 minutes: Core switch go-live review')).not.toBeInTheDocument();
    expect(posts).toEqual([]);
  });

  it('other notifications only refresh the bell — no pop-up', () => {
    const { refreshed } = mount();
    act(() => handlers['notification:new']?.({ ...reminder, id: 'n2', type: 'TASK_ASSIGNED', title: 'You were assigned a task', entityType: 'task' }));
    expect(screen.queryByText('You were assigned a task')).not.toBeInTheDocument();
    expect(refreshed(UNREAD_COUNT_KEY)).toBe(true);
  });

  it('is read out politely by screen readers, without taking the focus — and adds no empty landmark to every page', () => {
    mount();
    expect(screen.queryByRole('region')).toBeNull();
    act(() => handlers['notification:new']?.(reminder));
    const card = screen.getByRole('group', { name: 'Meeting in 15 minutes: Core switch go-live review' });
    expect(card.parentElement).toHaveAttribute('aria-live', 'polite');
    expect(document.activeElement).toBe(document.body);
  });
});
