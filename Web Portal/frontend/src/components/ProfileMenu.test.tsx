import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ProfileMenu } from './ProfileMenu';
import { useAuthStore } from '../stores/auth-store';
import { useTourStore } from './training/tour-store';

// The header's face (coordinator, 11 Nov): the current photo, and the person's own name's initials
// ("Aisha Khan" → AK), never the username's ("admin" → AD); it follows a photo changed elsewhere.
const KEY = '0b2f6c1e-1d2a-4c3b-9e8f-7a6b5c4d3e2f.png';
const me = (over: Record<string, unknown> = {}) => ({ id: 'u1', email: 'aisha@x.co', username: 'admin', roles: ['ADMIN'], firstName: 'Aisha', lastName: 'Khan', avatarUrl: null, ...over });
const answer = (data: unknown) => vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ data }), { status: 200, headers: { 'content-type': 'application/json' } })));

function show(user: Record<string, unknown>) {
  useAuthStore.getState().setSession({ user: user as never, accessToken: 'a1', refreshToken: 'r1' }, { remember: true });
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <ProfileMenu />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
const face = () => screen.getByRole('button', { name: 'Account menu' });

beforeEach(() => localStorage.clear());
afterEach(() => {
  vi.unstubAllGlobals();
  useAuthStore.setState({ user: null, accessToken: null, refreshToken: null, isAuthenticated: false });
});

describe('the header’s face', () => {
  it('no photo: the initials of their name, not of their username', async () => {
    answer(me());
    show(me());
    expect(face()).toHaveTextContent('AK');
    expect(face()).not.toHaveTextContent('AD');
  });

  it('a photo: its small face copy', async () => {
    answer(me({ avatarUrl: `/uploads/${KEY}` }));
    show(me({ avatarUrl: `/uploads/${KEY}` }));
    expect(face().querySelector('img')?.getAttribute('src')).toMatch(new RegExp(`/uploads/faces/${KEY.replace(/\./g, '\\.')}\\.webp$`));
  });

  it('a photo added elsewhere shows on the next load, without signing in again', async () => {
    answer(me({ avatarUrl: `/uploads/${KEY}` }));
    show({ id: 'u1', email: 'aisha@x.co', username: 'admin', roles: ['ADMIN'], avatarUrl: null }); // the copy saved at sign-in
    await waitFor(() => expect(face().querySelector('img')).not.toBeNull());
    expect(useAuthStore.getState().user).toMatchObject({ firstName: 'Aisha', avatarUrl: `/uploads/${KEY}` });
  });

  it('a photo that won’t load: the copy, then the photo, then the name’s initials', async () => {
    answer(me({ avatarUrl: `/uploads/${KEY}` }));
    show(me({ avatarUrl: `/uploads/${KEY}` }));
    fireEvent.error(face().querySelector('img')!);
    expect(face().querySelector('img')?.getAttribute('src')).toMatch(new RegExp(`/uploads/${KEY.replace(/\./g, '\\.')}$`));
    fireEvent.error(face().querySelector('img')!);
    expect(face().querySelector('img')).toBeNull();
    expect(face()).toHaveTextContent('AK');
  });
});

// 12 Nov (Learning Hub, design §1): "Take the tour" became "Tour of the site", in the account menu (any page).
describe('Tour of the site', () => {
  it('is in the account menu after Keyboard shortcuts; it closes the menu and starts the tour', async () => {
    answer(me({ roles: ['EMPLOYEE'] }));
    useTourStore.setState({ open: false });
    show(me({ roles: ['EMPLOYEE'] }));
    fireEvent.click(face());
    const items = screen.getAllByRole('menuitem').map((i) => i.textContent?.trim() ?? '');
    const shortcuts = items.findIndex((t) => t.startsWith('Keyboard shortcuts'));
    expect(shortcuts).toBeGreaterThanOrEqual(0);
    expect(items[shortcuts + 1]).toBe('Tour of the site');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Tour of the site' }));
    expect(useTourStore.getState().open).toBe(true);
    expect(screen.queryByRole('menu')).toBeNull();
    useTourStore.setState({ open: false });
  });
});
