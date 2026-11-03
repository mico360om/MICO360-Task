import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MinutesEmailDialog } from './MinutesEmailDialog';
import type { Meeting, MinutesSend } from '../../api/meetings';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const meeting = { id: 'm1', title: 'Weekly review', status: 'COMPLETED', projectId: 'p1', companyId: null } as unknown as Meeting;
const people = [
  { name: 'Aisha Khan', email: 'aisha@x.co', kind: 'organizer', attendeeIds: [], alreadyInvited: true, userId: 'u1', copy: 'shared' },
  { name: 'Guest One', email: 'g@x.co', kind: 'guest', attendeeIds: ['a1'], alreadyInvited: true, copy: 'shared' },
  { name: 'Bob Betaonly', email: 'bob@beta.test', kind: 'member', attendeeIds: ['a2'], alreadyInvited: true, userId: 'u9', copy: 'own' },
  { name: 'Gus Gammaonly', email: 'gus@gamma.test', kind: 'member', attendeeIds: ['a3'], alreadyInvited: true, userId: 'u8', copy: 'none' },
];
let calls: { url: string; method: string; body?: Record<string, unknown> }[];
let sendAnswer: () => Response;

beforeEach(() => {
  calls = [];
  sendAnswer = () => json({ data: { sent: 3, failed: 0, recipients: [], skipped: [] } });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      const method = init?.method ?? 'GET';
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ url: u, method, body });
      if (u.endsWith('/minutes/preview')) {
        return json({ data: { subject: 'Minutes: Weekly review', html: '<p>Ready.</p>', text: '', attachmentName: 'minutes-final-weekly-review.pdf', recipients: people, missingEmail: [], final: true } });
      }
      if (u.endsWith('/minutes/suggestions')) return json({ data: [{ email: 'client@outside.co', name: null }, { email: 'g@x.co', name: 'Guest One' }] });
      if (u.endsWith('/minutes/send') && method === 'POST') return sendAnswer();
      if (u.endsWith('/users/directory')) {
        return json({ data: [{ id: 'u1', username: 'aisha', firstName: 'Aisha', lastName: 'Khan' }, { id: 'u5', username: 'sara', firstName: 'Sara', lastName: 'Ahmed' }, { id: 'u6', username: 'omar', firstName: 'Omar', lastName: 'Old', active: false }] });
      }
      return json({ data: [] });
    }),
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function renderDialog(prefill?: Pick<MinutesSend, 'to' | 'cc'>) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MinutesEmailDialog meeting={meeting} prefill={prefill} onClose={() => {}} />
    </QueryClientProvider>,
  );
  return qc;
}
const sentBody = () => calls.find((c) => c.method === 'POST' && c.url.endsWith('/minutes/send'))?.body;
const dialog = () => screen.findByRole('dialog', { name: /email the minutes/i });

