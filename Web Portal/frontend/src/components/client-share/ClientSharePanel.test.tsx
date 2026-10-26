import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ClientSharePanel } from './ClientSharePanel';
import { ApiError } from '../../lib/api-client';
import type { ClientShare } from '../../api/client-shares';

const api = vi.hoisted(() => ({
  list: vi.fn(),
  add: vi.fn(),
  resend: vi.fn(),
  remove: vi.fn(),
}));
vi.mock('../../api/client-shares', () => ({ clientSharesApi: () => api }));

const FATMA: ClientShare = {
  id: 's1',
  name: 'Fatma Al Harthy',
  email: 'fatma@client.example',
  createdAt: '2026-10-20T08:00:00.000Z',
  linkSentAt: '2026-10-20T08:00:00.000Z',
  lastViewedAt: new Date(Date.now() - 3 * 3600_000).toISOString(),
};
const BILAL: ClientShare = { ...FATMA, id: 's2', name: 'Bilal', email: 'bilal@client.example', lastViewedAt: null };

const show = (props: Partial<Parameters<typeof ClientSharePanel>[0]> = {}) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ClientSharePanel projectId="p1" projectName="Rig 7 Inspection" emailEnabled onClose={() => {}} {...props} />
    </QueryClientProvider>,
  );

beforeEach(() => {
  for (const f of Object.values(api)) f.mockReset();
  api.list.mockResolvedValue([FATMA, BILAL]);
});

describe('Share with client', () => {
  it('says what a client sees — and never sees — and lists each client with when they last viewed it', async () => {
    show();
    const dialog = screen.getByRole('dialog', { name: 'Share with client' });
    expect(dialog).toHaveTextContent(/only the milestones, tasks and approved minutes marked “Show to client”/);
    expect(dialog).toHaveTextContent(/never see people, comments, files or internal notes/);
    const fatma = await screen.findByRole('listitem', { name: 'Fatma Al Harthy' });
    expect(within(fatma).getByText('fatma@client.example')).toBeInTheDocument();
    expect(within(fatma).getByText('Last viewed 3h ago')).toBeInTheDocument();
    expect(within(screen.getByRole('listitem', { name: 'Bilal' })).getByText('Not viewed yet')).toBeInTheDocument();
  });

  it('shares with a name and an address, and says the invitation went', async () => {
    const user = userEvent.setup();
    api.add.mockResolvedValue({ ...BILAL, id: 's3', name: 'Huda', email: 'huda@client.example' });
    show();
    await user.type(screen.getByLabelText('Client’s name'), 'Huda');
    await user.type(screen.getByLabelText('Email address'), 'huda@client.example');
    await user.click(screen.getByRole('button', { name: 'Share' }));
    expect(api.add).toHaveBeenCalledWith('p1', { name: 'Huda', email: 'huda@client.example' });
    expect(await screen.findByRole('status')).toHaveTextContent('Invitation sent to huda@client.example.');
  });

  it('shows the server’s reason when sharing is refused (already shared, blocked address…)', async () => {
    const user = userEvent.setup();
    api.add.mockRejectedValue(new ApiError(409, 'CLIENT_ALREADY_SHARED', 'This project is already shared with that address. Use Resend to send the link again.'));
    show();
    await user.type(screen.getByLabelText('Client’s name'), 'Fatma');
    await user.type(screen.getByLabelText('Email address'), 'fatma@client.example');
    await user.click(screen.getByRole('button', { name: 'Share' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('already shared with that address');
  });

  it('Resend sends a new link and says the old one stops working', async () => {
    const user = userEvent.setup();
    api.resend.mockResolvedValue(FATMA);
    show();
    const fatma = await screen.findByRole('listitem', { name: 'Fatma Al Harthy' });
    await user.click(within(fatma).getByRole('button', { name: 'Resend the link to Fatma Al Harthy' }));
    expect(api.resend).toHaveBeenCalledWith('p1', 's1');
    expect(await screen.findByRole('status')).toHaveTextContent('A new link was sent to fatma@client.example. The old link no longer works.');
  });

  it('Remove asks first, then ends their access at once', async () => {
    const user = userEvent.setup();
    api.remove.mockResolvedValue(undefined);
    show();
    const fatma = await screen.findByRole('listitem', { name: 'Fatma Al Harthy' });
    await user.click(within(fatma).getByRole('button', { name: 'Remove Fatma Al Harthy' }));
    const confirm = screen.getByRole('alertdialog', { name: 'Remove Fatma Al Harthy’s access?' });
    expect(confirm).toHaveTextContent(/signed out at once/);
    await user.click(within(confirm).getByRole('button', { name: 'Remove access' }));
    expect(api.remove).toHaveBeenCalledWith('p1', 's1');
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
  });

  it('can’t share while email is off, and says why', () => {
    show({ emailEnabled: false });
    expect(screen.getByRole('button', { name: 'Share' })).toBeDisabled();
    expect(screen.getByText(/Email isn’t set up on this server/)).toBeInTheDocument();
  });
});
