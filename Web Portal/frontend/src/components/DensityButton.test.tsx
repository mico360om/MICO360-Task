import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useAuthStore } from '../stores/auth-store';
import { initDensity, useDensityStore, useDensitySync } from '../lib/density';
import { DensityButton } from './DensityButton';
import { DensitySetting, DENSITY_WORDS } from './settings/DensitySetting';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
let prefs: Record<string, unknown>;
let saved: unknown[];
let failSave: boolean;
const html = () => document.documentElement.getAttribute('data-density');

/** matchMedia as a phone / touch screen (`coarse`) or a computer with a mouse. */
function screenIs(kind: 'computer' | 'phone') {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: kind === 'computer' ? query.includes('pointer: fine') && query.includes('min-width') : !(query.includes('pointer: fine') && query.includes('min-width')),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

beforeEach(() => {
  prefs = { timeZone: null, weekStart: null, myProjectsOnly: false, density: 'comfortable' };
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
  useAuthStore.getState().setSession({ user: { id: 'me', email: 'me@x', username: 'me', roles: ['EMPLOYEE'] }, accessToken: 'at', refreshToken: 'rt' });
  initDensity();
});
afterEach(() => {
  vi.unstubAllGlobals();
  useAuthStore.setState({ user: null, accessToken: null, refreshToken: null, isAuthenticated: false });
  useDensityStore.getState().set('comfortable');
});

function Sync() {
  useDensitySync();
  return null;
}

const renderBoth = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>
      <Sync />
      <DensitySetting />
      <div data-testid="toolbar">
        <DensityButton />
      </div>
    </QueryClientProvider>,
  );

describe('the quick “Compact rows” button (tables and lists)', () => {
  it('is a named toggle, off while comfortable, with its tooltip', async () => {
    screenIs('computer');
    renderBoth();
    const button = within(screen.getByTestId('toolbar')).getByRole('button', { name: 'Compact rows' });
    expect(button).toHaveAttribute('aria-pressed', 'false');
    expect(button).toHaveAttribute('title', DENSITY_WORDS.quickOff);
  });

  it('turns compact on and off, saved on the account, and Settings says the same', async () => {
    screenIs('computer');
    renderBoth();
    const user = userEvent.setup();
    const button = within(screen.getByTestId('toolbar')).getByRole('button', { name: 'Compact rows' });
    const group = screen.getByRole('group', { name: DENSITY_WORDS.label });
    await waitFor(() => expect(saved).toEqual([]));
    await user.click(button);
    expect(html()).toBe('compact');
    expect(button).toHaveAttribute('aria-pressed', 'true');
    expect(button).toHaveAttribute('title', DENSITY_WORDS.quickOn);
    expect(within(group).getByRole('button', { name: 'Compact' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(group).getByRole('button', { name: 'Comfortable' })).toHaveAttribute('aria-pressed', 'false');
    await waitFor(() => expect(saved).toEqual([{ density: 'compact' }]));
    // …and Settings back to comfortable: the button follows.
    await user.click(within(group).getByRole('button', { name: 'Comfortable' }));
    expect(html()).toBe('comfortable');
    expect(button).toHaveAttribute('aria-pressed', 'false');
    await waitFor(() => expect(saved).toEqual([{ density: 'compact' }, { density: 'comfortable' }]));
  });

  it('a refused save says so beside the button, and the rows stay as they were', async () => {
    screenIs('computer');
    renderBoth();
    failSave = true;
    const button = within(screen.getByTestId('toolbar')).getByRole('button', { name: 'Compact rows' });
    await userEvent.setup().click(button);
    const alert = await within(screen.getByTestId('toolbar')).findByRole('alert');
    expect(alert).toHaveTextContent(DENSITY_WORDS.failed);
    // Under the button, out of the toolbar's flow: a toolbar that doesn't wrap never widens the page.
    expect(alert).toHaveClass('absolute', 'whitespace-nowrap');
    expect(html()).toBe('comfortable');
    expect(button).toHaveAttribute('aria-pressed', 'false');
  });

  it('is not shown where compact can’t apply (phones and touch screens keep 44px rows): it waits in Settings', () => {
    screenIs('computer');
    renderBoth();
    const button = within(screen.getByTestId('toolbar')).getByRole('button', { name: 'Compact rows' });
    // Hidden by CSS on a phone or a touch screen (jsdom draws no media): the classes say so.
    expect(button.closest('[data-density-button]')?.className).toMatch(/max-md:hidden/);
    expect(button.closest('[data-density-button]')?.className).toMatch(/\[@media\(pointer:coarse\)\]:hidden/);
  });
});

describe('Settings → Appearance: Comfortable | Compact', () => {
  it('sits next to Theme with its plain hint; comfortable at first', async () => {
    screenIs('computer');
    renderBoth();
    const group = screen.getByRole('group', { name: DENSITY_WORDS.label });
    expect(within(group).getByRole('button', { name: 'Comfortable' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(group).getByRole('button', { name: 'Compact' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByText(DENSITY_WORDS.hint)).toBeInTheDocument();
    expect(screen.queryByText(DENSITY_WORDS.phones)).toBeNull();
  });

  it('the account’s compact shows as chosen once it arrives', async () => {
    screenIs('computer');
    prefs.density = 'compact';
    renderBoth();
    const group = screen.getByRole('group', { name: DENSITY_WORDS.label });
    await waitFor(() => expect(within(group).getByRole('button', { name: 'Compact' })).toHaveAttribute('aria-pressed', 'true'));
    expect(html()).toBe('compact');
  });

  it('on a phone or touch screen it is still there, and says phones keep comfortable spacing', async () => {
    screenIs('phone');
    renderBoth();
    expect(screen.getByRole('group', { name: DENSITY_WORDS.label })).toBeInTheDocument();
    expect(screen.getByText(DENSITY_WORDS.phones)).toBeInTheDocument();
  });

  it('a refused save says so in Settings', async () => {
    screenIs('computer');
    renderBoth();
    failSave = true;
    await userEvent.setup().click(within(screen.getByRole('group', { name: DENSITY_WORDS.label })).getByRole('button', { name: 'Compact' }));
    const alerts = await screen.findAllByRole('alert');
    expect(alerts.map((a) => a.textContent)).toContain(DENSITY_WORDS.failed);
    expect(html()).toBe('comfortable');
  });
});
