import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query';
import { render, screen, waitFor, within, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { InspectionPage } from './InspectionPage';
import { useAuthStore } from '../stores/auth-store';
import type { ProjectChange } from '../lib/useProjectRealtime';

// The project's live updates, driven by the tests.
const realtime = vi.hoisted(() => ({ cb: null as null | ((change: ProjectChange, payload?: { id?: string }) => void) }));
vi.mock('../lib/useProjectRealtime', () => ({
  useProjectRealtime: (_projectId: string | undefined, cb: (change: ProjectChange, payload?: { id?: string }) => void) => {
    realtime.cb = cb;
    return { live: true };
  },
}));
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
    revision: 0,
    ...over,
  };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

let server: { detail: InspectionDetail; stored: Map<string, AnswerWrite>; offline: boolean; calls: string[]; followUpStatus: Record<string, string>; project: Record<string, unknown>; finishExtra?: Record<string, unknown> };

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
        return json({ data: { ...server.detail, answers: [...server.stored.values()], taskOffer: { id: 't1', key: 'RIG-1', title: 'Inspect rig 3', doneColumnId: 'c-done' }, ...(server.finishExtra ?? {}) } });
      }
      if (method === 'PATCH' && u === '/tasks/t1/move') return json({ data: { id: 't1' } });
      if (method === 'POST' && u === '/inspections/i1/follow-ups') {
        const { itemIds } = JSON.parse(String(init!.body)) as { itemIds: string[] };
        server.detail = { ...server.detail, followUps: itemIds.map((itemId) => ({ itemId, task: { id: `t-${itemId}`, key: `RIG-9${itemId}`, title: 'Follow up', deleted: false, done: false }, pending: false })) };
        return json({
          data: itemIds.map((itemId) => {
            const status = server.followUpStatus[itemId] ?? 'created';
            return { itemId, status, task: status === 'not-failed' || status === 'pending' ? null : { id: `t-${itemId}`, key: `RIG-9${itemId}`, title: 'Follow up' } };
          }),
        });
      }
      if (u === '/projects/p1') return json({ data: server.project });
      if (u === '/projects/p1/members') return json({ data: [{ id: 'u-olivia', username: 'olivia', email: 'o@x', firstName: 'Olivia', lastName: 'Owner', role: 'MANAGER' }] });
      return json({ error: { code: 'NOT_FOUND', message: 'Not found.' } }, 404);
    }),
  );
}

let qc: QueryClient;
/** The query keys the page asked to refresh. */
const refreshed = () => (vi.mocked(qc.invalidateQueries).mock.calls as unknown as Array<[{ queryKey?: unknown[] } | undefined]>).map(([f]) => JSON.stringify(f?.queryKey ?? null));
function show() {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { networkMode: 'always' } } });
  vi.spyOn(qc, 'invalidateQueries');
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
  server = { detail: detail(), stored: new Map(), offline: false, calls: [], followUpStatus: {}, project: { id: 'p1', name: 'Rig 3 overhaul', code: 'RIG', status: 'ACTIVE', ownerId: 'u-olivia' } };
  realtime.cb = null;
  useAuthStore.getState().setSession({ user: { id: ME, email: 'ivan@x', username: 'ivan', roles: [] }, accessToken: 'at', refreshToken: 'rt' });
  stubFetch();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  onlineManager.setOnline(true);
});

/** The browser says there's no signal (as after a reload with the phone offline). */
function noSignal() {
  server.offline = true;
  vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false);
  onlineManager.setOnline(false);
}

