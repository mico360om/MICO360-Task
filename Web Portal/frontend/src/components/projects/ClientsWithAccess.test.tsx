import { describe, it, expect, vi, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ClientsWithAccess } from './ClientsWithAccess';

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

const NO_ACTIONS = { comment: false, signOff: false, respond: false, download: false, upload: false, notify: false };
// As the 1.23.7 server sends them: the role, and the access words starting with the role word.
const HAMAD = {
  id: 'cl1',
  name: 'Hamad Al Busaidi',
  organisation: 'Petroleum Development Oman',
  email: 'hamad@pdo.test',
  status: 'ACTIVE',
  role: 'CONTRIBUTOR',
  access: ['Contributor', 'View tasks', 'View meetings & minutes', 'Download reports', 'Receive notifications', 'Comment', 'Upload documents', 'Reply to invites'],
  modules: { progress: true, meetings: true },
  actions: { ...NO_ACTIONS, comment: true, respond: true, download: true, upload: true, notify: true },
};
const NOOR = {
  id: 'cl2',
  name: 'Noor Al Said',
  organisation: null,
  email: 'noor@oxy.test',
  status: 'ACTIVE',
  role: 'CUSTOM',
  access: ['Custom', 'View meetings & minutes', 'Receive notifications'],
  modules: { progress: false, meetings: true },
  actions: { ...NO_ACTIONS, notify: true },
};

function renderList(clients: unknown[], canChange = false) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => (String(url).endsWith('/projects/p1/clients') ? json({ data: { clients, canChange } }) : json({ data: [] }))),
  );
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <ClientsWithAccess projectId="p1" />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
const words = (list: HTMLElement) => within(list).getAllByRole('listitem').map((li) => li.textContent);

afterEach(() => vi.unstubAllGlobals());

describe('ClientsWithAccess (1.23.7 roles)', () => {
  it('shows each client’s role as a badge by their name, then what they may do (the role word not repeated)', async () => {
    renderList([HAMAD, NOOR]);
    const section = await screen.findByRole('region', { name: 'Clients with access' });
    const hamad = within(section).getByText('Hamad Al Busaidi').closest('li')!;
    const role = within(hamad).getByText('Contributor');
    expect(role).toHaveAttribute('data-tone', 'info');
    expect(role).toHaveTextContent('Role: Contributor');
    expect(words(within(hamad).getByRole('list', { name: 'What Hamad Al Busaidi may do' }))).toEqual(HAMAD.access.slice(1));
    const noor = within(section).getByText('Noor Al Said').closest('li')!;
    expect(within(noor).getByText('Custom')).toHaveAttribute('data-tone', 'brand');
    expect(words(within(noor).getByRole('list', { name: 'What Noor Al Said may do' }))).toEqual(['View meetings & minutes', 'Receive notifications']);
    // Read-only for a project manager.
    expect(within(section).queryByRole('button')).toBeNull();
    expect(within(section).queryByRole('combobox')).toBeNull();
  });

  it('an older server (no role): no badge, and the words as sent', async () => {
    const { role: _role, ...older } = HAMAD;
    void _role;
    renderList([{ ...older, access: ['Progress, milestones and tasks', 'Comment on tasks'] }]);
    const section = await screen.findByRole('region', { name: 'Clients with access' });
    const hamad = within(section).getByText('Hamad Al Busaidi').closest('li')!;
    expect(within(hamad).queryByText(/^(Viewer|Contributor|Approver|Custom)$/)).toBeNull();
    expect(words(within(hamad).getByRole('list', { name: 'What Hamad Al Busaidi may do' }))).toEqual(['Progress, milestones and tasks', 'Comment on tasks']);
  });
});
