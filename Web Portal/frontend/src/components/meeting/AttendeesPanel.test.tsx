import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AttendeesPanel } from './AttendeesPanel';
import type { Attendee, Meeting } from '../../api/meetings';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const meeting = (over: Partial<Meeting> = {}) => ({ id: 'm1', title: 'Weekly sync', status: 'SCHEDULED', projectId: null, companyId: null, invitesSentAt: null, ...over }) as Meeting;
const person = (over: Partial<Attendee>): Attendee =>
  ({ id: 'a1', meetingId: 'm1', userId: 'u1', externalName: null, externalEmail: null, role: 'REQUIRED', attendance: 'INVITED', response: 'ACCEPTED', respondedAt: null, invitedAt: null, department: null, createdAt: '', ...over }) as Attendee;
const directory = [{ id: 'u1', username: 'aisha', firstName: 'Aisha', lastName: 'Khan', avatarUrl: null }];
let calls: { url: string; method: string; body?: Record<string, unknown> }[];
let answer: () => Response;

beforeEach(() => {
  calls = [];
  answer = () => json({ data: {} });
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    calls.push({ url: String(url), method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    return method === 'PATCH' ? answer() : json({ data: [] });
  }));
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function renderPanel(attendees: Attendee[], over: Partial<Meeting> = {}, canEdit = true) {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <AttendeesPanel meeting={meeting(over)} attendees={attendees} directory={directory} loading={false} loadError={false} onRetry={() => {}} canEdit={canEdit} />
    </QueryClientProvider>,
  );
}
const rowOf = (name: string) => screen.getByText(name).closest('li')!;

describe('People: one compact row each', () => {
  it('face, name, response and the Guest mark on one row; "Required" only when someone is Optional', () => {
    renderPanel([person({}), person({ id: 'a2', userId: null, externalName: 'Sami', externalEmail: 'sami@contractor.om', response: 'PENDING' })]);
    const aisha = rowOf('Aisha Khan');
    expect(aisha.querySelector('[data-avatar], img, [aria-hidden="true"]')).not.toBeNull();
    expect(aisha).toHaveTextContent('Accepted');
    expect(aisha).not.toHaveTextContent(/Required|Optional/);
    const sami = rowOf('Sami');
    expect(sami).toHaveTextContent('Guest');
    expect(sami).toHaveTextContent('No response');
    expect(sami).toHaveTextContent('sami@contractor.om');
    // The row is a single line of parts (wrapping only when narrow), not stacked badge lines.
    expect(sami.className).toMatch(/flex/);
    expect(sami.querySelectorAll(':scope > div').length).toBeLessThanOrEqual(1);
  });

  it('with someone Optional, each person says Required or Optional', () => {
    renderPanel([person({}), person({ id: 'a2', userId: 'u2', role: 'OPTIONAL', response: 'TENTATIVE' })]);
    expect(rowOf('Aisha Khan')).toHaveTextContent('Required');
    expect(screen.getByText('Unknown member').closest('li')!).toHaveTextContent('Optional');
    expect(screen.getByText('Unknown member').closest('li')!).toHaveTextContent('Maybe');
  });

  it('attendance is a chip once the meeting is under way, changed in place', async () => {
    renderPanel([person({})], { status: 'IN_PROGRESS' });
    const chip = within(rowOf('Aisha Khan')).getByRole('button', { name: 'Attendance for Aisha Khan: Not recorded' });
    expect(chip.className).toMatch(/rounded-full/);
    await userEvent.click(chip);
    await userEvent.click(within(screen.getByRole('listbox')).getByRole('option', { name: 'Present' }));
    await waitFor(() => expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ attendance: 'PRESENT' }));
  });

  it('a guest with no email address gets a small "Add email" (checked as an address); others just read "No email address"', async () => {
    renderPanel([person({ id: 'a3', userId: null, externalName: 'Walk-in', response: 'PENDING' })]);
    await userEvent.click(within(rowOf('Walk-in')).getByRole('button', { name: 'Add email for Walk-in' }));
    const box = screen.getByRole('textbox', { name: 'Email address for Walk-in' });
    await userEvent.type(box, 'nope{Enter}');
    expect(screen.getByRole('alert')).toHaveTextContent(/valid email address/i);
    await userEvent.clear(box);
    await userEvent.type(box, 'walk@ext.co');
    await userEvent.click(screen.getByRole('button', { name: 'Save email for Walk-in' }));
    await waitFor(() => expect(calls.find((c) => c.method === 'PATCH' && c.url.endsWith('/attendees/a3'))?.body).toEqual({ externalEmail: 'walk@ext.co' }));
  });

  it('someone else’s attendance, read only, still says what it is', () => {
    renderPanel([person({ attendance: 'PRESENT' })], { status: 'COMPLETED' }, false);
    expect(rowOf('Aisha Khan')).toHaveTextContent('Attendance: Present');
    expect(screen.queryByRole('button', { name: /^Attendance for/ })).toBeNull();
  });

  it('someone who can’t change the meeting reads "No email address", with no button', () => {
    renderPanel([person({ id: 'a3', userId: null, externalName: 'Walk-in', response: 'PENDING' })], {}, false);
    expect(rowOf('Walk-in')).toHaveTextContent('No email address');
    expect(screen.queryByRole('button', { name: /add email/i })).toBeNull();
  });

  it('the server’s refusal of a duplicate address is shown', async () => {
    answer = () => json({ error: { code: 'CONFLICT', message: 'This guest is already an attendee.' } }, 409);
    renderPanel([person({ id: 'a3', userId: null, externalName: 'Walk-in', response: 'PENDING' })]);
    await userEvent.click(screen.getByRole('button', { name: 'Add email for Walk-in' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Email address for Walk-in' }), 'g@ext.co{Enter}');
    expect(await screen.findByRole('alert')).toHaveTextContent('That address is already on the list.');
  });
});
