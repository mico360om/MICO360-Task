import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ProfilePage } from './ProfilePage';
import { useAuthStore } from '../stores/auth-store';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const me = { id: 'u1', email: 'ada@x.co', username: 'ada', roles: ['EMPLOYEE'] };
let calls: { url: string; method: string; body?: Record<string, unknown> }[];
let passwordResponse: () => Response;

beforeEach(() => {
  calls = [];
  passwordResponse = () => json({ data: { accessToken: 'fresh-at', refreshToken: 'fresh-rt' } });
  useAuthStore.getState().setSession({ user: me, accessToken: 'old-at', refreshToken: 'old-rt' });
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    calls.push({ url: String(url), method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (String(url).endsWith('/users/me/password')) return passwordResponse();
    if (String(url).endsWith('/users/me/export')) return new Response(JSON.stringify({ profile: { id: 'u1' } }), { status: 200, headers: { 'content-type': 'application/json' } });
    return json({ data: [] });
  }));
});
afterEach(() => {
  vi.restoreAllMocks();
  useAuthStore.setState({ user: null, accessToken: null, refreshToken: null, isAuthenticated: false });
});

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={qc}>
        <ProfilePage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

async function fillAndSubmit(next: string, confirm = next) {
  await userEvent.type(screen.getByLabelText(/current password/i), 'OldPass123');
  await userEvent.type(screen.getByLabelText(/^new password/i), next);
  await userEvent.type(screen.getByLabelText(/confirm new password/i), confirm);
  await userEvent.click(screen.getByRole('button', { name: /update password/i }));
}

describe('ProfilePage — change password', () => {
  it('stores the fresh session the server returns, so this device stays signed in (SEC-18)', async () => {
    renderPage();
    await fillAndSubmit('NewPass456');
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/still signed in here/i));
    const s = useAuthStore.getState();
    expect(s.accessToken).toBe('fresh-at');
    expect(s.refreshToken).toBe('fresh-rt');
    expect(s.user?.id).toBe('u1');
    expect(calls.find((c) => c.url.endsWith('/users/me/password'))!.body).toEqual({ currentPassword: 'OldPass123', newPassword: 'NewPass456' });
  });

  it('warns that a sign-in will be needed when the server returns no new session', async () => {
    passwordResponse = () => new Response(null, { status: 204 });
    renderPage();
    await fillAndSubmit('NewPass456');
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/sign in again/i));
    expect(useAuthStore.getState().accessToken).toBe('old-at');
  });

  it('uses the same password rule and hint as everywhere else (SEC-12)', async () => {
    renderPage();
    expect(screen.getByText(/at least 8 characters, with a letter and a number/i)).toBeInTheDocument();
    await fillAndSubmit('aaaaaa');
    expect(screen.getByRole('alert')).toHaveTextContent(/at least 8 characters/i);
    expect(calls.some((c) => c.url.endsWith('/users/me/password'))).toBe(false);
  });

  it('downloads the signed-in person’s data as a JSON file', async () => {
    const created: Blob[] = [];
    const createObjectURL = vi.fn((b: Blob) => { created.push(b); return 'blob:x'; });
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() }));
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: /download my data/i }));
    await waitFor(() => expect(click).toHaveBeenCalled());
    expect(calls.some((c) => c.url.endsWith('/users/me/export') && c.method === 'GET')).toBe(true);
    expect(created[0]!.size).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: /privacy policy/i })).toHaveAttribute('href', '/privacy');
  });
});

describe('ProfilePage — photo', () => {
  const pick = (file: File) => fireEvent.change(document.querySelector('input[type="file"]') as HTMLInputElement, { target: { files: [file] } });

  it('says why a file was refused instead of doing nothing', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) =>
      String(url).includes('/avatar')
        ? json({ error: { code: 'VALIDATION', message: 'Only PNG, JPEG, WebP or GIF images are allowed.' } }, 400)
        : json({ data: [] })));
    renderPage();
    pick(new File(['hello'], 'notes.txt', { type: 'text/plain' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Only PNG, JPEG, WebP or GIF images are allowed.');
    // The button is usable again.
    expect(screen.getByRole('button', { name: 'Upload photo' })).toBeEnabled();
  });

  it('says a picture is too large', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) =>
      String(url).includes('/avatar') ? json({ error: { code: 'ERROR', message: 'request file too large' } }, 413) : json({ data: [] })));
    renderPage();
    pick(new File(['x'], 'huge.png', { type: 'image/png' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('That picture is too large. Choose a smaller one.');
  });

  it('clears the message once a picture is accepted', async () => {
    let ok = false;
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (!String(url).includes('/avatar')) return json({ data: [] });
      return ok ? json({ data: { ...me, avatarUrl: '/uploads/a.png' } }) : json({ error: { code: 'ERROR', message: 'request file too large' } }, 413);
    }));
    renderPage();
    pick(new File(['x'], 'huge.png', { type: 'image/png' }));
    await screen.findByRole('alert');
    ok = true;
    pick(new File(['x'], 'ok.png', { type: 'image/png' }));
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  });
});

describe('the profile picture without a photo', () => {
  it('shows the first letters of the first two names, like every other avatar (Aisha Khan → AK, not AI)', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => (String(url).includes('/users/directory') ? json({ data: [{ id: 'u1', username: 'ada', firstName: 'Aisha', lastName: 'Khan' }] }) : json({ data: [] }))));
    renderPage();
    expect(await screen.findByRole('heading', { name: 'Aisha Khan' })).toBeInTheDocument();
    expect(screen.getByText('AK')).toBeInTheDocument();
    expect(screen.queryByText('AI')).not.toBeInTheDocument();
  });
});

describe('signing out with inspection changes still on this device', () => {
  it('asks first, and only "Log out anyway" signs out and removes them', async () => {
    localStorage.setItem('mico360.inspection.u1.i1', JSON.stringify({ v: 1, ownerId: 'u1', inspectionId: 'i1', projectId: 'p1', title: 'Rig daily check', snapshot: { id: 'i1', projectId: 'p1', title: 'Rig daily check', status: 'IN_PROGRESS', structure: { sections: [], clientSignature: 'NONE', supervisorSignature: 'NONE' }, answers: [], revision: 0 }, answers: { v: { itemId: 'v', result: 'PASS', reading: null, note: null, editedAt: '2026-10-27T08:00:00.000Z' } }, finish: null, followUps: {}, problem: null, savedAt: '', sentAt: null }));
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(screen.getByRole('alert')).toHaveTextContent('1 change saved on this device hasn’t been sent yet');
    expect(useAuthStore.getState().isAuthenticated).toBe(true);
    await userEvent.click(screen.getByRole('button', { name: 'Stay signed in' }));
    expect(screen.queryByRole('alert')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    await userEvent.click(screen.getByRole('button', { name: 'Log out anyway' }));
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
    expect(localStorage.getItem('mico360.inspection.u1.i1')).toBeNull();
  });
});
