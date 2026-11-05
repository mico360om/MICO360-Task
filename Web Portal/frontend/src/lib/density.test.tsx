import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { useAuthStore } from '../stores/auth-store';
import { clearUserStorage, readUserValue } from './user-storage';
import { DatePreferences } from '../components/DatePreferences';
import { DENSITY_PREF, initDensity, useDensity, useDensityStore, useDensitySync, useSetDensity } from './density';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
let prefs: Record<string, unknown>;
let saved: unknown[];
let failSave: boolean;
/** While set, a PUT waits for `release()` (to see what happens mid-save). */
let hold: Promise<void> | null;
let release: () => void;
let failWeek: boolean;
let holdWeekOnly: boolean;

/** The saves that reached the server, in order (not the ones only started). */
const done = () => saved.filter((x) => !(x && typeof x === 'object' && 'started' in x));
const started = () => saved.filter((x): x is { started: unknown } => !!x && typeof x === 'object' && 'started' in x).map((x) => x.started);
const html = () => document.documentElement.getAttribute('data-density');
const signIn = (id = 'me') => useAuthStore.getState().setSession({ user: { id, email: `${id}@x`, username: id, roles: ['EMPLOYEE'] }, accessToken: 'at', refreshToken: 'rt' });

let qc: QueryClient;
const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;

beforeEach(() => {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  prefs = { timeZone: null, weekStart: null, myProjectsOnly: false, density: 'comfortable' };
  saved = [];
  failSave = false;
  failWeek = false;
  holdWeekOnly = false;
  hold = null;
  localStorage.clear();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/users/me/preferences') && init?.method === 'PUT') {
        const body = JSON.parse(String(init.body));
        saved.push({ started: body });
        if (hold && (!holdWeekOnly || 'weekStart' in body)) await hold;
        if (failSave || (failWeek && 'weekStart' in body)) return json({ error: { code: 'INTERNAL', message: 'Something went wrong.' } }, 500);
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
  useDensityStore.getState().set('comfortable');
  document.documentElement.removeAttribute('data-density');
});

/** What a page has: the sync (AppShell) and a reader. */
function Shell() {
  useDensitySync();
  return <span data-testid="d">{useDensity()}</span>;
}

