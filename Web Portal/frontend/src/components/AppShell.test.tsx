import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AppShell } from './AppShell';
import { useAuthStore } from '../stores/auth-store';
import { useCompanyStore } from '../stores/company-store';
import type { MyCompanies, MyCompany } from '../api/companies';
import { enqueueOffline } from '../lib/offline-replay';
import { clearTaskNotice, showTaskNotice, taskCreatedNotice } from '../lib/task-notice';
import { clearQueue, getQueue, localStorageQueueStore } from '../lib/offline-queue';

// The shell opens a live-update socket: keep it off the network, or a server running on this computer
// answers it (an unknown token, a session refresh) and the test's session changes under it.
vi.mock('socket.io-client', () => ({ io: () => ({ on: vi.fn(), emit: vi.fn(), connect: vi.fn(), disconnect: vi.fn() }) }));

function renderShell(path = '/dashboard') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route element={<AppShell />}>
            <Route path="/dashboard" element={<div>Dashboard content</div>} />
            <Route path="/settings" element={<h1>Settings</h1>} />
            <Route path="/profile" element={<h1>Your profile</h1>} />
            <Route path="/about" element={<h1>About</h1>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  // The header's notifications bell polls the API; stub it so the shell renders cleanly.
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ data: { count: 0 } }), { status: 200, headers: { 'content-type': 'application/json' } })));
  useAuthStore.getState().setSession({
    user: { id: 'u1', email: 'a@b.c', username: 'ada', roles: ['ADMIN'] },
    accessToken: 'at',
    refreshToken: 'rt',
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  clearQueue(localStorageQueueStore);
  useCompanyStore.setState({ pick: null, notice: null, noticeName: null, names: {}, userId: null });
  localStorage.removeItem('mico360.u.u1.company.pick');
});

