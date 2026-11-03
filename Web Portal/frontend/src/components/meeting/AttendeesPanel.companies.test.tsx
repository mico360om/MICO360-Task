import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AttendeesPanel } from './AttendeesPanel';
import type { Meeting } from '../../api/meetings';
import { useAuthStore } from '../../stores/auth-store';
import { useCompanyStore } from '../../stores/company-store';

/** A meeting page's "Team member to add": the people the server says can be invited (MC2 Task 7). */

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const hours = { days: [0, 1, 2, 3, 4], start: '08:00', end: '17:00' };
const company = (id: string, name: string) => ({ id, name, code: id, logoUrl: null, timeZone: 'Asia/Muscat', weekStart: 0, workingHours: hours });
const directory = [
  { id: 'me', username: 'mona', firstName: 'Mona', lastName: 'M', avatarUrl: null },
  { id: 'amy', username: 'amy', firstName: 'Amy', lastName: 'Alphaonly', avatarUrl: null },
  { id: 'bob', username: 'bob', firstName: 'Bob', lastName: 'Betaonly', avatarUrl: null },
];
const meeting = {
  id: 'm1', title: 'Weekly sync', description: null, category: null, status: 'SCHEDULED', projectId: null, organizerId: 'me', companyId: 'cB',
  location: null, onlineLink: null, startAt: '2026-11-10T06:00:00.000Z', endAt: null, timeZone: 'Asia/Muscat', recurrenceRule: null, recurrenceParentId: null,
  templateId: null, transcript: null, invitesSentAt: null, reminderSentAt: null, createdById: 'me', createdAt: '', updatedAt: '', canEdit: true,
} as Meeting;

let site: number;
let calls: string[];
beforeEach(() => {
  site = 2;
  calls = [];
  useCompanyStore.setState({ pick: null, notice: null, names: {}, userId: 'me' });
  useAuthStore.getState().setSession({ user: { id: 'me', email: 'm@x', username: 'mona', roles: ['EMPLOYEE'] }, accessToken: 'at', refreshToken: 'rt' });
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const u = String(url);
    calls.push(u);
    if (u.endsWith('/me/companies')) return json({ data: { companies: site >= 2 ? [company('cA', 'Alpha Co'), company('cB', 'Beta Co')] : [company('cA', 'Alpha Co')], primaryCompanyId: null, allArchived: false, siteCompanyCount: site } });
    if (u.includes('/meetings/invite-candidates')) return json({ data: [{ id: 'bob', firstName: 'Bob', lastName: 'Betaonly', username: 'bob', avatarUrl: null }] });
    return json({ data: [] });
  }));
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function renderPanel() {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <AttendeesPanel meeting={meeting} attendees={[]} directory={directory} loading={false} loadError={false} onRetry={vi.fn()} canEdit />
    </QueryClientProvider>,
  );
}

describe('AttendeesPanel — companies', () => {
  it('offers the people the server says can be invited to this meeting', async () => {
    renderPanel();
    await waitFor(() => expect(calls.some((u) => u.endsWith('/meetings/invite-candidates?companyId=cB'))).toBe(true));
    await userEvent.click(screen.getByRole('button', { name: 'Team member to add' }));
    await waitFor(() => expect(within(screen.getByRole('listbox')).getAllByRole('option').map((o) => o.textContent)).toEqual([expect.stringContaining('Bob Betaonly')]));
  });

  it('one company: the directory, as before', async () => {
    site = 1;
    renderPanel();
    await waitFor(() => expect(calls.some((u) => u.endsWith('/me/companies'))).toBe(true));
    await userEvent.click(screen.getByRole('button', { name: 'Team member to add' }));
    expect(await screen.findByRole('option', { name: /Amy Alphaonly/ })).toBeInTheDocument();
    expect(calls.some((u) => u.includes('/invite-candidates'))).toBe(false);
  });
});
