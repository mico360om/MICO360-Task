import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PeopleField, type MeetingPerson } from './PeopleField';

const directory = [
  { id: 'u1', username: 'khalid', firstName: 'Khalid', lastName: 'Al Amri', avatarUrl: null },
  { id: 'u2', username: 'sara', firstName: 'Sara', lastName: 'Al Balushi', avatarUrl: null },
  { id: 'u3', username: 'ali.h', firstName: 'Ali', lastName: 'Hassan', avatarUrl: null },
];

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ data: directory }), { status: 200, headers: { 'content-type': 'application/json' } })));
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

let latest: MeetingPerson[] = [];
function Harness({ initial = [] }: { initial?: MeetingPerson[] }) {
  const [value, setValue] = useState<MeetingPerson[]>(initial);
  latest = value;
  return <PeopleField value={value} onChange={(v) => { latest = v; setValue(v); }} organizerId="u1" />;
}
function renderIt(initial?: MeetingPerson[]) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <Harness initial={initial} />
    </QueryClientProvider>,
  );
}

describe('New meeting: People', () => {
  it('adds a team member from the directory search (not the organizer)', async () => {
    renderIt();
    await userEvent.click(await screen.findByRole('button', { name: 'Add a team member' }));
    const list = await screen.findByRole('listbox');
    expect(within(list).queryByRole('option', { name: /Khalid/ })).not.toBeInTheDocument(); // the organizer is already in
    await userEvent.click(within(list).getByRole('option', { name: /Sara Al Balushi/ }));
    expect(latest).toEqual([{ kind: 'user', id: 'u2', name: 'Sara Al Balushi' }]);
    expect(screen.getByRole('list', { name: 'People invited' })).toHaveTextContent('Sara Al Balushi');
  });

  it('adds a guest by email, named from before the @ unless a name is given', async () => {
    renderIt();
    await userEvent.type(screen.getByLabelText('Guest email'), 'sami.k@contractor.om');
    await userEvent.click(screen.getByRole('button', { name: 'Add guest' }));
    await userEvent.type(screen.getByLabelText('Guest name (optional)'), 'Huda Al Harthy');
    await userEvent.type(screen.getByLabelText('Guest email'), 'huda@pdo.co.om{Enter}');
    expect(latest).toEqual([
      { kind: 'guest', email: 'sami.k@contractor.om', name: 'sami.k' },
      { kind: 'guest', email: 'huda@pdo.co.om', name: 'Huda Al Harthy' },
    ]);
    expect(screen.getByLabelText('Guest email')).toHaveValue('');
  });

  it('refuses an invalid or repeated guest email with a message', async () => {
    renderIt([{ kind: 'guest', email: 'sami@contractor.om', name: 'Sami' }]);
    await userEvent.type(screen.getByLabelText('Guest email'), 'not-an-email');
    await userEvent.click(screen.getByRole('button', { name: 'Add guest' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a valid email address, for example name@company.com.');
    await userEvent.clear(screen.getByLabelText('Guest email'));
    await userEvent.type(screen.getByLabelText('Guest email'), 'SAMI@contractor.om');
    await userEvent.click(screen.getByRole('button', { name: 'Add guest' }));
    expect(screen.getByRole('alert')).toHaveTextContent('That guest is already invited.');
    expect(latest).toHaveLength(1);
  });

  it('removes a person with the keyboard', async () => {
    renderIt([{ kind: 'user', id: 'u2', name: 'Sara Al Balushi' }, { kind: 'guest', email: 'sami@contractor.om', name: 'Sami' }]);
    const remove = screen.getByRole('button', { name: 'Remove Sara Al Balushi' });
    remove.focus();
    await userEvent.keyboard('{Enter}');
    expect(latest).toEqual([{ kind: 'guest', email: 'sami@contractor.om', name: 'Sami' }]);
  });
});
