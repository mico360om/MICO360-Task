import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BackupSettings } from './BackupSettings';
import type { BackupOverview } from '../../api/backups';
import { useAuthStore } from '../../stores/auth-store';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const COPY = (over: Partial<BackupOverview['copies'][number]>): BackupOverview['copies'][number] => ({
  id: 'c1',
  fileName: 'mico360-tasks-backup-2026-10-30-0201-aaaaaa.tar.gz',
  createdAt: '2026-10-29T22:01:00.000Z',
  sizeBytes: 24 * 1024 * 1024,
  kind: 'nightly',
  trigger: 'NIGHTLY',
  encrypted: false,
  drive: null,
  driveError: null,
  ...over,
});

function overview(over: Partial<BackupOverview> = {}): BackupOverview {
  return {
    folder: '/home/u/mico360-data/backups',
    folderWarning: null,
    encrypted: false,
    nightly: { enabled: true, hour: 2, timeZone: 'Asia/Muscat' },
    running: null,
    lastSuccess: { at: '2026-10-29T22:01:00.000Z', sizeBytes: 24 * 1024 * 1024 },
    warning: null,
    copies: [COPY({}), COPY({ id: 'c2', createdAt: '2026-10-16T22:01:00.000Z', kind: 'weekly', sizeBytes: 20 * 1024 * 1024 })],
    drive: { configured: true, connected: false, stored: false, email: null, connectedAt: null, problem: null, warning: null },
    ...over,
  };
}

let current: BackupOverview;
let requests: { method: string; url: string }[];

beforeEach(() => {
  current = overview();
  requests = [];
  useAuthStore.getState().setSession({ user: { id: 'a1', email: 'a@b.c', username: 'admin', roles: ['ADMIN'] }, accessToken: 'at', refreshToken: 'rt' });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url).replace(/^.*\/api\/v1/, '');
      const method = init?.method ?? 'GET';
      requests.push({ method, url: u });
      if (method === 'GET' && u === '/backups') return json({ data: current });
      if (method === 'POST' && u === '/backups') {
        current = { ...current, running: { id: 'r9', trigger: 'MANUAL', startedAt: '2026-10-30T06:00:00.000Z' } };
        return json({ data: { id: 'r9', status: 'RUNNING', trigger: 'MANUAL', startedAt: '2026-10-30T06:00:00.000Z' } }, 202);
      }
      if (method === 'POST' && u === '/backups/c1/download-link') return json({ data: { url: '/api/v1/backups/download?token=abc' } });
      if (method === 'POST' && u === '/backups/google/connect') return json({ data: { url: 'https://accounts.google.com/o/oauth2/v2/auth?state=s' } });
      if (method === 'DELETE' && u === '/backups/google') {
        current = { ...current, drive: { ...current.drive, connected: false, stored: false, email: null } };
        return json({ data: { disconnected: true } });
      }
      return json({ error: { code: 'NOT_FOUND', message: 'nope' } }, 404);
    }),
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
});

function renderIt(props: Partial<Parameters<typeof BackupSettings>[0]> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <BackupSettings pollMs={20} {...props} />
    </QueryClientProvider>,
  );
}

