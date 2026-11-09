import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useState } from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PREVIEW_ONLY, type ClientPreviewSpec } from '../../api/portal';
import { useAuthStore } from '../../stores/auth-store';
import { card, home, meetingItem, noticeSettings, notices, portalFile, projectView, taskView } from '../../pages/portal/portal-fixtures';
import { ClientPreviewDialog } from './ClientPreviewDialog';

/** The matrix on screen: a client not saved yet, Viewer on one project and Contributor on another. */
const SPEC: ClientPreviewSpec = {
  clientId: null,
  firstName: 'Huda',
  lastName: 'Client',
  organisation: 'Gulf Builders',
  email: 'huda@client.test',
  projects: [
    { projectId: 'p1', role: 'CONTRIBUTOR', modules: { progress: true, meetings: true }, actions: { comment: true, signOff: false, respond: true, download: true, upload: true, notify: true } },
  ],
};

type Call = { method: string; path: string; body: unknown };
let calls: Call[] = [];

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** What the server's preview routes answer (POST /clients/preview/…), as the portal's own would. */
function previewAnswer(path: string): unknown {
  switch (path) {
    case '/clients/preview/me':
      return home([card(), card({ id: 'p2', code: 'RIG', name: 'Rig survey', company: null })]);
    case '/clients/preview/projects/p1':
      return projectView();
    case '/clients/preview/projects/p1/tasks/t2':
      return taskView({ files: [portalFile()], can: { comment: true, signOff: true, upload: true } });
    case '/clients/preview/projects/p1/meetings':
      return [meetingItem()];
    case '/clients/preview/notifications':
      return notices();
    case '/clients/preview/settings':
      return noticeSettings();
    default:
      return undefined;
  }
}

beforeEach(() => {
  calls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const path = String(url).replace(/^.*\/api\/v1/, '');
      calls.push({ method: init?.method ?? 'GET', path, body: typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body });
      const data = previewAnswer(path);
      return data === undefined ? json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, 404) : json({ data, meta: { preview: true } });
    }),
  );
  useAuthStore.getState().setSession({ user: { id: 'a1', email: 'admin@mico.test', username: 'admin', roles: ['ADMIN'] }, accessToken: 'at', refreshToken: 'rt' });
});
afterEach(() => {
  vi.unstubAllGlobals();
  document.body.style.overflow = '';
});

/** Where the page behind the preview is. */
function OuterWhere() {
  return <div data-testid="outer-where">{useLocation().pathname}</div>;
}

/** The admin's page: a button that opens the preview (as the Clients page and the matrix do). */
function AdminPage({ spec }: { spec: ClientPreviewSpec }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open the preview
      </button>
      {open ? <ClientPreviewDialog spec={spec} onClose={() => setOpen(false)} /> : null}
      <OuterWhere />
    </>
  );
}

