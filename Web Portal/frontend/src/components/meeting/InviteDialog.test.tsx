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

  it('a typed address (no name of its own) is shown once in the results, not twice', () => {
    render(<SendResults what="Minutes" report={{ sent: 2, failed: 0, recipients: [{ name: 'client@outside.co', email: 'client@outside.co', ok: true }, { name: 'Aisha Khan', email: 'aisha@mico360.test', ok: true }] } as never} />);
    const list = screen.getByRole('list', { name: /results/i });
    expect(within(list).getAllByText('client@outside.co')).toHaveLength(1);
    expect(within(list).getByText('aisha@mico360.test')).toBeInTheDocument();
  });

  it('lets the keyboard reach the list of results after sending', () => {
    render(<SendResults what="Invitations" report={{ sent: 1, failed: 0, recipients: [{ name: 'Aisha Khan', email: 'aisha@mico360.test', ok: true }] } as never} />);
    expect(screen.getByRole('list', { name: /results/i })).toHaveAttribute('tabindex', '0');
  });
});

describe('Send results: someone not sent on purpose (1.23.7)', () => {
  const report = {
    sent: 1,
    failed: 1,
    recipients: [
      { name: 'Aisha Khan', email: 'aisha@x.co', kind: 'organizer', ok: true },
      { name: 'Guest One', email: 'g@x.co', kind: 'guest', ok: false, error: 'The mail server didn’t accept it.' },
      { name: 'Hamad Al Busaidi', email: 'hamad@client.om', kind: 'member', ok: false, notSent: true, error: 'not sent — the client turned these off' },
    ],
  };

  it('shows “Not sent” with the reason in a neutral tone, not the red failure', () => {
    render(<SendResults what="Minutes" report={report as never} />);
    const rows = within(screen.getByRole('list', { name: /results/i })).getAllByRole('listitem');
    const hamad = rows[2]!;
    expect(hamad).toHaveTextContent('Not sent — the client turned these off');
    expect(hamad).not.toHaveTextContent(/not sent — not sent/i);
    expect(hamad.querySelector('.text-danger')).toBeNull();
    // A real failure stays red.
    expect(within(rows[1]!).getByText('The mail server didn’t accept it.').className).toContain('text-danger');
  });

  it('isn’t counted as a failure in the summary', () => {
    render(<SendResults what="Minutes" report={report as never} />);
    expect(screen.getByRole('status')).toHaveTextContent('Minutes sent to 1 of 3. 1 couldn’t be delivered. 1 not sent (notifications off).');
  });

  it('even when a server counts it as failed, the summary doesn’t; with no real failure it reads as a success', () => {
    render(
      <SendResults
        what="Minutes"
        report={{ sent: 1, failed: 1, recipients: [report.recipients[0], report.recipients[2]] } as never}
      />,
    );
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('Minutes sent to 1 of 2. 1 not sent (notifications off).');
    expect(status).not.toHaveTextContent(/couldn’t be delivered/);
    expect(status.className).toContain('bg-success-soft');
  });

  it('nobody sent at all (everyone chosen has these off): a neutral summary, not a success', () => {
    render(<SendResults what="Minutes" report={{ sent: 0, failed: 0, recipients: [report.recipients[2]] } as never} />);
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('Minutes sent to 0 of 1. 1 not sent (notifications off).');
    expect(status.className).not.toContain('bg-success-soft');
    expect(status.className).not.toContain('bg-warning-soft');
  });
});
