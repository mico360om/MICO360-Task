import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { ProjectInspectionsTab } from './ProjectInspectionsTab';
import { useAuthStore } from '../../stores/auth-store';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const item = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  projectId: 'p1',
  title: 'Rig daily check',
  status: 'IN_PROGRESS',
  place: 'Rig 3',
  startedAt: '2026-10-27T08:00:00.000Z',
  finishedAt: null,
  inspector: { id: 'u-ivan', name: 'Ivan Inspector' },
  counts: { total: 3, answered: 1, passed: 1, failed: 0, na: 0 },
  result: '1 of 3 answered',
  clientVisible: false,
  task: null,
  ...over,
});

let calls: Array<{ method: string; url: string; body?: unknown }>;
let list: { inspections: unknown[]; canStart: boolean };
let forms: { forms: unknown[]; canCreate: boolean };

beforeEach(() => {
  calls = [];
  localStorage.clear();
  list = {
    inspections: [
      item('a'),
      item('b', { title: 'Deck check', status: 'FINISHED', finishedAt: '2026-10-26T10:00:00.000Z', result: '2 failed', counts: { total: 5, answered: 5, passed: 3, failed: 2, na: 0 }, clientVisible: true, task: { id: 't1', key: 'RIG-1', title: 'Inspect deck', done: false } }),
    ],
    canStart: true,
  };
  forms = { forms: [{ id: 'f1', title: 'Rig daily check', description: null, structure: { sections: [], clientSignature: 'NONE', supervisorSignature: 'NONE' }, version: 1, sectionCount: 2, itemCount: 3, createdBy: null, updatedAt: '', canEdit: false }], canCreate: false };
  useAuthStore.getState().setSession({ user: { id: 'u-ivan', email: 'i@x', username: 'ivan', roles: [] }, accessToken: 'at', refreshToken: 'rt' });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url).replace(/^.*\/api\/v1/, '');
      const method = init?.method ?? 'GET';
      calls.push({ method, url: u, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (u === '/projects/p1/inspections' && method === 'GET') return json({ data: list });
      if (u === '/inspection-forms') return json({ data: forms });
      if (u === '/projects/p1/inspections' && method === 'POST') return json({ data: { ...item('new'), structure: { sections: [], clientSignature: 'NONE', supervisorSignature: 'NONE' }, answers: [] } }, 201);
      return json({ error: { code: 'NOT_FOUND', message: 'Not found.' } }, 404);
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function show(props: Partial<Parameters<typeof ProjectInspectionsTab>[0]> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/projects/p1?tab=inspections']}>
        <Routes>
          <Route path="/projects/:id" element={<ProjectInspectionsTab projectId="p1" tasks={[{ id: 't1', key: 'RIG-1', title: 'Inspect rig 3' }]} {...props} />} />
          <Route path="/inspections/:id" element={<p>Opened inspection</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('a project’s Inspections tab', () => {
  it('lists inspections in progress and finished ones with their result', async () => {
    show();
    const inProgress = await screen.findByRole('region', { name: 'In progress (1)' });
    expect(within(inProgress).getByRole('link', { name: /Rig daily check/ })).toHaveAttribute('href', '/inspections/a');
    expect(within(inProgress).getByText('1 of 3 answered')).toBeInTheDocument();
    const finished = screen.getByRole('region', { name: 'Finished (1)' });
    expect(within(finished).getByText('2 failed')).toBeInTheDocument();
    expect(within(finished).getByText('Visible to client')).toBeInTheDocument();
    expect(within(finished).getByText('RIG-1')).toBeInTheDocument();
  });

  it('starts one from a form, for a task and a place, then opens it', async () => {
    show();
    await userEvent.click(await screen.findByRole('button', { name: 'Start an inspection' }));
    const dialog = await screen.findByRole('dialog', { name: 'Start an inspection' });
    await userEvent.click(within(dialog).getByRole('radio', { name: /Rig daily check/ }));
    await userEvent.selectOptions(within(dialog).getByRole('combobox', { name: 'For a task (optional)' }), 't1');
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Place (optional)' }), 'North deck');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Start' }));
    await screen.findByText('Opened inspection');
    expect(calls.find((c) => c.method === 'POST')!.body).toEqual({ formId: 'f1', taskId: 't1', place: 'North deck' });
  });

  it('says when there are no forms yet, and where they are made', async () => {
    forms = { forms: [], canCreate: true };
    show();
    await userEvent.click(await screen.findByRole('button', { name: 'Start an inspection' }));
    expect(await screen.findByText(/No inspection forms yet/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Make a form' })).toHaveAttribute('href', '/templates?tab=inspections');
  });

  it('can’t start one on an archived project', async () => {
    list = { ...list, canStart: false };
    show();
    await screen.findByRole('region', { name: 'In progress (1)' });
    expect(screen.queryByRole('button', { name: 'Start an inspection' })).toBeNull();
  });

  it('says which of its inspections have changes waiting on this phone', async () => {
    localStorage.setItem(
      'mico360.inspection.u-ivan.a',
      JSON.stringify({ v: 1, ownerId: 'u-ivan', inspectionId: 'a', projectId: 'p1', title: 'Rig daily check', snapshot: { ...item('a'), structure: { sections: [], clientSignature: 'NONE', supervisorSignature: 'NONE' }, answers: [] }, answers: { x: { itemId: 'x', result: 'PASS', reading: null, note: null, editedAt: '2026-10-27T08:00:00.000Z' } }, finish: null, followUps: {}, problem: null, savedAt: '', sentAt: null }),
    );
    show();
    expect(await screen.findByText('1 inspection has changes saved on this phone, waiting to be sent: Rig daily check.')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('region', { name: 'In progress (1)' })).toBeInTheDocument());
  });
});