describe('Email the minutes: To and Cc', () => {
  it('To starts with the meeting’s people ticked; someone from another company is marked as getting their own email, someone with no access can’t be ticked', async () => {
    renderDialog();
    const d = await dialog();
    const to = await within(d).findByRole('group', { name: /^to/i });
    expect(within(to).getByRole('checkbox', { name: /aisha khan/i })).toBeChecked();
    expect(within(to).getByRole('checkbox', { name: /guest one/i })).toBeChecked();
    expect(within(to).getByRole('checkbox', { name: /bob betaonly/i })).toBeChecked();
    expect(within(to).getByText(/their own email \(another company\)/i)).toBeInTheDocument();
    const gus = within(to).getByRole('checkbox', { name: /gus gammaonly/i });
    expect(gus).not.toBeChecked();
    expect(gus).toBeDisabled();
    expect(within(to).getByText(/can’t open this meeting/i)).toBeInTheDocument();
  });

  it('adds a colleague and a typed address to To, and a Cc; sends ONE email with those lines', async () => {
    renderDialog();
    const d = await dialog();
    await within(d).findByRole('group', { name: /^to/i });
    await userEvent.click(within(d).getByRole('button', { name: 'Add a colleague to To' }));
    const list = await screen.findByRole('listbox');
    expect(within(list).queryByRole('option', { name: /Aisha Khan/ })).not.toBeInTheDocument(); // already on the meeting
    expect(within(list).queryByRole('option', { name: /Omar Old/ })).not.toBeInTheDocument(); // an inactive account
    await userEvent.click(within(list).getByRole('option', { name: /Sara Ahmed/ }));
    await userEvent.type(within(d).getByRole('textbox', { name: 'Email address for To' }), 'client@outside.co{Enter}');
    await userEvent.type(within(d).getByRole('textbox', { name: 'Email address for Cc' }), 'Boss@Outside.co');
    await userEvent.click(within(d).getByRole('button', { name: 'Add to Cc' }));
    // The preview shows the real To and Cc lines (not the person who gets their own email).
    const lines = within(d).getByRole('region', { name: /email preview/i });
    expect(within(lines).getByText('To').nextElementSibling).toHaveTextContent('Aisha Khan, Guest One, Sara Ahmed, client@outside.co');
    expect(within(lines).getByText('Cc').nextElementSibling).toHaveTextContent('Boss@Outside.co');
    expect(lines).toHaveTextContent(/Bob Betaonly gets their own email/);
    await userEvent.click(within(d).getByRole('button', { name: /send to 6 people/i }));
    await waitFor(() =>
      expect(sentBody()).toEqual({
        to: [{ email: 'aisha@x.co' }, { email: 'g@x.co' }, { email: 'bob@beta.test' }, { userId: 'u5' }, { email: 'client@outside.co' }],
        cc: [{ email: 'Boss@Outside.co' }],
      }),
    );
  });

  it('an address appears once: To wins over Cc', async () => {
    renderDialog();
    const d = await dialog();
    await within(d).findByRole('group', { name: /^to/i });
    // Already on To: refused for Cc.
    await userEvent.type(within(d).getByRole('textbox', { name: 'Email address for Cc' }), 'AISHA@x.co{Enter}');
    expect(within(d).getByRole('alert')).toHaveTextContent(/already on To/i);
    // On Cc first, then added to To: it moves to To.
    await userEvent.clear(within(d).getByRole('textbox', { name: 'Email address for Cc' }));
    await userEvent.type(within(d).getByRole('textbox', { name: 'Email address for Cc' }), 'client@outside.co{Enter}');
    await userEvent.type(within(d).getByRole('textbox', { name: 'Email address for To' }), 'client@outside.co{Enter}');
    expect(within(within(d).getByRole('group', { name: /^cc/i })).queryByText('client@outside.co')).not.toBeInTheDocument();
    expect(within(within(d).getByRole('group', { name: /^to/i })).getByText('client@outside.co')).toBeInTheDocument();
  });

  it('checks a typed address as an email; removes one with ✕', async () => {
    renderDialog();
    const d = await dialog();
    await within(d).findByRole('group', { name: /^to/i });
    await userEvent.type(within(d).getByRole('textbox', { name: 'Email address for To' }), 'not an address{Enter}');
    expect(within(d).getByRole('alert')).toHaveTextContent(/valid email address/i);
    await userEvent.clear(within(d).getByRole('textbox', { name: 'Email address for To' }));
    await userEvent.type(within(d).getByRole('textbox', { name: 'Email address for To' }), 'client@outside.co{Enter}');
    await userEvent.click(within(d).getByRole('button', { name: 'Remove client@outside.co' }));
    expect(within(d).queryByText('client@outside.co')).not.toBeInTheDocument();
  });

  it('the Cc picker suggests addresses used in earlier sends (not ones already on the email)', async () => {
    renderDialog();
    const d = await dialog();
    await within(d).findByRole('group', { name: /^to/i });
    await userEvent.click(within(d).getByRole('button', { name: 'Add a colleague or a recent address to Cc' }));
    const list = await screen.findByRole('listbox');
    expect(await within(list).findByRole('option', { name: /client@outside\.co/ })).toBeInTheDocument();
    expect(within(list).queryByRole('option', { name: /Guest One/ })).not.toBeInTheDocument(); // already on To
    await userEvent.click(within(list).getByRole('option', { name: /client@outside\.co/ }));
    await userEvent.click(within(d).getByRole('button', { name: /send to 4 people/i }));
    await waitFor(() => expect(sentBody()?.cc).toEqual([{ email: 'client@outside.co' }]));
  });

  it('at most 50 addresses per send, and To can’t be empty', async () => {
    renderDialog();
    const d = await dialog();
    await within(d).findByRole('group', { name: /^to/i });
    await userEvent.click(within(d).getByRole('button', { name: 'None' }));
    expect(within(d).getByText(/add at least one person to to/i)).toBeInTheDocument();
    expect(within(d).getByRole('button', { name: /^send/i })).toBeDisabled();
    await userEvent.click(within(d).getByRole('button', { name: 'All' }));
    const cc = within(d).getByRole('textbox', { name: 'Email address for Cc' });
    for (let i = 0; i < 48; i++) {
      await userEvent.clear(cc);
      await userEvent.type(cc, `p${i}@outside.co{Enter}`);
    }
    expect(within(d).getByRole('button', { name: /send to 51 people/i })).toBeDisabled();
    expect(within(d).getByText(/at most 50 addresses per send/i)).toBeInTheDocument();
  }, 30_000);

  it('Send again opens with the same To and Cc', async () => {
    renderDialog({
      to: [
        { email: 'aisha@x.co', name: 'Aisha Khan', userId: 'u1', copy: 'shared', ok: true },
        { email: 'sara@x.co', name: 'Sara Ahmed', userId: 'u5', copy: 'shared', ok: true },
      ],
      cc: [{ email: 'g@x.co', name: 'Guest One', copy: 'shared', ok: false, error: 'The mail server didn’t accept it.' }],
    });
    const d = await dialog();
    const to = await within(d).findByRole('group', { name: /^to/i });
    await waitFor(() => expect(within(to).getByRole('checkbox', { name: /guest one/i })).not.toBeChecked());
    expect(within(to).getByRole('checkbox', { name: /aisha khan/i })).toBeChecked();
    expect(within(to).getByRole('checkbox', { name: /bob betaonly/i })).not.toBeChecked();
    expect(within(to).getByText('Sara Ahmed')).toBeInTheDocument();
    expect(within(within(d).getByRole('group', { name: /^cc/i })).getByText('Guest One')).toBeInTheDocument();
    await userEvent.click(within(d).getByRole('button', { name: /send to 3 people/i }));
    await waitFor(() => expect(sentBody()).toEqual({ to: [{ email: 'aisha@x.co' }, { email: 'sara@x.co' }], cc: [{ email: 'g@x.co' }] }));
  });

  it('after sending, the meeting’s "Sent" log is asked for again and the results show', async () => {
    sendAnswer = () => json({ data: { sent: 1, failed: 1, recipients: [{ name: 'Aisha Khan', email: 'aisha@x.co', kind: 'organizer', ok: true }, { name: 'Guest One', email: 'g@x.co', kind: 'guest', ok: false, error: 'The mail server didn’t accept it.' }], skipped: [{ name: 'Someone', reason: 'can’t get these minutes yet' }] } });
    const qc = renderDialog();
    const spy = vi.spyOn(qc, 'invalidateQueries');
    const d = await dialog();
    await within(d).findByRole('group', { name: /^to/i });
    await userEvent.click(within(d).getByRole('button', { name: /^send to/i }));
    expect(await within(d).findByText(/sent to 1 of 2/i)).toBeInTheDocument();
    expect(within(d).getByText(/^not sent/i)).toHaveTextContent('Not sent (can’t get these minutes yet): Someone');
    expect(spy).toHaveBeenCalledWith({ queryKey: ['meeting', 'm1', 'minutes-sends'] });
  });
});
