import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BoardPeople } from './BoardPeople';
import { useAuthStore } from '../../stores/auth-store';
import type { ApiProject } from '../../api/projects';

// 1.22: the board's "who has access" — a row of faces, and the full list behind it.
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

const project = (over: Partial<ApiProject> = {}): ApiProject =>
  ({ id: 'p1', code: 'MICO', name: 'MICO360 Platform', description: null, clientName: null, status: 'ACTIVE', priority: 'HIGH', color: '#8B1E1E', imageUrl: null, ownerId: 'own', managerId: 'pm', startDate: null, targetDate: null, createdAt: '', updatedAt: '', canManage: false, ...over }) as ApiProject;

const names = ['Adam', 'Bina', 'Chen', 'Dana', 'Eli', 'Farah', 'Gita', 'Hadi', 'Ivan', 'Jude'];
let members: unknown[];
let directory: unknown[];

beforeEach(() => {
  members = [
    ...names.map((n, i) => ({ id: `m${i}`, username: n.toLowerCase(), email: `${n}@x`, firstName: n, lastName: 'Team', role: 'MEMBER' })),
    { id: 'out', username: 'omar', email: 'o@x', firstName: 'Omar', lastName: 'Away', role: 'MEMBER', hasAccess: false },
  ];
  directory = [
    { id: 'own', username: 'olivia', firstName: 'Olivia', lastName: 'Owner', avatarUrl: null },
    { id: 'pm', username: 'paul', firstName: 'Paul', lastName: 'Manager', avatarUrl: null },
  ];
  useAuthStore.getState().setSession({ user: { id: 'm0', email: 'a@x', username: 'adam', roles: ['EMPLOYEE'] }, accessToken: 'at', refreshToken: 'rt' });
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const u = String(url);
    if (u.endsWith('/projects/p1/members')) return json({ data: members });
    if (u.endsWith('/users/directory')) return json({ data: directory });
    return json({ data: [] });
  }));
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function renderRow(p: ApiProject = project()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <BoardPeople project={p} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
const phone = (on: boolean) =>
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: on && query.includes('max-width'), media: query, addEventListener: () => {}, removeEventListener: () => {} }));

describe('BoardPeople — the board’s face row', () => {
  it('shows up to eight faces, then “+N”, and says how many people can open the board', async () => {
    phone(false);
    renderRow();
    // Owner + named manager + ten team members; Omar (no access any more) is left out.
    const row = await screen.findByRole('button', { name: 'People on this project: 12' });
    expect(row.querySelectorAll('[data-face]')).toHaveLength(8);
    expect(within(row).getByText('+4')).toBeInTheDocument();
  });

  it('on a phone, three faces then “+N”', async () => {
    phone(true);
    renderRow();
    const row = await screen.findByRole('button', { name: 'People on this project: 12' });
    expect(row.querySelectorAll('[data-face]')).toHaveLength(3);
    expect(within(row).getByText('+9')).toBeInTheDocument();
  });

  it('opens the full list: each person with face, name and role, and who else can open it', async () => {
    renderRow();
    await userEvent.click(await screen.findByRole('button', { name: 'People on this project: 12' }));
    const panel = screen.getByRole('dialog', { name: 'People on this project' });
    const items = within(panel).getAllByRole('listitem');
    expect(items).toHaveLength(12);
    expect(items[0]).toHaveTextContent('Olivia Owner');
    expect(items[0]).toHaveTextContent('Owner');
    expect(items[1]).toHaveTextContent('Paul Manager');
    expect(items[1]).toHaveTextContent('Manager');
    expect(items[2]).toHaveTextContent('Adam Team');
    expect(items[2]).toHaveTextContent('Member');
    expect(within(panel).queryByText(/Omar/)).not.toBeInTheDocument();
    expect(within(panel).getByText('Administrators can open every board.')).toBeInTheDocument();
    // A team member doesn't run the team: no "Manage team".
    expect(within(panel).queryByRole('link', { name: 'Manage team' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'People on this project: 12' })).toHaveAttribute('aria-expanded', 'true');
  });

  // 1.22 QA: a long team scrolls inside the panel, and Tab never reached it (axe: scrollable-region-focusable).
  it('a long list scrolls from the keyboard: Tab reaches it', async () => {
    renderRow();
    await userEvent.click(await screen.findByRole('button', { name: 'People on this project: 12' }));
    const list = within(screen.getByRole('dialog', { name: 'People on this project' })).getByRole('list', { name: 'People' });
    expect(list).toHaveAttribute('tabindex', '0');
  });

  it('those who run the project, and administrators, get “Manage team” — the project’s Team tab', async () => {
    renderRow(project({ canManage: true }));
    await userEvent.click(await screen.findByRole('button', { name: /People on this project/ }));
    expect(screen.getByRole('link', { name: 'Manage team' })).toHaveAttribute('href', '/projects/p1?tab=team');
  });

  it('an administrator gets “Manage team” on any board', async () => {
    useAuthStore.getState().setSession({ user: { id: 'admin', email: 'ad@x', username: 'admin', roles: ['ADMIN'] }, accessToken: 'at', refreshToken: 'rt' });
    renderRow();
    await userEvent.click(await screen.findByRole('button', { name: /People on this project/ }));
    expect(screen.getByRole('link', { name: 'Manage team' })).toBeInTheDocument();
  });

  it('Escape closes the list, back to the row', async () => {
    renderRow();
    const row = await screen.findByRole('button', { name: /People on this project/ });
    await userEvent.click(row);
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'People on this project' })).not.toBeInTheDocument();
    expect(row).toHaveFocus();
  });
});