describe('without signal, even after the page reloads', () => {
  it('opens the copy saved on this phone with the notice (not a page that never loads), and answering goes on', async () => {
    const first = show();
    await screen.findByText('Valves closed');
    first.unmount();
    noSignal();
    show();
    expect(await screen.findByText('No signal: showing the copy saved on this phone.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('radio', { name: 'Pass' }));
    expect(JSON.parse(localStorage.getItem('mico360.inspection.u-ivan.i1')!).answers.v).toMatchObject({ result: 'PASS' });
  });

  it('one never opened on this phone says so plainly, and how it works', async () => {
    noSignal();
    show();
    expect(await screen.findByRole('heading', { name: 'No signal' })).toBeInTheDocument();
    expect(screen.getByText(/hasn’t been opened on this phone yet/)).toBeInTheDocument();
    expect(screen.getByText(/keeps working without signal, even if the page reloads, once you’ve opened it here/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Loading inspection')).toBeNull();
  });
});

describe('the header', () => {
  it('links its task as “For RIG-1”, with the space kept on a touch screen (where the link is a flex box)', async () => {
    show();
    const link = await screen.findByRole('link', { name: /RIG-1/ });
    // A flex box drops the space between "For" and the key: a gap keeps them apart.
    expect(link).toHaveClass('gap-1');
    expect(link.textContent).toBe('For RIG-1');
  });
});

describe('carrying out an inspection', () => {
  it('saves each answer on the phone and sends it, then says all is sent', async () => {
    show();
    await userEvent.click(await screen.findByRole('radio', { name: 'Pass' }));
    expect(JSON.parse(localStorage.getItem('mico360.inspection.u-ivan.i1')!).answers.v).toMatchObject({ result: 'PASS' });
    await waitFor(() => expect(server.calls).toContain('PUT /inspections/i1/answers'));
    await waitFor(() => expect(screen.getByTestId('sync-state')).toHaveTextContent('All changes sent.'));
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
    await waitFor(() => expect(refreshed()).toEqual(expect.arrayContaining(['["my-tasks"]', '["board"]', '["task","t1"]'])));
  });

  it('finishing a check (a task that carries a form) says the task was completed — no offer', async () => {
    server.stored.set('p', { itemId: 'p', result: 'PASS', reading: '120', note: null, editedAt: '2026-10-27T08:10:00.000Z' });
    server.stored.set('v', { itemId: 'v', result: 'PASS', reading: null, note: null, editedAt: '2026-10-27T08:11:00.000Z' });
    server.finishExtra = { taskOffer: null, taskCompleted: { id: 't1', key: 'RIG-1', title: 'Daily rig check' } };
    show();
    await userEvent.click(await screen.findByRole('button', { name: 'Sign and finish' }));
    const dialog = await screen.findByRole('dialog', { name: 'Sign and finish' });
    await userEvent.click(within(dialog).getByRole('checkbox', { name: 'Type my name instead' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Sign and finish' }));
    expect(await screen.findByText('Finished. Task RIG-1 completed.')).toBeInTheDocument();
    expect(screen.queryByRole('alertdialog', { name: /Mark RIG-1 done/ })).toBeNull();
    expect(server.calls).not.toContain('PATCH /tasks/t1/move');
    // Every view of the task shows it done now: My Tasks, boards, the task itself, the Inspections tab.
    await waitFor(() => expect(refreshed()).toEqual(expect.arrayContaining(['["my-tasks"]', '["board"]', '["task","t1"]', '["project-inspections"]'])));
  });

  it('makes follow-up tasks for a finished inspection’s failed items', async () => {
    server.stored.set('p', { itemId: 'p', result: 'PASS', reading: '120', note: null, editedAt: '2026-10-27T08:10:00.000Z' });
    server.stored.set('v', { itemId: 'v', result: 'FAIL', reading: null, note: 'Leak', editedAt: '2026-10-27T08:11:00.000Z' });
    server.detail = { ...server.detail, status: 'FINISHED', finishedAt: '2026-10-27T09:00:00.000Z', result: '1 failed', permissions: { ...server.detail.permissions, canAnswer: false, canFinish: false } };
    show();
    await userEvent.click(await screen.findByRole('button', { name: 'Create tasks for all failed items (1)' }));
    expect(await screen.findByText('Follow-up task made: RIG-9v.')).toBeInTheDocument();
    const call = server.calls.find((c) => c === 'POST /inspections/i1/follow-ups');
    expect(call).toBeTruthy();
    expect(await screen.findByRole('link', { name: /RIG-9v/ })).toBeInTheDocument();
  });
});

const finishedDetail = (over: Partial<InspectionDetail> = {}): InspectionDetail => ({
  ...detail(),
  status: 'FINISHED',
  finishedAt: '2026-10-27T09:00:00.000Z',
  result: 'Passed',
  permissions: { ...detail().permissions, canAnswer: false, canFinish: false, canReopen: true },
  signatures: [{ role: 'INSPECTOR', name: 'Ivan Inspector', method: 'TYPED', image: null, signedAt: '2026-10-27T09:00:00.000Z' }],
  ...over,
});
const OLIVIA = { id: 'u-olivia', name: 'Olivia Owner' };

describe('follow-up tasks, item by item', () => {
  it('says what became of each: made, already had one', async () => {
    server.stored.set('p', { itemId: 'p', result: 'FAIL', reading: '162', note: null, editedAt: '2026-10-27T08:10:00.000Z' });
    server.stored.set('v', { itemId: 'v', result: 'FAIL', reading: null, note: 'Leak', editedAt: '2026-10-27T08:11:00.000Z' });
    server.detail = finishedDetail({ result: '2 failed' });
    server.followUpStatus = { p: 'exists' };
    show();
    await userEvent.click(await screen.findByRole('button', { name: 'Create tasks for all failed items (2)' }));
    expect(await screen.findByText('Follow-up tasks: Pressure: already had one (RIG-9p). Valves closed: made (RIG-9v).')).toBeInTheDocument();
    // Said once: it isn't kept on the phone after that.
    await waitFor(() => expect(localStorage.getItem('mico360.inspection.u-ivan.i1')).toBeNull());
  });

  it('one that no longer fails, or is being made by another request, says so', async () => {
    server.stored.set('p', { itemId: 'p', result: 'FAIL', reading: '162', note: null, editedAt: '2026-10-27T08:10:00.000Z' });
    server.stored.set('v', { itemId: 'v', result: 'FAIL', reading: null, note: null, editedAt: '2026-10-27T08:11:00.000Z' });
    server.detail = finishedDetail({ result: '2 failed' });
    server.followUpStatus = { p: 'not-failed', v: 'pending' };
    show();
    await userEvent.click(await screen.findByRole('button', { name: 'Create tasks for all failed items (2)' }));
    expect(await screen.findByText('Follow-up tasks: Pressure: not made, it no longer fails. Valves closed: already being made.')).toBeInTheDocument();
  });
});

describe('revisions', () => {
  it('a reopened report signed again says which revision it is, and lists the earlier signatures', async () => {
    server.detail = finishedDetail({
      revision: 1,
      reopened: { at: '2026-10-27T10:00:00.000Z', by: OLIVIA },
      earlierRevisions: [{ number: 1, reopenedAt: '2026-10-27T10:00:00.000Z', signatures: [{ role: 'INSPECTOR', name: 'Ivan Inspector', method: 'DRAWN', signedAt: '2026-10-27T09:00:00.000Z' }] }],
    });
    show();
    expect(await screen.findByText(/Revision 2 · reopened on 27 Oct 2026 by/)).toHaveTextContent('Revision 2 · reopened on 27 Oct 2026 by Olivia Owner');
    const earlier = screen.getByRole('region', { name: 'Earlier signed revisions' });
    expect(within(earlier).getByText(/Revision 1/)).toBeInTheDocument();
    expect(earlier).toHaveTextContent('Inspector: Ivan Inspector · signed 27 Oct 2026');
  });

  it('a first signing says nothing about revisions', async () => {
    server.detail = finishedDetail();
    show();
    await screen.findByRole('heading', { name: 'Signatures' });
    expect(screen.queryByText(/Revision/)).toBeNull();
    expect(screen.queryByRole('region', { name: 'Earlier signed revisions' })).toBeNull();
  });
});

describe('an archived project', () => {
  it('a report on the client page can be taken off, and says why it can’t go back', async () => {
    server.detail = finishedDetail({ clientVisible: true, projectArchived: true, permissions: { ...finishedDetail().permissions, canReopen: false, canShowToClient: true } });
    server.project = { ...server.project, status: 'ARCHIVED' };
    show();
    expect(await screen.findByText(/The project is archived/)).toHaveTextContent('The project is archived: you can take this report off the client page, but it can’t be put back.');
    expect(screen.getByRole('switch', { name: 'Show to client' })).toBeEnabled();
  });
});

describe('changed elsewhere while open', () => {
  it('refreshes when this inspection changes (not for another one)', async () => {
    show();
    await screen.findByText('Valves closed');
    const gets = () => server.calls.filter((c) => c === 'GET /inspections/i1').length;
    const before = gets();
    realtime.cb!('inspections', { id: 'other' });
    realtime.cb!('tasks');
    await new Promise((r) => setTimeout(r, 30));
    expect(gets()).toBe(before);
    server.stored.set('v', { itemId: 'v', result: 'PASS', reading: null, note: null, editedAt: '2026-10-27T08:30:00.000Z' });
    realtime.cb!('inspections', { id: 'i1' });
    await waitFor(() => expect(gets()).toBe(before + 1));
    await waitFor(() => expect(screen.getByRole('radio', { name: 'Pass' })).toBeChecked());
  });

  it('taken over by someone else: says so, and answering stops', async () => {
    show();
    await screen.findByText('Valves closed');
    server.detail = { ...detail(), inspector: OLIVIA, permissions: { ...detail().permissions, canAnswer: false, canFinish: false } };
    realtime.cb!('inspections', { id: 'i1' });
    expect(await screen.findByText(/Olivia Owner took this inspection over/)).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('radio', { name: 'Pass' })).toBeNull());
  });

  it('reopened by someone else: says so', async () => {
    server.detail = finishedDetail();
    show();
    await screen.findByRole('heading', { name: 'Signatures' });
    server.detail = { ...detail(), revision: 1, reopened: { at: '2026-10-27T10:00:00.000Z', by: OLIVIA }, earlierRevisions: [] };
    realtime.cb!('inspections', { id: 'i1' });
    expect(await screen.findByText(/Olivia Owner reopened this inspection/)).toBeInTheDocument();
  });
});
