import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useAuthStore } from '../stores/auth-store';
import { initDensity, useDensityStore, useDensitySync } from '../lib/density';
import { DensityButton } from './DensityButton';
import { DensitySetting, DENSITY_WORDS } from './settings/DensitySetting';
import { TOUCH_TALL } from '../lib/touch';

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

describe('the quick “Rows” button (tables and lists, 1.23.8)', () => {
  const toolbar = () => within(screen.getByTestId('toolbar'));
  it('names the rows in force and opens a menu of the three', async () => {
    screenIs('computer');
    renderBoth();
    const button = toolbar().getByRole('button', { name: 'Rows: Comfortable' });
    expect(button).toHaveAttribute('aria-haspopup', 'menu');
    await userEvent.setup().click(button);
    const menu = screen.getByRole('menu', { name: DENSITY_WORDS.label });
    const items = within(menu).getAllByRole('menuitemradio');
    expect(items.map((i) => i.textContent)).toEqual(['Compact', 'Comfortable', 'Detailed']);
    expect(within(menu).getByRole('menuitemradio', { name: 'Comfortable' })).toHaveAttribute('aria-checked', 'true');
    // The chosen one has the focus (the arrow keys move from there).
    expect(document.activeElement).toBe(within(menu).getByRole('menuitemradio', { name: 'Comfortable' }));
  });

  it('picks Compact or Detailed: shown at once, saved on the account, and Settings says the same', async () => {
    screenIs('computer');
    renderBoth();
    const user = userEvent.setup();
    const group = screen.getByRole('group', { name: DENSITY_WORDS.label });
    await user.click(toolbar().getByRole('button', { name: 'Rows: Comfortable' }));
    await user.click(screen.getByRole('menuitemradio', { name: 'Detailed' }));
    expect(html()).toBe('detailed');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(toolbar().getByRole('button', { name: 'Rows: Detailed' })).toBeInTheDocument();
    expect(within(group).getByRole('button', { name: 'Detailed' })).toHaveAttribute('aria-pressed', 'true');
    await waitFor(() => expect(saved).toEqual([{ density: 'detailed' }]));
    await user.click(toolbar().getByRole('button', { name: 'Rows: Detailed' }));
    await user.click(screen.getByRole('menuitemradio', { name: 'Compact' }));
    expect(html()).toBe('compact');
    await waitFor(() => expect(saved).toEqual([{ density: 'detailed' }, { density: 'compact' }]));
    // …and Settings back to comfortable: the button follows.
    await user.click(within(group).getByRole('button', { name: 'Comfortable' }));
    expect(toolbar().getByRole('button', { name: 'Rows: Comfortable' })).toBeInTheDocument();
  });

  // Browser check (1.24, phone 375): the menu's rows came out 36px on a touch screen — a plain
  // `min-h-11` loses to index.css's coarse-pointer `button:not([role='switch'])` floor; TOUCH_TALL wins.
  it('each choice is 44px tall on a touch screen (TOUCH_TALL, which outranks the 32px floor)', async () => {
    screenIs('phone');
    renderBoth();
    await userEvent.setup().click(toolbar().getByRole('button', { name: /^Rows: Comfortable/ }));
    const items = within(screen.getByRole('menu', { name: DENSITY_WORDS.label })).getAllByRole('menuitemradio');
    expect(items).toHaveLength(3);
    for (const item of items) expect(item.className).toContain(TOUCH_TALL);
  });

  it('the keyboard: arrows move, Escape closes back to the button', async () => {
    screenIs('computer');
    renderBoth();
    const user = userEvent.setup();
    const button = toolbar().getByRole('button', { name: 'Rows: Comfortable' });
    await user.click(button);
    await user.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(screen.getByRole('menuitemradio', { name: 'Detailed' }));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(button);
    expect(saved).toEqual([]);
  });

  it('a refused save says so beside the button, and the rows stay as they were', async () => {
    screenIs('computer');
    renderBoth();
    failSave = true;
    const user = userEvent.setup();
    await user.click(toolbar().getByRole('button', { name: 'Rows: Comfortable' }));
    await user.click(screen.getByRole('menuitemradio', { name: 'Compact' }));
    const alert = await toolbar().findByRole('alert');
    expect(alert).toHaveTextContent(DENSITY_WORDS.failed);
    // Under the button, out of the toolbar's flow: a toolbar that doesn't wrap never widens the page.
    expect(alert).toHaveClass('absolute', 'whitespace-nowrap');
    expect(html()).toBe('comfortable');
  });

  it('is on phones and touch screens too (Detailed applies there); Compact says it is for computers', async () => {
    screenIs('phone');
    renderBoth();
    const button = toolbar().getByRole('button', { name: 'Rows: Comfortable' });
    expect(button.closest('[data-density-button]')?.className ?? '').not.toMatch(/hidden/);
    await userEvent.setup().click(button);
    expect(screen.getByRole('menuitemradio', { name: /Compact/ })).toHaveTextContent(DENSITY_WORDS.computersOnly);
  });

  it('on a phone, a person who chose Compact sees what applies there: Comfortable rows, Compact still ticked', async () => {
    screenIs('phone');
    prefs.density = 'compact';
    renderBoth();
    await waitFor(() => expect(toolbar().getByRole('button', { name: 'Rows: Compact (comfortable on this screen)' })).toBeInTheDocument());
  });
});

describe('Settings → Appearance: Compact | Comfortable | Detailed', () => {
  it('sits next to Theme with its plain hint; comfortable at first', async () => {
    screenIs('computer');
    renderBoth();
    const group = screen.getByRole('group', { name: DENSITY_WORDS.label });
    expect(within(group).getAllByRole('button').map((b) => b.textContent)).toEqual(['Compact', 'Comfortable', 'Detailed']);
    expect(within(group).getByRole('button', { name: 'Comfortable' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(group).getByRole('button', { name: 'Compact' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByText(DENSITY_WORDS.hint)).toBeInTheDocument();
    expect(screen.queryByText(DENSITY_WORDS.phones)).toBeNull();
  });

  it('the account’s compact or detailed shows as chosen once it arrives', async () => {
    screenIs('computer');
    prefs.density = 'detailed';
    renderBoth();
    const group = screen.getByRole('group', { name: DENSITY_WORDS.label });
    await waitFor(() => expect(within(group).getByRole('button', { name: 'Detailed' })).toHaveAttribute('aria-pressed', 'true'));
    expect(html()).toBe('detailed');
  });

  it('on a phone or touch screen it is still there, and says compact becomes comfortable there', async () => {
    screenIs('phone');
    renderBoth();
    expect(screen.getByRole('group', { name: DENSITY_WORDS.label })).toBeInTheDocument();
    expect(screen.getByText(DENSITY_WORDS.phones)).toBeInTheDocument();
  });

  it('a refused save says so in Settings', async () => {
    screenIs('computer');
    renderBoth();
    failSave = true;
    await userEvent.setup().click(within(screen.getByRole('group', { name: DENSITY_WORDS.label })).getByRole('button', { name: 'Detailed' }));
    const alerts = await screen.findAllByRole('alert');
    expect(alerts.map((a) => a.textContent)).toContain(DENSITY_WORDS.failed);
    expect(html()).toBe('comfortable');
  });
});