function renderAdminPage(spec: ClientPreviewSpec = SPEC) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  // The admin's page is a route of its own (no trailing *), as /admin/clients is in App.tsx.
  const ui = (s: ClientPreviewSpec) => (
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/admin/clients']}>
        <Routes>
          <Route path="/admin/clients" element={<AdminPage spec={s} />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
  const view = render(ui(spec));
  return { ...view, qc, rerenderWith: (s: ClientPreviewSpec) => view.rerender(ui(s)) };
}

async function openPreview() {
  await userEvent.click(screen.getByRole('button', { name: 'Open the preview' }));
  return screen.findByRole('dialog', { name: 'Preview as client' });
}

describe('1.23.7 Preview as client (the dialog)', () => {
  it('opens full-screen, focus inside, the page behind it still; the portal reads through the preview routes with the matrix', async () => {
    const { qc } = renderAdminPage();
    const dialog = await openPreview();
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
    expect(document.body.style.overflow).toBe('hidden');
    expect(within(dialog).getByText('Huda Client · Gulf Builders')).toBeInTheDocument();
    expect(await within(dialog).findByText(PREVIEW_ONLY)).toBeInTheDocument();
    expect(await within(dialog).findByRole('heading', { level: 1, name: 'Your projects' })).toBeInTheDocument();
    expect(within(dialog).getByRole('link', { name: /Rig survey/ })).toBeInTheDocument();
    expect(calls.length).toBeGreaterThan(0);
    for (const c of calls) {
      expect(c.method).toBe('POST');
      expect(c.path).toMatch(/^\/clients\/preview\//);
      expect(c.body).toEqual(SPEC);
    }
    // Its own cache: nothing it read lands in the admin page's.
    expect(qc.getQueryCache().findAll({ queryKey: ['portal'] })).toEqual([]);
  });

  it('its links move the preview only — never the page behind it — and nothing it shows writes', async () => {
    renderAdminPage();
    const dialog = await openPreview();
    await userEvent.click(await within(dialog).findByRole('link', { name: /Office fit-out/ }));
    expect(await within(dialog).findByRole('heading', { level: 1, name: 'Office fit-out' })).toBeInTheDocument();
    await userEvent.click(await within(dialog).findByRole('link', { name: /Paint the walls/ }));
    expect(await within(dialog).findByRole('heading', { level: 2, name: 'Paint the walls' })).toBeInTheDocument();
    expect(screen.getByTestId('outer-where')).toHaveTextContent(/^\/admin\/clients$/);
    // Every action is there, switched off; pressing them sends nothing.
    for (const name of ['Accept', 'Send back', 'Send comment', 'Download Site plan.pdf', 'Change password', 'Sign out']) {
      const button = within(dialog).getByRole('button', { name });
      expect(button, name).toBeDisabled();
      await userEvent.click(button);
    }
    expect(within(dialog).getByLabelText('Upload a document')).toBeDisabled();
    await userEvent.click(within(dialog).getByRole('link', { name: /^Notifications/ }));
    expect(await within(dialog).findByText('No notifications yet.')).toBeInTheDocument();
    expect(screen.getByTestId('outer-where')).toHaveTextContent(/^\/admin\/clients$/);
    for (const c of calls) expect(`${c.method} ${c.path}`).toMatch(/^POST \/clients\/preview\//);
    expect(useAuthStore.getState().isAuthenticated).toBe(true);
  });

  it('Escape closes it, focus goes back to the button that opened it, and the page scrolls again', async () => {
    renderAdminPage();
    const opener = screen.getByRole('button', { name: 'Open the preview' });
    await openPreview();
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(opener).toHaveFocus();
    expect(document.body.style.overflow).toBe('');
  });

  it('Close preview closes it too', async () => {
    renderAdminPage();
    const dialog = await openPreview();
    await within(dialog).findByRole('heading', { level: 1, name: 'Your projects' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Close preview' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByRole('button', { name: 'Open the preview' })).toHaveFocus();
  });

  it('a changed matrix is read again; the same matrix again is not', async () => {
    const view = renderAdminPage();
    const dialog = await openPreview();
    await within(dialog).findByRole('heading', { level: 1, name: 'Your projects' });
    const homeReads = () => calls.filter((c) => c.path === '/clients/preview/me');
    expect(homeReads()).toHaveLength(1);
    view.rerenderWith({ ...SPEC });
    await new Promise((r) => setTimeout(r, 20));
    expect(homeReads()).toHaveLength(1);
    const viewer: ClientPreviewSpec = { ...SPEC, projects: [{ ...SPEC.projects![0]!, role: 'VIEWER' }] };
    view.rerenderWith(viewer);
    await waitFor(() => expect(homeReads()).toHaveLength(2));
    expect(homeReads()[1]!.body).toEqual(viewer);
  });

  it('a client not saved yet, without a name, is said so', async () => {
    renderAdminPage({ projects: SPEC.projects });
    const dialog = await openPreview();
    expect(within(dialog).getByText('A new client (not saved yet)')).toBeInTheDocument();
  });
});
