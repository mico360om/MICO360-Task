import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MinutesSentLog } from './MinutesSentLog';
import type { MinutesSend } from '../../api/meetings';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const newer: MinutesSend = {
  id: 's2',
  sentAt: '2026-10-30T10:05:00.000Z',
  sentBy: { id: 'u1', name: 'Sara Ahmed' },
  final: true,
  to: [
    { email: 'aisha@x.co', name: 'Aisha Khan', userId: 'u2', copy: 'shared', ok: true },
    { email: 'bob@beta.test', name: 'Bob Betaonly', userId: 'u9', copy: 'own', ok: true },
    { email: 'client@outside.co', name: null, copy: 'shared', ok: true },
  ],
  cc: [
    { email: 'boss@outside.co', name: null, copy: 'shared', ok: false, error: 'Blocked: earlier emails to this address bounced or were marked as spam.' },
    { email: 'g@x.co', name: 'غيث الحارثي', copy: 'shared', ok: true },
    { email: 'h@x.co', name: 'Hana', copy: 'shared', ok: true },
  ],
};
const older: MinutesSend = { id: 's1', sentAt: '2026-10-29T08:00:00.000Z', sentBy: { id: 'u1', name: 'Sara Ahmed' }, final: false, to: [{ email: 'aisha@x.co', name: 'Aisha Khan', copy: 'shared', ok: true }], cc: [] };
let sends: MinutesSend[];

beforeEach(() => {
  sends = [newer, older];
  vi.stubGlobal('fetch', vi.fn(async (url: string) => (String(url).endsWith('/minutes/sends') ? json({ data: sends }) : json({ data: [] }))));
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function renderLog(props: Partial<Parameters<typeof MinutesSentLog>[0]> = {}) {
  const onSendAgain = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MinutesSentLog meetingId="m1" timeZone="Asia/Muscat" ended canSend onSendAgain={onSendAgain} {...props} />
    </QueryClientProvider>,
  );
  return { onSendAgain };
}

describe('the minutes "Sent" log', () => {
  it('lists each send newest first: who sent which minutes to how many, when, To and Cc with each address’s result', async () => {
    renderLog();
    const log = await screen.findByRole('list', { name: 'Sent' });
    const entries = within(log).getAllByRole('listitem', { name: /sent the/i });
    expect(entries).toHaveLength(2);
    const first = entries[0]!;
    expect(first).toHaveAccessibleName('Sara Ahmed sent the final minutes to 6 people');
    expect(first).toHaveTextContent('30 Oct 2026, 14:05'); // the site's zone (Muscat)
    expect(within(first).getByText('Final')).toBeInTheDocument();
    expect(first).toHaveTextContent('1 failed');
    const to = within(first).getByRole('list', { name: 'To' });
    expect(within(to).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      expect.stringMatching(/^Aisha Khan.*aisha@x\.co.*Sent$/),
      expect.stringMatching(/^Bob Betaonly.*bob@beta\.test.*own email.*Sent$/),
      expect.stringMatching(/^client@outside\.co.*Sent$/),
    ]);
    const cc = within(first).getByRole('list', { name: 'Cc' });
    const boss = within(cc).getAllByRole('listitem')[0]!;
    expect(boss).toHaveTextContent('Failed');
    expect(boss).toHaveTextContent(/bounced/);
    expect(within(cc).getByText('غيث الحارثي').tagName).toBe('BDI');
    expect(entries[1]).toHaveAccessibleName('Sara Ahmed sent the draft minutes to 1 person');
    expect(within(entries[1]!).getByText('Draft')).toBeInTheDocument();
    expect(within(entries[1]!).queryByRole('list', { name: 'Cc' })).not.toBeInTheDocument();
  });

  it('Send again hands over that send’s To and Cc', async () => {
    const { onSendAgain } = renderLog();
    const log = await screen.findByRole('list', { name: 'Sent' });
    await userEvent.click(within(within(log).getAllByRole('listitem', { name: /sent the/i })[0]!).getByRole('button', { name: 'Send again' }));
    expect(onSendAgain).toHaveBeenCalledWith({ to: newer.to, cc: newer.cc });
  });

  it('no Send again where the minutes can’t be sent (a cancelled meeting)', async () => {
    renderLog({ canSend: false });
    await screen.findByRole('list', { name: 'Sent' });
    expect(screen.queryByRole('button', { name: 'Send again' })).not.toBeInTheDocument();
  });

  it('says so once the meeting has ended and nothing was sent yet; before that, it stays out of the way', async () => {
    sends = [];
    const { unmount } = render(
      <QueryClientProvider client={new QueryClient()}>
        <MinutesSentLog meetingId="m1" timeZone="UTC" ended canSend onSendAgain={() => {}} />
      </QueryClientProvider>,
    );
    expect(await screen.findByText('The minutes haven’t been emailed yet.')).toBeInTheDocument();
    unmount();
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MinutesSentLog meetingId="m1" timeZone="UTC" ended={false} canSend onSendAgain={() => {}} />
      </QueryClientProvider>,
    );
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByRole('heading', { name: 'Sent' })).not.toBeInTheDocument();
  });

  it('Send again is a 44px target on a touch screen', async () => {
    renderLog();
    const button = (await screen.findAllByRole('button', { name: 'Send again' }))[0]!;
    expect(button.className).toContain('[@media(pointer:coarse)]:!min-h-11');
  });
});
