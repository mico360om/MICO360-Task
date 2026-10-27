import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { InspectionPage } from './InspectionPage';
import { useAuthStore } from '../stores/auth-store';
import type { AnswerWrite, InspectionDetail } from '../api/inspections';

const ME = 'u-ivan';

function detail(over: Partial<InspectionDetail> = {}): InspectionDetail {
  return {
    id: 'i1',
    projectId: 'p1',
    title: 'Rig daily check',
    status: 'IN_PROGRESS',
    place: 'Rig 3',
    startedAt: '2026-10-27T08:00:00.000Z',
    finishedAt: null,
    inspector: { id: ME, name: 'Ivan Inspector' },
    counts: { total: 2, answered: 0, passed: 0, failed: 0, na: 0 },
    result: '0 of 2 answered',
    clientVisible: false,
    task: { id: 't1', key: 'RIG-1', title: 'Inspect rig 3', done: false },
    description: null,
    formId: 'f1',
    formVersion: 1,
    structure: {
      sections: [
        {
          id: 's1',
          title: 'Well head',
          items: [
            { id: 'p', kind: 'READING', label: 'Pressure', help: null, unit: 'psi', min: 0, max: 150 },
            { id: 'v', kind: 'CHECK', label: 'Valves closed', help: null },
          ],
        },
      ],
      clientSignature: 'NONE',
      supervisorSignature: 'NONE',
    },
    startedBy: { id: ME, name: 'Ivan Inspector' },
    answers: [],
    signatures: [],
    followUps: [],
    permissions: { canAnswer: true, canFinish: true, canReopen: false, canTakeOver: false, canDelete: true, canShowToClient: false, canMakeFollowUps: true },
    signatureRoles: { allowed: ['INSPECTOR'], required: ['INSPECTOR'] },
    ...over,
  };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

let server: { detail: InspectionDetail; stored: Map<string, AnswerWrite>; offline: boolean; calls: string[] };

function stubFetch() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url).replace(/^.*\/api\/v1/, '');
      const method = init?.method ?? 'GET';
      server.calls.push(`${method} ${u}`);
      if (server.offline) throw new TypeError('Failed to fetch');
      if (method === 'GET' && u === '/inspections/i1') return json({ data: { ...server.detail, answers: [...server.stored.values()] } });
      if (method === 'PUT' && u === '/inspections/i1/answers') {
        const { answers } = JSON.parse(String(init!.body)) as { answers: AnswerWrite[] };
        const results = answers.map((a) => {
          server.stored.set(a.itemId, a);
          return { itemId: a.itemId, status: 'applied', answer: a };
        });
        return json({ data: { results, inspection: { ...server.detail, counts: { ...server.detail.counts, answered: server.stored.size } } } });
      }
      if (method === 'POST' && u === '/inspections/i1/finish') {
        server.detail = { ...server.detail, status: 'FINISHED', finishedAt: '2026-10-27T09:00:00.000Z', result: 'Passed', signatures: [{ role: 'INSPECTOR', name: 'Ivan Inspector', method: 'TYPED', image: null, signedAt: '2026-10-27T09:00:00.000Z' }] };
        return json({ data: { ...server.detail, answers: [...server.stored.values()], taskOffer: { id: 't1', key: 'RIG-1', title: 'Inspect rig 3', doneColumnId: 'c-done' } } });
      }
      if (method === 'PATCH' && u === '/tasks/t1/move') return json({ data: { id: 't1' } });
      if (method === 'POST' && u === '/inspections/i1/follow-ups') {
        const { itemIds } = JSON.parse(String(init!.body)) as { itemIds: string[] };
        server.detail = { ...server.detail, followUps: itemIds.map((itemId) => ({ itemId, task: { id: `t-${itemId}`, key: `RIG-9${itemId}`, title: 'Follow up', deleted: false, done: false }, pending: false })) };
        return json({ data: itemIds.map((itemId) => ({ itemId, status: 'created', task: { id: `t-${itemId}`, key: `RIG-9${itemId}`, title: 'Follow up' } })) });
      }
      if (u === '/projects/p1') return json({ data: { id: 'p1', name: 'Rig 3 overhaul', code: 'RIG', status: 'ACTIVE', ownerId: 'u-olivia' } });
      if (u === '/projects/p1/members') return json({ data: [{ id: 'u-olivia', username: 'olivia', email: 'o@x', firstName: 'Olivia', lastName: 'Owner', role: 'MANAGER' }] });
      return json({ error: { code: 'NOT_FOUND', message: 'Not found.' } }, 404);
    }),
  );
}

