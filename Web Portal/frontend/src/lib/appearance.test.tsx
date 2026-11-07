import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { useAuthStore } from '../stores/auth-store';
import { clearUserStorage, readUserValue } from './user-storage';
import { BOARD_WIDTH_PREF, SIDEBAR_PREF } from './appearance-names';
import { initAppearance, useAppearanceStore, useAppearanceSync, useBoardColumnWidth, useSetAppearance, useSidebarCollapsed } from './appearance';
import { useSetDensity } from './density';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
let prefs: Record<string, unknown>;
let saved: unknown[];
let failSave: boolean;
const attr = (name: string) => document.documentElement.getAttribute(name);
const signIn = (id = 'me') => useAuthStore.getState().setSession({ user: { id, email: `${id}@x`, username: id, roles: ['EMPLOYEE'] }, accessToken: 'at', refreshToken: 'rt' });

let qc: QueryClient;
const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;

beforeEach(() => {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  prefs = { timeZone: null, weekStart: null, myProjectsOnly: false, density: 'comfortable', sidebarCollapsed: false, boardColumnWidth: 'normal' };
  saved = [];
  failSave = false;
  localStorage.clear();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/users/me/preferences') && init?.method === 'PUT') {
        if (failSave) return json({ error: { code: 'INTERNAL', message: 'Something went wrong.' } }, 500);
        const body = JSON.parse(String(init.body));
        saved.push(body);
        prefs = { ...prefs, ...body };
        return json({ data: prefs });
      }
      if (url.endsWith('/users/me/preferences')) return json({ data: prefs });
      return json({ data: null });
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  useAuthStore.setState({ user: null, accessToken: null, refreshToken: null, isAuthenticated: false });
  useAppearanceStore.getState().set({ sidebarCollapsed: false, boardColumnWidth: 'normal' });
});

function Shell() {
  useAppearanceSync();
  return (
    <span data-testid="look">
      {String(useSidebarCollapsed())} {useBoardColumnWidth()}
    </span>
  );
}

describe('the folded side menu and the board column width (1.23.8)', () => {
  it('start open and Normal, stamped on <html>', () => {
    initAppearance();
    expect(attr('data-sidebar')).toBe('open');
    expect(attr('data-board-width')).toBe('normal');
  });

  it('before the first paint a signed-in person gets their last choice on this device (no jump)', () => {
    localStorage.setItem(`mico360.u.me.${SIDEBAR_PREF}`, 'collapsed');
    localStorage.setItem(`mico360.u.me.${BOARD_WIDTH_PREF}`, 'wide');
    signIn('me');
    initAppearance();
    expect(attr('data-sidebar')).toBe('collapsed');
    expect(attr('data-board-width')).toBe('wide');
  });

  it('another person signing in gets their own; signing out goes back to the defaults', () => {
    localStorage.setItem(`mico360.u.ada.${SIDEBAR_PREF}`, 'collapsed');
    initAppearance();
    act(() => signIn('ada'));
    expect(attr('data-sidebar')).toBe('collapsed');
    act(() => signIn('bo'));
    expect(attr('data-sidebar')).toBe('open');
    act(() => useAuthStore.getState().logout('expired'));
    expect(attr('data-sidebar')).toBe('open');
  });

  it('the account’s choices arrive and win, and are remembered on this device', async () => {
    prefs.sidebarCollapsed = true;
    prefs.boardColumnWidth = 'narrow';
    signIn('me');
    initAppearance();
    const { getByTestId } = render(<Shell />, { wrapper });
    await waitFor(() => expect(attr('data-sidebar')).toBe('collapsed'));
    expect(attr('data-board-width')).toBe('narrow');
    expect(getByTestId('look').textContent).toBe('true narrow');
    expect(readUserValue('me', SIDEBAR_PREF)).toBe('collapsed');
    expect(readUserValue('me', BOARD_WIDTH_PREF)).toBe('narrow');
  });

  it('a change shows at once and is saved on the account; only what changed is sent', async () => {
    signIn('me');
    initAppearance();
    render(<Shell />, { wrapper });
    const { result } = renderHook(() => useSetAppearance(), { wrapper });
    await waitFor(() => expect(qc.getQueryData(['date-prefs'])).toBeTruthy());
    act(() => result.current.change({ sidebarCollapsed: true }));
    expect(attr('data-sidebar')).toBe('collapsed');
    await waitFor(() => expect(saved).toEqual([{ sidebarCollapsed: true }]));
    act(() => result.current.change({ boardColumnWidth: 'wide' }));
    expect(attr('data-board-width')).toBe('wide');
    await waitFor(() => expect(saved).toEqual([{ sidebarCollapsed: true }, { boardColumnWidth: 'wide' }]));
    await waitFor(() => expect(result.current.saving).toBe(false));
    expect(attr('data-sidebar')).toBe('collapsed');
    expect(readUserValue('me', BOARD_WIDTH_PREF)).toBe('wide');
  });

  it('a refused save puts the old choice back, everywhere, and says so', async () => {
    signIn('me');
    initAppearance();
    render(<Shell />, { wrapper });
    const { result } = renderHook(() => useSetAppearance(), { wrapper });
    await waitFor(() => expect(qc.getQueryData(['date-prefs'])).toBeTruthy());
    failSave = true;
    act(() => result.current.change({ boardColumnWidth: 'narrow' }));
    expect(attr('data-board-width')).toBe('narrow');
    await waitFor(() => expect(result.current.failed).toBe(true));
    expect(attr('data-board-width')).toBe('normal');
    expect(readUserValue('me', BOARD_WIDTH_PREF)).toBe(null);
  });

  it('kept on this device across a sign-out (the person’s own choice, not cached data)', () => {
    localStorage.setItem(`mico360.u.me.${SIDEBAR_PREF}`, 'collapsed');
    localStorage.setItem(`mico360.u.me.${BOARD_WIDTH_PREF}`, 'wide');
    clearUserStorage();
    expect(readUserValue('me', SIDEBAR_PREF)).toBe('collapsed');
    expect(readUserValue('me', BOARD_WIDTH_PREF)).toBe('wide');
  });

  it('saves after a row-mode change in order (one queue for the person’s settings)', async () => {
    signIn('me');
    initAppearance();
    render(<Shell />, { wrapper });
    const { result } = renderHook(() => ({ look: useSetAppearance(), rows: useSetDensity() }), { wrapper });
    await waitFor(() => expect(qc.getQueryData(['date-prefs'])).toBeTruthy());
    act(() => {
      result.current.rows.change('detailed');
      result.current.look.change({ sidebarCollapsed: true });
    });
    await waitFor(() => expect(saved).toEqual([{ density: 'detailed' }, { sidebarCollapsed: true }]));
  });
});
