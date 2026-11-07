import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { useAuthStore } from '../../stores/auth-store';
import { initAppearance, useAppearanceStore, useAppearanceSync } from '../../lib/appearance';
import { ColumnWidthButton, ColumnWidthSetting, COLUMN_WIDTH_WORDS, SidebarSetting, SIDEBAR_WORDS } from './ColumnWidthButton';
import { KanbanColumn } from '../KanbanColumn';
import { DndContext } from '@dnd-kit/core';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
let prefs: Record<string, unknown>;
let saved: unknown[];
let failSave: boolean;
const attr = (n: string) => document.documentElement.getAttribute(n);

beforeEach(() => {
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
  useAuthStore.getState().setSession({ user: { id: 'me', email: 'me@x', username: 'me', roles: ['EMPLOYEE'] }, accessToken: 'at', refreshToken: 'rt' });
  initAppearance();
});
afterEach(() => {
  vi.unstubAllGlobals();
  useAuthStore.setState({ user: null, accessToken: null, refreshToken: null, isAuthenticated: false });
  useAppearanceStore.getState().set({ sidebarCollapsed: false, boardColumnWidth: 'normal' });
});

function Sync() {
  useAppearanceSync();
  return null;
}
const renderAll = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>
      <Sync />
      <ColumnWidthSetting />
      <SidebarSetting />
      <div data-testid="toolbar">
        <ColumnWidthButton />
      </div>
    </QueryClientProvider>,
  );

describe('board column width — Narrow · Normal · Wide, each person’s own (1.23.8)', () => {
  it('the board’s button names the width and opens a menu of the three', async () => {
    renderAll();
    const button = within(screen.getByTestId('toolbar')).getByRole('button', { name: 'Column width: Normal' });
    await userEvent.setup().click(button);
    const menu = screen.getByRole('menu', { name: COLUMN_WIDTH_WORDS.label });
    expect(within(menu).getAllByRole('menuitemradio').map((i) => i.textContent)).toEqual(['Narrow', 'Normal', 'Wide']);
    expect(within(menu).getByRole('menuitemradio', { name: 'Normal' })).toHaveAttribute('aria-checked', 'true');
  });

  it('a pick changes every column at once and is saved on the account; Settings says the same', async () => {
    renderAll();
    const user = userEvent.setup();
    await user.click(within(screen.getByTestId('toolbar')).getByRole('button', { name: 'Column width: Normal' }));
    await user.click(screen.getByRole('menuitemradio', { name: 'Wide' }));
    expect(attr('data-board-width')).toBe('wide');
    expect(within(screen.getByRole('group', { name: COLUMN_WIDTH_WORDS.label })).getByRole('button', { name: 'Wide' })).toHaveAttribute('aria-pressed', 'true');
    await waitFor(() => expect(saved).toEqual([{ boardColumnWidth: 'wide' }]));
    await user.click(within(screen.getByRole('group', { name: COLUMN_WIDTH_WORDS.label })).getByRole('button', { name: 'Narrow' }));
    expect(attr('data-board-width')).toBe('narrow');
    expect(within(screen.getByTestId('toolbar')).getByRole('button', { name: 'Column width: Narrow' })).toBeInTheDocument();
    await waitFor(() => expect(saved).toEqual([{ boardColumnWidth: 'wide' }, { boardColumnWidth: 'narrow' }]));
  });

  it('a refused save says so and puts the columns back', async () => {
    renderAll();
    failSave = true;
    const user = userEvent.setup();
    await user.click(within(screen.getByTestId('toolbar')).getByRole('button', { name: 'Column width: Normal' }));
    await user.click(screen.getByRole('menuitemradio', { name: 'Narrow' }));
    expect(await within(screen.getByTestId('toolbar')).findByRole('alert')).toHaveTextContent(COLUMN_WIDTH_WORDS.failed);
    expect(attr('data-board-width')).toBe('normal');
  });

  it('the widths: Normal is today’s 15rem; a column is at least that wide and shares any room left', () => {
    const css = readFileSync(resolve(__dirname, '../../index.css'), 'utf8');
    expect(css).toMatch(/:root \{[^}]*--board-col: 15rem;/);
    expect(css).toMatch(/:root\[data-board-width='narrow'\] \{\s*--board-col: 13rem;/);
    expect(css).toMatch(/:root\[data-board-width='wide'\] \{\s*--board-col: 19\.5rem;/);
    render(
      <DndContext>
        <KanbanColumn column={{ id: 'c', name: 'To do', color: '#000', tasks: [] }} />
      </DndContext>,
    );
    const column = screen.getByRole('region', { name: 'To do' });
    expect(column).toHaveClass('min-w-[var(--board-col,15rem)]', 'flex-1');
  });
});

describe('Settings → Appearance: the side menu (1.23.8)', () => {
  it('Full or Icons only, the same as the menu’s « button, saved on the account', async () => {
    renderAll();
    const group = screen.getByRole('group', { name: SIDEBAR_WORDS.label });
    expect(within(group).getByRole('button', { name: 'Full' })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.setup().click(within(group).getByRole('button', { name: 'Icons only' }));
    expect(attr('data-sidebar')).toBe('collapsed');
    await waitFor(() => expect(saved).toEqual([{ sidebarCollapsed: true }]));
    expect(screen.getByText(SIDEBAR_WORDS.hint)).toBeInTheDocument();
  });
});