describe('Compact / comfortable rows — on <html> and on the account (1.23.0)', () => {
  it('starts comfortable: the attribute says so, nothing else changes', () => {
    initDensity();
    expect(html()).toBe('comfortable');
  });

  it('before the first paint, a signed-in person gets their last choice on this device (no jump while loading)', () => {
    localStorage.setItem(`mico360.u.me.${DENSITY_PREF}`, 'compact');
    signIn('me');
    initDensity();
    expect(html()).toBe('compact');
  });

  it('a different person signing in gets their own; signing out goes back to comfortable', () => {
    localStorage.setItem(`mico360.u.ada.${DENSITY_PREF}`, 'compact');
    initDensity();
    act(() => signIn('ada'));
    expect(html()).toBe('compact');
    act(() => signIn('bo'));
    expect(html()).toBe('comfortable');
    act(() => signIn('ada'));
    expect(html()).toBe('compact');
    act(() => useAuthStore.getState().logout('expired'));
    expect(html()).toBe('comfortable');
  });

  it('the account’s choice is applied on sign-in and remembered on this device', async () => {
    prefs.density = 'compact';
    signIn('me');
    initDensity();
    expect(html()).toBe('comfortable');
    const { getByTestId } = render(<Shell />, { wrapper });
    await waitFor(() => expect(html()).toBe('compact'));
    expect(getByTestId('d').textContent).toBe('compact');
    expect(readUserValue('me', DENSITY_PREF)).toBe('compact');
  });

  it('the account’s comfortable wins over an older compact on this device', async () => {
    localStorage.setItem(`mico360.u.me.${DENSITY_PREF}`, 'compact');
    signIn('me');
    initDensity();
    expect(html()).toBe('compact');
    render(<Shell />, { wrapper });
    await waitFor(() => expect(html()).toBe('comfortable'));
    expect(readUserValue('me', DENSITY_PREF)).toBe(null);
  });

  it('a change shows at once, is saved on the account, and every reader agrees', async () => {
    signIn('me');
    initDensity();
    render(<Shell />, { wrapper });
    const { result } = renderHook(() => ({ set: useSetDensity(), d: useDensity() }), { wrapper });
    await waitFor(() => expect(qc.getQueryData(['date-prefs'])).toBeTruthy());
    act(() => result.current.set.change('compact'));
    expect(html()).toBe('compact');
    expect(result.current.d).toBe('compact');
    await waitFor(() => expect(done()).toEqual([{ density: 'compact' }]));
    await waitFor(() => expect(result.current.set.saving).toBe(false));
    expect(html()).toBe('compact');
    expect(readUserValue('me', DENSITY_PREF)).toBe('compact');
    expect((qc.getQueryData(['date-prefs']) as { density: string }).density).toBe('compact');
  });

  it('a refused save puts the old choice back, everywhere', async () => {
    signIn('me');
    initDensity();
    render(<Shell />, { wrapper });
    const { result } = renderHook(() => ({ set: useSetDensity(), d: useDensity() }), { wrapper });
    await waitFor(() => expect(qc.getQueryData(['date-prefs'])).toBeTruthy());
    failSave = true;
    act(() => result.current.set.change('compact'));
    expect(html()).toBe('compact');
    await waitFor(() => expect(result.current.set.failed).toBe(true));
    expect(html()).toBe('comfortable');
    expect(result.current.d).toBe('comfortable');
    expect(readUserValue('me', DENSITY_PREF)).toBe(null);
  });

  it('is kept on this device across a sign-out (it is the person’s own choice, not cached data)', () => {
    localStorage.setItem(`mico360.u.me.${DENSITY_PREF}`, 'compact');
    clearUserStorage();
    expect(readUserValue('me', DENSITY_PREF)).toBe('compact');
  });

  it('an answer read while a change is being saved never undoes it', async () => {
    signIn('me');
    initDensity();
    render(<Shell />, { wrapper });
    const { result } = renderHook(() => ({ set: useSetDensity() }), { wrapper });
    await waitFor(() => expect(qc.getQueryData(['date-prefs'])).toBeTruthy());
    hold = new Promise((r) => (release = r));
    act(() => result.current.set.change('compact'));
    await waitFor(() => expect(started()).toEqual([{ density: 'compact' }]));
    // The window regains focus: the settings are read again — still comfortable on the server.
    await act(async () => {
      await qc.refetchQueries({ queryKey: ['date-prefs'] });
    });
    expect(html()).toBe('compact');
    act(() => release());
    await waitFor(() => expect(done()).toEqual([{ density: 'compact' }]));
    await waitFor(() => expect(result.current.set.saving).toBe(false));
    expect(html()).toBe('compact');
  });

  it('two quick changes are saved one after the other: the last one is what the account keeps', async () => {
    signIn('me');
    initDensity();
    render(<Shell />, { wrapper });
    const { result } = renderHook(() => ({ set: useSetDensity() }), { wrapper });
    await waitFor(() => expect(qc.getQueryData(['date-prefs'])).toBeTruthy());
    hold = new Promise((r) => (release = r));
    act(() => result.current.set.change('compact'));
    await waitFor(() => expect(started()).toEqual([{ density: 'compact' }]));
    act(() => result.current.set.change('comfortable'));
    expect(html()).toBe('comfortable');
    // The second waits for the first.
    await new Promise((r) => setTimeout(r, 30));
    expect(started()).toEqual([{ density: 'compact' }]);
    hold = null;
    act(() => release());
    await waitFor(() => expect(done()).toEqual([{ density: 'compact' }, { density: 'comfortable' }]));
    await waitFor(() => expect(prefs.density).toBe('comfortable'));
    await waitFor(() => expect(result.current.set.saving).toBe(false));
    expect(html()).toBe('comfortable');
  });

  it('a week start that can’t be saved puts back only the week start, not rows changed meanwhile', async () => {
    signIn('me');
    initDensity();
    render(
      <>
        <Shell />
        <DatePreferences />
      </>,
      { wrapper },
    );
    const { result } = renderHook(() => ({ set: useSetDensity() }), { wrapper });
    await waitFor(() => expect(qc.getQueryData(['date-prefs'])).toBeTruthy());
    failWeek = true;
    holdWeekOnly = true;
    hold = new Promise((r) => (release = r));
    await userEvent.setup().click(screen.getByRole('button', { name: 'Monday' }));
    await waitFor(() => expect(started()).toEqual([{ weekStart: 1 }]));
    // While the week start is on its way, compact rows are picked (that save would answer at once).
    act(() => result.current.set.change('compact'));
    expect(html()).toBe('compact');
    await new Promise((r) => setTimeout(r, 30));
    act(() => release());
    await screen.findByText('Couldn’t save that change. Please try again.');
    await waitFor(() => expect(done()).toEqual([{ density: 'compact' }]));
    await waitFor(() => expect(result.current.set.saving).toBe(false));
    expect(html()).toBe('compact');
    expect((qc.getQueryData(['date-prefs']) as { density: string }).density).toBe('compact');
    expect((qc.getQueryData(['date-prefs']) as { weekStart: number | null }).weekStart).toBe(null);
  });
});
