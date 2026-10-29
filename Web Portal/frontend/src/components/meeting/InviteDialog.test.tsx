import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import { InviteDialog, SendResults } from './InviteDialog';
import type { Meeting } from '../../api/meetings';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const LONG = 'abdulrahman.alharthy@very-long-vendor-domain-name.example';
const preview = {
  recipients: [
    { name: 'Aisha Khan', email: 'aisha@mico360.test', kind: 'organizer', attendeeIds: [], alreadyInvited: false },
    { name: 'عبدالرحمن الحارثي', email: LONG, kind: 'guest', attendeeIds: ['a2'], alreadyInvited: false },
  ],
  missingEmail: [],
  problems: [],
  invitesSentAt: null,
};

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => (String(url).endsWith('/invites/preview') ? json({ data: preview }) : json({ data: [] }))));
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const meeting = { id: 'm1', title: 'Weekly review', status: 'SCHEDULED', invitesSentAt: null } as unknown as Meeting;

describe('Invitations dialog', () => {
  it('lets the keyboard reach the recipients list, which scrolls when long', async () => {
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <InviteDialog meeting={meeting} onClose={() => {}} />
      </QueryClientProvider>,
    );
    const list = await screen.findByRole('list', { name: /recipients/i });
    expect(list).toHaveAttribute('tabindex', '0');
  });

  it('shows each recipient’s address on a line of its own, in full on hover, so a phone never hides it behind the name', async () => {
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <InviteDialog meeting={meeting} onClose={() => {}} />
      </QueryClientProvider>,
    );
    const list = await screen.findByRole('list', { name: /recipients/i });
    const email = within(list).getByText(LONG);
    expect(email).toHaveAttribute('title', LONG);
    expect(email.className).toMatch(/(^|\s)block(\s|$)/);
    expect(within(list).getByText('عبدالرحمن الحارثي').tagName).toBe('BDI');
  });

  it('lets the keyboard reach the list of results after sending', () => {
    render(<SendResults what="Invitations" report={{ sent: 1, failed: 0, recipients: [{ name: 'Aisha Khan', email: 'aisha@mico360.test', ok: true }] } as never} />);
    expect(screen.getByRole('list', { name: /results/i })).toHaveAttribute('tabindex', '0');
  });
});
