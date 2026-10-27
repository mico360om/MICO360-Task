import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useDateSettings } from './useDatePrefs';
import { DatePreferences } from '../components/DatePreferences';
import { useAuthStore } from '../stores/auth-store';

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
let companyWeek: 0 | 1 | 6 | undefined;
let ownWeek: 0 | 1 | 6 | null;
let saved: unknown[];

beforeEach(() => {
  companyWeek = 1;
  ownWeek = null;
  saved = [];
  useAuthStore.getState().setSession({ user: { id: 'me', email: 'me@x', username: 'me', roles: ['EMPLOYEE'] }, accessToken: 'at', refreshToken: 'rt' });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/config')) return json({ data: { timeZone: 'Asia/Muscat', productName: '', companyName: '', serverTime: '', ...(companyWeek === undefined ? {} : { weekStart: companyWeek }) } });
      if (url.endsWith('/users/me/preferences') && init?.method === 'PUT') {
        const body = JSON.parse(String(init.body));
        saved.push(body);
        ownWeek = body.weekStart;
        return json({ data: { timeZone: null, weekStart: ownWeek } });
      }
      if (url.endsWith('/users/me/preferences')) return json({ data: { timeZone: null, weekStart: ownWeek } });
      return json({ data: null });
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

function Show() {
  const s = useDateSettings();
  return <p>week {s.weekStart} own {String(s.ownWeekStart)} company {s.companyWeekStart}</p>;
}
const wrap = (ui: React.ReactNode) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);

describe('useDateSettings: the week start (I-1)', () => {
  it('is the company’s for someone who never chose one', async () => {
    wrap(<Show />);
    expect(await screen.findByText('week 1 own null company 1')).toBeInTheDocument();
  });

  it('is the person’s own when they chose one', async () => {
    ownWeek = 6;
    wrap(<Show />);
    expect(await screen.findByText('week 6 own 6 company 1')).toBeInTheDocument();
  });

  it('is Sunday when the server doesn’t say (an older server)', async () => {
    companyWeek = undefined;
    wrap(<Show />);
    expect(await screen.findByText('week 0 own null company 0')).toBeInTheDocument();
  });
});

describe('Settings → Calendar & dates: the week start', () => {
  it('says the company’s week start is used until one is chosen, and can go back to it', async () => {
    ownWeek = 0;
    wrap(<DatePreferences />);
    expect(await screen.findByText(/Your own choice\. The company’s week starts on Monday\./)).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Use the company’s (Monday)' }));
    await waitFor(() => expect(saved).toEqual([{ weekStart: null }]));
    expect(await screen.findByText(/The company’s: Monday\./)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Monday' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByRole('button', { name: /Use the company’s/ })).not.toBeInTheDocument();
  });
});
