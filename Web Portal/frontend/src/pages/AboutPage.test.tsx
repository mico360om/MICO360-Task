import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AboutPage } from './AboutPage';
import { useAuthStore } from '../stores/auth-store';

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

const sections = (over: Record<string, string[]> = {}) => ({ features: [], improvements: [], fixes: [], ...over });
let admin = false;
let adminServerVersion = __APP_VERSION__;
let androidAppUrl: string | null = null;
let hostsApk = true;
beforeEach(() => {
  useAuthStore.setState({ user: { id: 'u1', email: 'a@x', username: 'a', roles: admin ? ['ADMIN'] : ['EMPLOYEE'] } as never, accessToken: 'at', refreshToken: 'rt', isAuthenticated: true });
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url);
    if (init?.method === 'HEAD') return new Response(null, { status: hostsApk ? 200 : 404 });
    if (u.endsWith('/version')) {
      return json({
        data: admin
          ? { version: adminServerVersion, deployedAt: '2026-11-02T15:30:00.000Z', commit: 'abc1234', source: 'build', nodeVersion: 'v22.12.0', uptimeSeconds: 3700, environment: 'production' }
          : { version: '1.1.0', deployedAt: '2026-11-02T15:30:00.000Z' },
      });
    }
    if (u.endsWith('/releases')) {
      return json({
        data: admin
          ? [
              { version: '1.1.0', date: '2026-11-02', sections: { ...sections({ features: ['Version history page.'] }), security: ['Sign-in codes expire sooner.'] } },
              { version: '1.0.0', date: '2026-10-16', sections: { ...sections({ fixes: ['Meetings keep their day.'] }), security: [] } },
            ]
          : [
              { version: '1.1.0', date: '2026-11-02', sections: sections({ features: ['Version history page.'] }), securityUpdates: true },
              { version: '1.0.0', date: '2026-10-16', sections: sections({ fixes: ['Meetings keep their day.'] }), securityUpdates: false },
            ],
      });
    }
    if (u.endsWith('/config')) return json({ data: { timeZone: 'Asia/Muscat', serverTime: new Date().toISOString(), androidAppUrl } });
    if (u.includes('/build-info.json')) return json({ version: __APP_VERSION__, builtAt: __APP_BUILT_AT__ });
    return json({ data: [] });
  }));
});
afterEach(() => {
  vi.restoreAllMocks();
  admin = false;
  adminServerVersion = __APP_VERSION__;
  androidAppUrl = null;
  hostsApk = true;
});

// Owner, 13 Nov (P1): Install App comes first; the Android APK moved here and to the sign-in page's footer.
describe('About: the Android app', () => {
  it('“Download for Android”: the APK this site hosts, as a download', async () => {
    renderPage();
    const link = await screen.findByRole('link', { name: 'Download for Android' });
    expect(link).toHaveAttribute('href', '/downloads/MICO360-Tasks.apk');
    expect(link).toHaveAttribute('download');
    expect(link).not.toHaveAttribute('target');
    // Said beside it: the website itself installs as an app.
    expect(screen.getByText(/install app in your account menu/i)).toBeInTheDocument();
  });

  it('opens an Android app page the administrator set (a store, say) instead of a file', async () => {
    androidAppUrl = 'https://play.google.com/store/apps/details?id=com.mico360.tasks';
    renderPage();
    const link = await screen.findByRole('link', { name: 'Download for Android' });
    await vi.waitFor(() => expect(link.getAttribute('href')).toBe(androidAppUrl));
    expect(link).not.toHaveAttribute('download');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
  });

  it('leaves the link out when the site has no APK (never a link that fails)', async () => {
    hostsApk = false;
    renderPage();
    await screen.findByRole('heading', { name: /version history/i });
    await vi.waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === 'HEAD')).toBe(true));
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByRole('link', { name: /android/i })).toBeNull();
  });
});

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <AboutPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('AboutPage', () => {
  it('shows the current version and every release’s changes, newest first', async () => {
    renderPage();
    expect(await screen.findByRole('heading', { name: 'Version 1.1.0' })).toBeInTheDocument();
    expect(screen.getByText(/Last updated 02\/11\/2026, 07:30 PM \(Oman Time\)/)).toBeInTheDocument();
    const releases = screen.getAllByRole('article');
    expect(releases.map((r) => within(r).getByRole('heading', { level: 3 }).textContent)).toEqual(['v1.1.0', 'v1.0.0']);
    expect(within(releases[0]!).getByText('Version history page.')).toBeInTheDocument();
    expect(within(releases[1]!).getByText('Meetings keep their day.')).toBeInTheDocument();
  });

  it('tells others only that a release had security updates, and no technical details', async () => {
    renderPage();
    const [first, second] = await screen.findAllByRole('article');
    expect(within(first!).getByText(/includes security updates/i)).toBeInTheDocument();
    expect(within(second!).queryByText(/security/i)).toBeNull();
    expect(screen.queryByText(/abc1234/)).toBeNull();
    expect(screen.queryByRole('heading', { name: /technical details/i })).toBeNull();
  });

  it('shows admins the security fixes and the technical details', async () => {
    admin = true;
    useAuthStore.setState({ user: { id: 'u1', email: 'a@x', username: 'a', roles: ['ADMIN'] } as never });
    renderPage();
    const [first] = await screen.findAllByRole('article');
    expect(within(first!).getByRole('heading', { name: 'Security' })).toBeInTheDocument();
    expect(within(first!).getByText('Sign-in codes expire sooner.')).toBeInTheDocument();
    const details = await screen.findByRole('region', { name: /technical details/i });
    expect(details.textContent).toContain('abc1234');
    expect(details.textContent).toContain('v22.12.0');
    expect(details.textContent).toMatch(/server and web app are in step/i);
  });

  it('warns admins when the server and the web app are different versions', async () => {
    admin = true;
    adminServerVersion = '9.9.9';
    useAuthStore.setState({ user: { id: 'u1', email: 'a@x', username: 'a', roles: ['ADMIN'] } as never });
    renderPage();
    const details = await screen.findByRole('region', { name: /technical details/i });
    expect(details.textContent).toMatch(/server \(v9\.9\.9\) and web app \(v\d+\.\d+\.\d+\) are different versions/i);
  });
});