describe('AppShell', () => {
  it('renders the sidebar, the header user, and the routed content', () => {
    renderShell();
    expect(screen.getByRole('link', { name: /dashboard/i })).toBeInTheDocument();
    expect(screen.getByText('ada')).toBeInTheDocument();
    expect(screen.getByText('Dashboard content')).toBeInTheDocument();
  });

  it('the meeting reminder pop-up comes after the page in reading order (Skip to content stays first)', () => {
    const { container } = renderShell();
    const skip = screen.getByRole('link', { name: 'Skip to content' });
    const main = container.querySelector('main')!;
    const live = container.querySelector('[aria-live="polite"][data-meeting-reminders]')!;
    expect(live).not.toBeNull();
    expect(skip.compareDocumentPosition(live) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(main.compareDocumentPosition(live) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(main.contains(live)).toBe(false);
  });

  it('shows the "Task MICO-143 created" notice on every page, whatever made the task (1.22.3)', () => {
    renderShell();
    try {
      act(() => showTaskNotice(taskCreatedNotice({ id: 't1', key: 'MICO-143' })));
      const toast = screen.getByText('Task MICO-143 created').closest('[role="status"]')!;
      expect(within(toast as HTMLElement).getByRole('button', { name: 'Open MICO-143' })).toBeInTheDocument();
    } finally {
      act(() => clearTaskNotice());
    }
  });

  it('logs the user out from the profile menu', async () => {
    renderShell();
    await userEvent.click(screen.getByRole('button', { name: /account menu/i }));
    await userEvent.click(await screen.findByRole('menuitem', { name: /log out/i }));
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
  });

  it('warns about unsynced offline changes before logging out, then discards them', async () => {
    vi.stubGlobal('navigator', { ...navigator, onLine: false }); // stay offline so the shell doesn't sync them
    renderShell();
    enqueueOffline('task.move', { id: 't1', toColumnId: 'c2' });
    await userEvent.click(screen.getByRole('button', { name: /account menu/i }));
    await userEvent.click(await screen.findByRole('menuitem', { name: /log out/i }));
    expect(useAuthStore.getState().isAuthenticated).toBe(true);
    expect(screen.getByRole('alert')).toHaveTextContent(/1 change saved on this device hasn’t been sent yet/i);
    await userEvent.click(screen.getByRole('button', { name: /log out anyway/i }));
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
    expect(getQueue(localStorageQueueStore)).toHaveLength(0);
    vi.unstubAllGlobals();
  });

  it('counts inspection changes still on this device in the same warning', async () => {
    vi.stubGlobal('navigator', { ...navigator, onLine: false });
    const uid = useAuthStore.getState().user!.id;
    localStorage.setItem(`mico360.inspection.${uid}.i1`, JSON.stringify({ v: 1, ownerId: uid, inspectionId: 'i1', projectId: 'p1', title: 'Rig daily check', snapshot: { id: 'i1', projectId: 'p1', title: 'Rig daily check', status: 'IN_PROGRESS', structure: { sections: [], clientSignature: 'NONE', supervisorSignature: 'NONE' }, answers: [], revision: 0 }, answers: { a: { itemId: 'a', result: 'PASS', reading: null, note: null, editedAt: '2026-10-27T08:00:00.000Z' }, b: { itemId: 'b', result: 'FAIL', reading: null, note: null, editedAt: '2026-10-27T08:00:01.000Z' } }, finish: null, followUps: {}, problem: null, savedAt: '', sentAt: null }));
    renderShell();
    await userEvent.click(screen.getByRole('button', { name: /account menu/i }));
    await userEvent.click(await screen.findByRole('menuitem', { name: /log out/i }));
    expect(screen.getByRole('alert')).toHaveTextContent(/2 changes saved on this device haven’t been sent yet/i);
    await userEvent.click(screen.getByRole('button', { name: /log out anyway/i }));
    expect(localStorage.getItem(`mico360.inspection.${uid}.i1`)).toBeNull();
    vi.unstubAllGlobals();
  });

  describe('unread chat messages', () => {
    const answer = (url: string) => {
      const data = String(url).endsWith('/conversations')
        ? [
            { conversation: { id: 'c1', kind: 'DIRECT', projectId: null, createdAt: '' }, participants: [], unread: 2, lastMessage: null, prefs: { favorite: false, archived: false, muted: false } },
            { conversation: { id: 'c2', kind: 'PROJECT', projectId: 'p1', createdAt: '' }, participants: [], unread: 3, lastMessage: null, prefs: { favorite: false, archived: false, muted: false } },
            { conversation: { id: 'c3', kind: 'PROJECT', projectId: 'p2', createdAt: '' }, participants: [], unread: 9, lastMessage: null, prefs: { favorite: false, archived: false, muted: true } },
          ]
        : String(url).includes('/notifications') ? { count: 0 } : [];
      return new Response(JSON.stringify({ data }), { status: 200, headers: { 'content-type': 'application/json' } });
    };

    it('shows the total on the sidebar’s Chat link (muted conversations left out)', async () => {
      vi.stubGlobal('fetch', vi.fn(async (url: string) => answer(url)));
      renderShell();
      const chat = await screen.findByRole('link', { name: 'Chat, 5 unread messages' });
      expect(chat.querySelector('[data-chat-badge]')).toHaveTextContent('5');
    });

    it('marks the phone’s menu button, which hides the sidebar, and shows the count inside the menu', async () => {
      vi.stubGlobal('fetch', vi.fn(async (url: string) => answer(url)));
      renderShell();
      const opener = await screen.findByRole('button', { name: 'Open menu, 5 unread chat messages' });
      expect(opener.querySelector('[data-chat-dot]')).not.toBeNull();
      await userEvent.click(opener);
      const menu = screen.getByRole('dialog', { name: 'Menu' });
      expect(menu.querySelector('a[href="/chat"]')).toHaveAccessibleName('Chat, 5 unread messages');
    });

    it('shows nothing when every message is read', async () => {
      renderShell();
      expect(await screen.findByRole('button', { name: 'Open menu' })).toBeInTheDocument();
      expect(document.querySelector('[data-chat-badge]')).toBeNull();
      expect(document.querySelector('[data-chat-dot]')).toBeNull();
    });
  });

  describe('phone menu', () => {
    it('opens as a dialog with focus inside it, and closes with Escape', async () => {
      renderShell();
      expect(screen.queryByRole('dialog', { name: 'Menu' })).not.toBeInTheDocument();
      const opener = screen.getByRole('button', { name: 'Open menu' });
      await userEvent.click(opener);
      const menu = screen.getByRole('dialog', { name: 'Menu' });
      expect(menu).toHaveAttribute('aria-modal', 'true');
      expect(menu.contains(document.activeElement)).toBe(true);

      await userEvent.keyboard('{Escape}');
      expect(screen.queryByRole('dialog', { name: 'Menu' })).not.toBeInTheDocument();
      expect(opener).toHaveFocus();
    });

    it('has a Close button, and closes when a page is chosen', async () => {
      renderShell();
      await userEvent.click(screen.getByRole('button', { name: 'Open menu' }));
      await userEvent.click(screen.getByRole('button', { name: 'Close menu' }));
      expect(screen.queryByRole('dialog', { name: 'Menu' })).not.toBeInTheDocument();

      await userEvent.click(screen.getByRole('button', { name: 'Open menu' }));
      const menu = screen.getByRole('dialog', { name: 'Menu' });
      await userEvent.click(menu.querySelector('a[href="/dashboard"]')!);
      expect(screen.queryByRole('dialog', { name: 'Menu' })).not.toBeInTheDocument();
    });
  });

  describe('companies', () => {
    const hours = { days: [0, 1, 2, 3, 4], start: '08:00', end: '17:00' };
    const company = (id: string, name: string, logoUrl: string | null = null): MyCompany => ({ id, name, code: id.slice(2, 5).toUpperCase(), logoUrl, timeZone: 'Asia/Muscat', weekStart: 0, workingHours: hours });
    const alpha = company('c-alpha', 'Alpha Co');
    const beta = company('c-beta', 'Beta Co', '/uploads/beta-logo.png');
    const user = userEvent.setup();

    /** The shell with this answer to GET /me/companies (everything else: nothing to show). */
    function renderCompanyShell(mine: Partial<MyCompanies>, path = '/dashboard') {
      const answer: MyCompanies = { companies: [], primaryCompanyId: null, allArchived: false, siteCompanyCount: 1, ...mine };
      vi.stubGlobal('fetch', vi.fn(async (url: string) => {
        const data = String(url).endsWith('/me/companies') ? answer : { count: 0 };
        return new Response(JSON.stringify({ data }), { status: 200, headers: { 'content-type': 'application/json' } });
      }));
      return renderShell(path);
    }
    /** Wait until the shell has read my companies (their names arrive with them). */
    const companiesRead = (companies: MyCompany[]) =>
      waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).endsWith('/me/companies'))).toBe(true)).then(() =>
        waitFor(() => expect(useCompanyStore.getState().names).toEqual(Object.fromEntries(companies.map((c) => [c.id, c.name])))),
      );
    /** A window this wide (CSS pixels): media queries answer as a browser that size would. */
    function setWidth(px: number) {
      vi.stubGlobal('matchMedia', (query: string) => {
        const min = /min-width:\s*([\d.]+)(em|px)/.exec(query);
        const max = /max-width:\s*([\d.]+)(em|px)/.exec(query);
        const size = (m: RegExpExecArray) => Number(m[1]) * (m[2] === 'em' ? 16 : 1);
        const matches = (min !== null || max !== null) && (!min || px >= size(min)) && (!max || px <= size(max));
        return { matches, media: query, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {} } as unknown as MediaQueryList;
      });
    }

    beforeEach(() => {
      useAuthStore.getState().setSession({ user: { id: 'u1', email: 'a@b.c', username: 'ada', roles: [] }, accessToken: 'at', refreshToken: 'rt' });
      useCompanyStore.setState({ pick: null, notice: null, noticeName: null, names: {}, userId: 'u1' });
    });

    it('one company: no picker at all', async () => {
      renderCompanyShell({ companies: [alpha] });
      await companiesRead([alpha]);
      expect(document.querySelector('[data-company-picker]')).toBeNull();
      expect(screen.queryByRole('button', { name: /^Company:/ })).toBeNull();
      expect(document.querySelector('[data-company-notice]')).toBeNull();
      expect(screen.getByText('Dashboard content')).toBeInTheDocument();
    });

    it('two companies: "Company: All my companies", a menu with All first, then A–Z', async () => {
      renderCompanyShell({ companies: [beta, alpha], siteCompanyCount: 2 });
      const btn = await screen.findByRole('button', { name: 'Company: All my companies' });
      expect(btn).toHaveAttribute('data-company-picker');
      await user.click(btn);
      expect(screen.getAllByRole('menuitemradio').map((o) => o.textContent)).toEqual(['All my companies', 'Alpha Co', 'Beta Co']);
      await user.keyboard('{ArrowDown}{ArrowDown}{Enter}');
      expect(useCompanyStore.getState().pick).toBe(beta.id);
      expect(localStorage.getItem('mico360.u.u1.company.pick')).toBe(beta.id);
      expect(screen.getByRole('button', { name: 'Company: Beta Co' })).toBeInTheDocument();
      expect(screen.queryByRole('menu')).toBeNull();
    });

    it('sits in the top bar right after the search box', async () => {
      renderCompanyShell({ companies: [alpha, beta], siteCompanyCount: 2 });
      const btn = await screen.findByRole('button', { name: 'Company: All my companies' });
      const header = document.querySelector('[data-app-header]')!;
      expect(header.contains(btn)).toBe(true);
      const search = header.querySelector('input')!;
      expect(search.compareDocumentPosition(btn) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(btn.compareDocumentPosition(screen.getByRole('button', { name: /account menu/i })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('Escape closes it and keeps the pick', async () => {
      useCompanyStore.setState({ pick: alpha.id });
      renderCompanyShell({ companies: [alpha, beta], siteCompanyCount: 2 });
      const btn = await screen.findByRole('button', { name: 'Company: Alpha Co' });
      await user.click(btn);
      expect(screen.getByRole('menu')).toBeInTheDocument();
      await user.keyboard('{ArrowDown}{Escape}');
      expect(screen.queryByRole('menu')).toBeNull();
      expect(useCompanyStore.getState().pick).toBe(alpha.id);
      expect(btn).toHaveFocus();
    });

    it('the stale-pick notice says which company and can be dismissed', async () => {
      renderCompanyShell({ companies: [alpha, beta], siteCompanyCount: 2 });
      await companiesRead([alpha, beta]);
      act(() => {
        useCompanyStore.getState().setNames({ [beta.id]: 'Beta Co' });
        useCompanyStore.getState().setPick('u1', beta.id);
        useCompanyStore.getState().companyGone();
      });
      expect(useCompanyStore.getState().pick).toBeNull();
      // The shell has another live region (the shortcuts' toast): this is the one with the notice.
      const status = screen.getAllByRole('status').find((el) => el.hasAttribute('data-company-notice'))!;
      expect(status).toBeDefined();
      expect(status).toHaveTextContent('You no longer have access to Beta Co. Showing all your companies.');
      // The company's name is text someone typed: it keeps its own direction.
      expect(status.querySelector('bdi')).toHaveTextContent('Beta Co');
      // Above the page, not inside it.
      expect(document.querySelector('main')!.contains(status)).toBe(false);
      await user.click(screen.getByRole('button', { name: 'Dismiss' }));
      expect(document.querySelector('[data-company-notice]')).toBeNull();
      expect(screen.queryByText(/You no longer have access/)).toBeNull();
    });

    it('all companies archived: one card, Settings still opens', async () => {
      const { unmount } = renderCompanyShell({ allArchived: true, companies: [] }, '/dashboard');
      expect(await screen.findByText('Your company is archived — ask an administrator.')).toBeInTheDocument();
      expect(screen.queryByText('Dashboard content')).toBeNull();
      expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
      // The menu stays.
      expect(screen.getByRole('link', { name: /dashboard/i })).toBeInTheDocument();
      unmount();
      renderCompanyShell({ allArchived: true }, '/settings');
      expect(await screen.findByRole('heading', { name: 'Settings' })).toBeInTheDocument();
      await companiesRead([]);
      expect(screen.queryByText('Your company is archived — ask an administrator.')).toBeNull();
    });

    it('all companies archived: Profile and About open too', async () => {
      const { unmount } = renderCompanyShell({ allArchived: true }, '/profile');
      await companiesRead([]);
      expect(screen.getByRole('heading', { name: 'Your profile' })).toBeInTheDocument();
      expect(screen.queryByText('Your company is archived — ask an administrator.')).toBeNull();
      unmount();
      renderCompanyShell({ allArchived: true }, '/about');
      await companiesRead([]);
      expect(screen.getByRole('heading', { name: 'About' })).toBeInTheDocument();
      expect(screen.queryByText('Your company is archived — ask an administrator.')).toBeNull();
    });

    it('on a phone the button keeps its name with only the logo', async () => {
      setWidth(375);
      renderCompanyShell({ companies: [alpha, beta], siteCompanyCount: 2 });
      const btn = await screen.findByRole('button', { name: 'Company: All my companies' });
      expect(btn).not.toHaveTextContent('All my companies');
    });

    it('on the smallest phones (< 360px) it moves from the top bar into the menu, with its name', async () => {
      setWidth(320);
      renderCompanyShell({ companies: [alpha, beta], siteCompanyCount: 2 });
      const inBar = await screen.findByRole('button', { name: 'Company: All my companies' });
      // The top bar has no room for it beside the menu button, the search box, New task, the bell
      // and the account button: hidden there below 22.5em, shown in the menu instead (and only there).
      expect(inBar.closest('[data-company-picker-place="bar"]')!.className).toContain('hidden');
      expect(inBar.closest('[data-company-picker-place="bar"]')!.className).toContain('[@media(min-width:22.5em)]:block');
      await user.click(screen.getByRole('button', { name: 'Open menu' }));
      const menu = screen.getByRole('dialog', { name: 'Menu' });
      const inMenu = within(menu).getByRole('button', { name: 'Company: All my companies' });
      expect(inMenu).toHaveTextContent('All my companies');
      expect(inMenu.closest('[data-company-picker-place="menu"]')!.className).toContain('[@media(min-width:22.5em)]:hidden');
      await user.click(inMenu);
      await user.click(within(menu).getByRole('menuitemradio', { name: 'Beta Co' }));
      expect(useCompanyStore.getState().pick).toBe(beta.id);
    });

    it('on a laptop the search box keeps its room: only the logo, its name on hover', async () => {
      setWidth(1280);
      useCompanyStore.setState({ pick: beta.id });
      renderCompanyShell({ companies: [alpha, beta], siteCompanyCount: 2 });
      const btn = await screen.findByRole('button', { name: 'Company: Beta Co' });
      expect(btn).not.toHaveTextContent('Beta Co');
      expect(btn).toHaveAttribute('title', 'Beta Co');
      expect(btn.querySelector('img')?.getAttribute('src')).toMatch(/\/uploads\/beta-logo\.png$/);
    });

    it('on a laptop a company without a logo shows its short code beside the building, so two such companies differ', async () => {
      setWidth(1280);
      useCompanyStore.setState({ pick: alpha.id });
      renderCompanyShell({ companies: [alpha, beta], siteCompanyCount: 2 });
      const btn = await screen.findByRole('button', { name: 'Company: Alpha Co' });
      expect(btn).toHaveTextContent(alpha.code);
      expect(btn).not.toHaveTextContent('Alpha Co');
      // "All my companies" keeps its own icon, and a company with a logo its logo alone.
      act(() => useCompanyStore.getState().setPick('u1', beta.id));
      expect(screen.getByRole('button', { name: 'Company: Beta Co' })).not.toHaveTextContent(beta.code);
    });

    it('on a wide screen the button shows the picked company’s logo and name', async () => {
      setWidth(1600);
      useCompanyStore.setState({ pick: beta.id });
      renderCompanyShell({ companies: [alpha, beta], siteCompanyCount: 2 });
      const btn = await screen.findByRole('button', { name: 'Company: Beta Co' });
      expect(btn).toHaveTextContent('Beta Co');
      expect(btn.querySelector('img')?.getAttribute('src')).toMatch(/\/uploads\/beta-logo\.png$/);
    });
  });
});