function show() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { networkMode: 'always' } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/inspections/i1']}>
        <Routes>
          <Route path="/inspections/:id" element={<InspectionPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  server = { detail: detail(), stored: new Map(), offline: false, calls: [] };
  useAuthStore.getState().setSession({ user: { id: ME, email: 'ivan@x', username: 'ivan', roles: [] }, accessToken: 'at', refreshToken: 'rt' });
  stubFetch();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('carrying out an inspection', () => {
  it('saves each answer on the phone and sends it, then says all is sent', async () => {
    show();
    await userEvent.click(await screen.findByRole('radio', { name: 'Pass' }));
    expect(JSON.parse(localStorage.getItem('mico360.inspection.u-ivan.i1')!).answers.v).toMatchObject({ result: 'PASS' });
    await waitFor(() => expect(server.calls).toContain('PUT /inspections/i1/answers'));
    await waitFor(() => expect(screen.getByRole('status', { name: '' })).toHaveTextContent('All changes sent.'));
    expect(server.stored.get('v')).toMatchObject({ result: 'PASS' });
  });

  it('keeps working without signal from the copy on the phone, and says the answers wait', async () => {
    const first = show();
    await screen.findByText('Valves closed');
    first.unmount();
    server.offline = true;
    show();
    expect(await screen.findByText('No signal: showing the copy saved on this phone.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('radio', { name: 'Fail' }));
    await waitFor(() => expect(screen.getByText(/Saved on this phone, will send when online: 1 answer\./)).toBeInTheDocument(), { timeout: 3000 });
    expect(screen.getByText('1 failed', { exact: false })).toBeInTheDocument();
    // Back online: it goes.
    server.offline = false;
    window.dispatchEvent(new Event('online'));
    await waitFor(() => expect(server.stored.get('v')).toMatchObject({ result: 'FAIL' }));
  });

  it('asks for every answer before signing', async () => {
    show();
    await userEvent.click(await screen.findByRole('button', { name: 'Sign and finish' }));
    const alert = screen.getByRole('alert');
    expect(within(alert).getByText('Answer these first (2):')).toBeInTheDocument();
    expect(within(alert).getByRole('link', { name: 'Pressure' })).toHaveAttribute('href', '#item-p');
  });

  it('signs with a typed name, finishes, and offers to mark the task it was for done', async () => {
    server.stored.set('p', { itemId: 'p', result: 'PASS', reading: '120', note: null, editedAt: '2026-10-27T08:10:00.000Z' });
    server.stored.set('v', { itemId: 'v', result: 'PASS', reading: null, note: null, editedAt: '2026-10-27T08:11:00.000Z' });
    show();
    await userEvent.click(await screen.findByRole('button', { name: 'Sign and finish' }));
    const dialog = await screen.findByRole('dialog', { name: 'Sign and finish' });
    await userEvent.click(within(dialog).getByRole('checkbox', { name: 'Type my name instead' }));
    expect(within(dialog).getByRole('textbox', { name: /Signer’s name/ })).toHaveValue('Ivan Inspector');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Sign and finish' }));
    await waitFor(() => expect(server.calls).toContain('POST /inspections/i1/finish'));
    const offer = await screen.findByRole('alertdialog', { name: 'Mark RIG-1 done?' });
    await userEvent.click(within(offer).getByRole('button', { name: 'Mark it done' }));
    await waitFor(() => expect(server.calls).toContain('PATCH /tasks/t1/move'));
  });

  it('makes follow-up tasks for a finished inspection’s failed items', async () => {
    server.stored.set('p', { itemId: 'p', result: 'PASS', reading: '120', note: null, editedAt: '2026-10-27T08:10:00.000Z' });
    server.stored.set('v', { itemId: 'v', result: 'FAIL', reading: null, note: 'Leak', editedAt: '2026-10-27T08:11:00.000Z' });
    server.detail = { ...server.detail, status: 'FINISHED', finishedAt: '2026-10-27T09:00:00.000Z', result: '1 failed', permissions: { ...server.detail.permissions, canAnswer: false, canFinish: false } };
    show();
    await userEvent.click(await screen.findByRole('button', { name: 'Create tasks for all failed items (1)' }));
    expect(await screen.findByText('Follow-up task made.')).toBeInTheDocument();
    const call = server.calls.find((c) => c === 'POST /inspections/i1/follow-ups');
    expect(call).toBeTruthy();
    expect(await screen.findByRole('link', { name: /RIG-9v/ })).toBeInTheDocument();
  });
});
