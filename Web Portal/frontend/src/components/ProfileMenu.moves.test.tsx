import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ProfileMenu } from './ProfileMenu';
import { useAuthStore } from '../stores/auth-store';
import { useManagerViewStore } from '../lib/manager-view';

/**
 * Owner, 13 Nov (batch 4b): the Recycle Bin, Error Log and Audit Logs are in the account menu under your name —
 * after Settings — instead of the left menu, for exactly the people who had them there: the Recycle Bin for
 * administrators and the people who run a project; Error Log and Audit Logs with the Admin group's rules
 * (administrators, hidden while Manager View is on).
 */
const me = (roles: string[]) => ({ id: 'u1', email: 'aisha@x.co', username: 'aisha', roles, firstName: 'Aisha', lastName: 'Khan', avatarUrl: null });
function Where() {
  return <span data-testid="where">{useLocation().pathname}</span>;
}
function show(roles: string[], opts: { canLead?: boolean } = {}) {
  useAuthStore.getState().setSession({ user: me(roles) as never, accessToken: 'a1', refreshToken: 'r1' }, { remember: true });
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/dashboard']}>
        <ProfileMenu {...(opts.canLead !== undefined ? { canLead: opts.canLead } : {})} />
        <Where />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
const open = async () => {
  await userEvent.setup().click(screen.getByRole('button', { name: 'Account menu' }));
  return screen.getByRole('menu');
};
const names = (menu: HTMLElement) => Array.from(menu.querySelectorAll('[role^="menuitem"]')).map((i) => i.textContent?.trim() ?? '');

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ data: {} }), { status: 200, headers: { 'content-type': 'application/json' } })));
});
afterEach(() => {
  vi.unstubAllGlobals();
  useManagerViewStore.getState().clear();
  useAuthStore.setState({ user: null, accessToken: null, refreshToken: null, isAuthenticated: false });
});

describe('the account menu: Recycle Bin, Error Log, Audit Logs', () => {
  it('an administrator: after Settings, in this order, each to its page', async () => {
    useManagerViewStore.getState().set('u1', false);
    show(['ADMIN'], { canLead: true });
    const menu = await open();
    const list = names(menu);
    expect(list.slice(0, 5)).toEqual(['Your profile', 'Settings', 'Recycle Bin', 'Error Log', 'Audit Logs']);
    expect(within(menu).getByRole('menuitem', { name: 'Recycle Bin' })).toHaveAttribute('href', '/recycle-bin');
    expect(within(menu).getByRole('menuitem', { name: 'Error Log' })).toHaveAttribute('href', '/admin/error-log');
    expect(within(menu).getByRole('menuitem', { name: 'Audit Logs' })).toHaveAttribute('href', '/admin/audit');
    expect(within(menu).getAllByRole('separator').length).toBeGreaterThanOrEqual(1);
  });

  it('an administrator with Manager View on keeps the Recycle Bin (as before) but not the Admin pages', async () => {
    useManagerViewStore.getState().set('u1', true);
    show(['ADMIN'], { canLead: true });
    const menu = await open();
    expect(within(menu).getByRole('menuitem', { name: 'Recycle Bin' })).toBeInTheDocument();
    expect(within(menu).queryByRole('menuitem', { name: 'Error Log' })).toBeNull();
    expect(within(menu).queryByRole('menuitem', { name: 'Audit Logs' })).toBeNull();
  });

  it('someone who runs a project: the Recycle Bin only', async () => {
    show(['EMPLOYEE'], { canLead: true });
    const menu = await open();
    expect(names(menu).slice(0, 3)).toEqual(['Your profile', 'Settings', 'Recycle Bin']);
    expect(within(menu).queryByRole('menuitem', { name: 'Error Log' })).toBeNull();
    expect(within(menu).queryByRole('menuitem', { name: 'Audit Logs' })).toBeNull();
  });

  it('an employee: none of them, and no empty divider', async () => {
    show(['EMPLOYEE'], { canLead: false });
    const menu = await open();
    for (const n of ['Recycle Bin', 'Error Log', 'Audit Logs']) expect(within(menu).queryByRole('menuitem', { name: n })).toBeNull();
    expect(within(menu).queryAllByRole('separator')).toHaveLength(0);
  });

  it('choosing one goes there and closes the menu; Escape still closes it', async () => {
    useManagerViewStore.getState().set('u1', false);
    show(['ADMIN'], { canLead: true });
    const user = userEvent.setup();
    let menu = await open();
    await user.click(within(menu).getByRole('menuitem', { name: 'Recycle Bin' }));
    expect(screen.getByTestId('where')).toHaveTextContent('/recycle-bin');
    expect(screen.queryByRole('menu')).toBeNull();
    menu = await open();
    expect(menu).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
  });
});