describe('System Settings → Backups', () => {
  it('says when copies are made, the last one, and lists the kept copies with their kind, size and Google Drive state', async () => {
    current = overview({ copies: [COPY({ drive: 'UPLOADED' }), COPY({ id: 'c2', createdAt: '2026-10-16T22:01:00.000Z', kind: 'weekly', drive: 'FAILED', driveError: 'Google Drive is full.' })] });
    renderIt();
    expect(screen.getByRole('heading', { name: 'Backups' })).toBeInTheDocument();
    expect(await screen.findByText(/Every night at 02:00/)).toBeInTheDocument();
    expect(screen.getByText('Last backup: 30 Oct 2026, 02:01 · 24 MB')).toBeInTheDocument();
    const list = screen.getByRole('list', { name: 'Kept copies' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(within(rows[0]!).getByText('Nightly')).toBeInTheDocument();
    expect(within(rows[0]!).getByText('Sent to Google Drive')).toBeInTheDocument();
    expect(within(rows[1]!).getByText('Weekly')).toBeInTheDocument();
    expect(within(rows[1]!).getByText('Not sent to Google Drive')).toBeInTheDocument();
    expect(within(rows[1]!).getByText('17 Oct 2026, 02:01')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download the copy of 30 Oct 2026, 02:01' })).toBeInTheDocument();
    expect(screen.getByText(/Copies are not encrypted/)).toBeInTheDocument();
    expect(screen.getByText('/home/u/mico360-data/backups')).toBeInTheDocument();
  });

  it('a copy made with Back up now is shown as such', async () => {
    current = overview({ copies: [COPY({ id: 'm1', kind: 'manual', trigger: 'MANUAL' })] });
    renderIt();
    const list = await screen.findByRole('list', { name: 'Kept copies' });
    expect(within(list).getByText('Back up now')).toBeInTheDocument();
  });

  it('no copies yet', async () => {
    current = overview({ copies: [], lastSuccess: null });
    renderIt();
    expect(await screen.findByText('No copies yet. The first one is made tonight, or press Back up now.')).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Kept copies' })).toBeNull();
  });

  it('warns plainly after a failed night, and about the folder', async () => {
    current = overview({ warning: 'Last night’s backup failed: The server’s disk is full.', folderWarning: 'The backup folder is inside the app folder, so a new deployment may remove it.' });
    renderIt();
    const alerts = await screen.findAllByRole('alert');
    expect(alerts.map((a) => a.textContent)).toEqual(['Last night’s backup failed: The server’s disk is full.', 'The backup folder is inside the app folder, so a new deployment may remove it.']);
  });

  it('Back up now: starts a copy, says so, and reads again until it is done', async () => {
    renderIt();
    await userEvent.click(await screen.findByRole('button', { name: 'Back up now' }));
    expect(requests).toContainEqual({ method: 'POST', url: '/backups' });
    expect(await screen.findByText('Making a copy… It takes a few minutes; you can leave this page.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Back up now' })).toHaveAttribute('aria-busy', 'true');
    current = overview({ running: null, lastSuccess: { at: '2026-10-30T06:03:00.000Z', sizeBytes: 25 * 1024 * 1024 }, copies: [COPY({ id: 'c9', createdAt: '2026-10-30T06:00:00.000Z' }), ...overview().copies] });
    expect(await screen.findByText('The copy is ready.')).toBeInTheDocument();
    expect(screen.getByText('Last backup: 30 Oct 2026, 10:03 · 25 MB')).toBeInTheDocument();
  });

  it('a copy being made when the page opens: the button waits', async () => {
    current = overview({ running: { id: 'r1', trigger: 'NIGHTLY', startedAt: '2026-10-29T22:00:00.000Z' } });
    renderIt();
    expect(await screen.findByText('Making a copy… It takes a few minutes; you can leave this page.')).toBeInTheDocument();
  });

  it('Download gets a short-lived link and opens it (the browser saves the file)', async () => {
    const open = vi.fn();
    renderIt({ open });
    await userEvent.click(await screen.findByRole('button', { name: 'Download the copy of 30 Oct 2026, 02:01' }));
    await waitFor(() => expect(open).toHaveBeenCalledWith(expect.stringMatching(/\/api\/v1\/backups\/download\?token=abc$/)));
  });

  it('Google Drive not set up on this server: one line, no button', async () => {
    current = overview({ drive: { configured: false, connected: false, stored: false, email: null, connectedAt: null, problem: null, warning: null } });
    renderIt();
    expect(await screen.findByText('Google Drive isn’t set up on this server yet.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Connect Google Drive/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Disconnect' })).toBeNull();
  });

  it('not set up here, but a connection is still kept from before: says so and offers Disconnect', async () => {
    current = overview({ drive: { configured: false, connected: false, stored: true, email: 'owner@gmail.com', connectedAt: '2026-10-29T10:00:00.000Z', problem: null, warning: null } });
    renderIt();
    expect(await screen.findByText('Google Drive isn’t set up on this server yet.')).toBeInTheDocument();
    expect(screen.getByText('A connection to owner@gmail.com is still kept from before; nothing is sent with it.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Connect/ })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Disconnect Google Drive?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Disconnect' }));
    await waitFor(() => expect(requests).toContainEqual({ method: 'DELETE', url: '/backups/google' }));
    await waitFor(() => expect(screen.queryByText(/still kept from before/)).toBeNull());
  });

  it('Connect Google Drive goes to Google’s page', async () => {
    const open = vi.fn();
    renderIt({ open });
    await userEvent.click(await screen.findByRole('button', { name: 'Connect Google Drive' }));
    await waitFor(() => expect(open).toHaveBeenCalledWith('https://accounts.google.com/o/oauth2/v2/auth?state=s'));
  });

  it('connected: names the account; Disconnect asks first', async () => {
    current = overview({ drive: { configured: true, connected: true, stored: true, email: 'owner@gmail.com', connectedAt: '2026-10-29T10:00:00.000Z', problem: null, warning: null } });
    renderIt();
    expect(await screen.findByText('Connected as owner@gmail.com')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Disconnect Google Drive?' });
    expect(requests.some((r) => r.method === 'DELETE')).toBe(false);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Disconnect' }));
    await waitFor(() => expect(requests).toContainEqual({ method: 'DELETE', url: '/backups/google' }));
    expect(await screen.findByRole('button', { name: 'Connect Google Drive' })).toBeInTheDocument();
  });

  it('a connection that stopped working says so and offers Connect again', async () => {
    current = overview({ drive: { configured: true, connected: true, stored: true, email: 'owner@gmail.com', connectedAt: '2026-10-29T10:00:00.000Z', problem: 'Google Drive no longer accepts this connection.', warning: 'Google Drive no longer accepts this connection.' } });
    renderIt();
    expect(await screen.findByText('Google Drive no longer accepts this connection.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Connect again' })).toBeInTheDocument();
  });

  it('back from Google (?drive=connected): says how it went, and tidies the address', async () => {
    window.history.replaceState(null, '', '/admin/settings?drive=connected#backups');
    renderIt();
    expect(await screen.findByText('Google Drive is connected. Each new copy will also go there.')).toBeInTheDocument();
    expect(window.location.search).toBe('');
    expect(window.location.hash).toBe('#backups');
    // Landing on #backups puts the keyboard on the section's heading.
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Backups' })));
  });

  it('when the overview can’t be read: a plain error with Retry', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ error: { code: 'FORBIDDEN', message: 'no' } }, 403)));
    renderIt();
    expect(await screen.findByText(/Couldn’t load the backups/)).toBeInTheDocument();
  });
});
