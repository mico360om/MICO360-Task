import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FreeTimes } from './FreeTimes';

const at = (local: string) => new Date(`${local.replace(' ', 'T')}:00+04:00`).toISOString();
let reply: Record<string, unknown>;
let asked: Array<{ url: string; body: Record<string, unknown> }>;

beforeEach(() => {
  asked = [];
  reply = { suggestions: [], clashes: [], day: [], workingHours: { days: [0, 1, 2, 3, 4], start: '08:00', end: '17:00' } };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.endsWith('/config')) return new Response(JSON.stringify({ data: { timeZone: 'Asia/Muscat' } }), { status: 200, headers: { 'content-type': 'application/json' } });
      asked.push({ url: u, body: init?.body ? JSON.parse(String(init.body)) : {} });
      return new Response(JSON.stringify({ data: reply }), { status: 200, headers: { 'content-type': 'application/json' } });
    }),
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function renderIt(props: Partial<Parameters<typeof FreeTimes>[0]> = {}) {
  const onPick = vi.fn();
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const all = { userIds: ['u1', 'u2'], startAt: at('2026-10-26 10:00'), minutes: 60, rule: null, onPick, ...props };
  const view = render(
    <QueryClientProvider client={qc}>
      <FreeTimes {...all} />
    </QueryClientProvider>,
  );
  const rerender = (next: Partial<Parameters<typeof FreeTimes>[0]>) =>
    view.rerender(
      <QueryClientProvider client={qc}>
        <FreeTimes {...all} {...next} />
      </QueryClientProvider>,
    );
  return { onPick, rerender };
}
const freeTimeCalls = () => asked.filter((a) => a.url.endsWith('/meetings/free-times'));

describe('Meeting form: free times', () => {
  it('offers three times and uses one on click', async () => {
    reply.suggestions = [at('2026-10-26 08:00'), at('2026-10-26 11:00'), at('2026-10-26 11:30')];
    const { onPick } = renderIt();
    await userEvent.click(screen.getByRole('button', { name: 'Suggest 3 times' }));
    const group = await screen.findByRole('group', { name: 'Suggested times' });
    const options = within(group).getAllByRole('button');
    expect(options).toHaveLength(3);
    expect(options[1]).toHaveTextContent(/11:00/);
    await userEvent.click(options[1]!);
    expect(onPick).toHaveBeenCalledWith(at('2026-10-26 11:00'));
    expect(freeTimeCalls().at(-1)!.body).toEqual({ userIds: ['u1', 'u2'], startAt: at('2026-10-26 10:00'), minutes: 60 });
  });

  it('warns who clashes and when', async () => {
    reply.clashes = [{ userId: 'u2', name: 'Sara Al Balushi', date: '2026-10-26', start: at('2026-10-26 10:30'), end: at('2026-10-26 11:30'), title: 'Pump review' }];
    renderIt();
    // The live region is there from the start (so the warning is announced when it appears).
    const warning = screen.getByRole('status', { name: 'Clashes' });
    await waitFor(() => expect(warning).toHaveTextContent('Sara Al Balushi'));
    expect(warning).toHaveTextContent('Pump review');
    expect(warning).toHaveTextContent(/10:30/);
  });

  it('shows "Busy" for a meeting the person can’t see', async () => {
    reply.day = [
      { userId: 'u1', name: 'Khalid Al Amri', blocks: [] },
      { userId: 'u2', name: 'Sara Al Balushi', blocks: [{ start: at('2026-10-26 13:00'), end: at('2026-10-26 14:00'), title: null }] },
    ];
    renderIt();
    const strip = await screen.findByRole('list', { name: /Busy on/ });
    const rows = within(strip).getAllByRole('listitem');
    expect(rows[0]).toHaveTextContent('Khalid Al Amri');
    expect(rows[0]).toHaveTextContent('No meetings');
    expect(rows[1]).toHaveTextContent('Sara Al Balushi');
    expect(rows[1]).toHaveTextContent('Busy');
  });

  it('asking again gets fresh suggestions (meeting hours may have changed)', async () => {
    reply.suggestions = [at('2026-10-26 08:00'), at('2026-10-26 08:30'), at('2026-10-26 09:00')];
    renderIt();
    await userEvent.click(screen.getByRole('button', { name: 'Suggest 3 times' }));
    expect(within(await screen.findByRole('group', { name: 'Suggested times' })).getAllByRole('button')[0]).toHaveTextContent(/8:00/);
    reply.suggestions = [at('2026-10-26 13:00'), at('2026-10-26 13:30'), at('2026-10-26 14:00')];
    await userEvent.click(screen.getByRole('button', { name: 'Suggest 3 times' }));
    await waitFor(() => expect(within(screen.getByRole('group', { name: 'Suggested times' })).getAllByRole('button')[0]).toHaveTextContent(/13:00/));
  });

  it('says when no free time was found in the next two weeks', async () => {
    renderIt();
    await userEvent.click(screen.getByRole('button', { name: 'Suggest 3 times' }));
    expect(await screen.findByText('No free time found in the next two weeks.')).toBeInTheDocument();
  });

  it('re-checks when the time or the people change, once they settle', async () => {
    const { rerender } = renderIt();
    await waitFor(() => expect(freeTimeCalls()).toHaveLength(1));
    rerender({ startAt: at('2026-10-26 12:00') });
    rerender({ startAt: at('2026-10-26 13:00'), userIds: ['u1', 'u2', 'u3'] });
    await waitFor(() => expect(freeTimeCalls()).toHaveLength(2));
    expect(freeTimeCalls()[1]!.body).toMatchObject({ startAt: at('2026-10-26 13:00'), userIds: ['u1', 'u2', 'u3'] });
  });

  it('works with no AI configured: only the plain free-time check is asked for', async () => {
    renderIt({ excludeMeetingId: 'm5', rule: { freq: 'WEEKLY', interval: 1, weekdays: [1] } });
    await waitFor(() => expect(freeTimeCalls()).toHaveLength(1));
    expect(asked.every((a) => !a.url.includes('/ai/'))).toBe(true);
    expect(freeTimeCalls()[0]!.body).toMatchObject({ excludeMeetingId: 'm5', recurrenceRule: { freq: 'WEEKLY', interval: 1, weekdays: [1] } });
  });

  it('asks nothing until there is a valid start', async () => {
    renderIt({ startAt: null });
    await new Promise((r) => setTimeout(r, 500));
    expect(freeTimeCalls()).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Suggest 3 times' })).toBeDisabled();
  });
});
