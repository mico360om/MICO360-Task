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
    expect(dialog).toHaveTextContent(/only what is marked “Show to client”/);
    expect(dialog).toHaveTextContent(/milestones and tasks: the title, status and due date, and “Late” once one is past its due date and not done/);
    expect(dialog).toHaveTextContent(/approved meeting minutes/);
    // Shared inspection reports carry the inspector's name and notes (by design): the panel says so.
    expect(dialog).toHaveTextContent(/inspection reports: the results, the inspector’s notes on each item, and the signatures with the signers’ names — the inspector’s too/);
    expect(dialog).toHaveTextContent(/They never see the team or who is assigned, comments, files, task descriptions or the notes taken in meetings/);
    expect(dialog).not.toHaveTextContent(/never see people/);
    const fatma = await screen.findByRole('listitem', { name: 'Fatma Al Harthy' });
    expect(within(fatma).getByText('fatma@client.example')).toBeInTheDocument();
    expect(within(fatma).getByText('Last viewed 3h ago')).toBeInTheDocument();
    expect(within(screen.getByRole('listitem', { name: 'Bilal' })).getByText('Not viewed yet')).toBeInTheDocument();
  });

  it('keeps a client’s name and address readable: Arabic names isolated, cut text in full on hover, buttons below on a narrow screen', async () => {
    api.list.mockResolvedValue([{ ...FATMA, name: 'فاطمة الحارثي', email: 'fatma.al-harthy@a-very-long-client-company-domain.example' }]);
    show();
    const name = await screen.findByText('فاطمة الحارثي');
    expect(name.tagName).toBe('BDI');
    expect(name.closest('[title]')).toHaveAttribute('title', 'فاطمة الحارثي');
    expect(screen.getByText('fatma.al-harthy@a-very-long-client-company-domain.example')).toHaveAttribute('title', 'fatma.al-harthy@a-very-long-client-company-domain.example');
    // The words ask for at least 12rem, so Resend and Remove move under them instead of squeezing them.
    expect(name.closest('li')!.firstElementChild!.className).toMatch(/flex-\[1_1_12rem\]/);
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

  it('says before a Resend what it does: a new link, the old one stops working (owner, 30 Oct) — heard with each Resend button', async () => {
    show();
    const fatma = await screen.findByRole('listitem', { name: 'Fatma Al Harthy' });
    const hint = 'Resend emails a new link. The old link stops working, and devices signed in with it are signed out.';
    expect(screen.getByText(hint)).toBeInTheDocument();
    const resend = within(fatma).getByRole('button', { name: 'Resend the link to Fatma Al Harthy' });
    expect(resend).toHaveAccessibleDescription(hint);
    expect(resend).toHaveAttribute('title', 'Sends a new link; the old one stops working');
  });

  it('Resend sends a new link and says the old one and the signed-in devices stop working', async () => {
    const user = userEvent.setup();
    api.resend.mockResolvedValue(FATMA);
    show();
    const fatma = await screen.findByRole('listitem', { name: 'Fatma Al Harthy' });
    await user.click(within(fatma).getByRole('button', { name: 'Resend the link to Fatma Al Harthy' }));
    expect(api.resend).toHaveBeenCalledWith('p1', 's1');
    expect(await screen.findByRole('status')).toHaveTextContent('A new link was sent to fatma@client.example. The old link no longer works, and devices signed in with it were signed out.');
  });

  it('an archived project: read-only, with Remove still there (no sharing, no Resend)', async () => {
    const user = userEvent.setup();
    api.remove.mockResolvedValue(undefined);
    show({ archived: true });
    const dialog = screen.getByRole('dialog', { name: 'Share with client' });
    expect(dialog).toHaveTextContent(/archived/i);
    expect(screen.queryByLabelText('Client’s name')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Share' })).toBeNull();
    const fatma = await screen.findByRole('listitem', { name: 'Fatma Al Harthy' });
    expect(within(fatma).queryByRole('button', { name: /Resend/ })).toBeNull();
    await user.click(within(fatma).getByRole('button', { name: 'Remove Fatma Al Harthy' }));
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Remove access' }));
    expect(api.remove).toHaveBeenCalledWith('p1', 's1');
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
