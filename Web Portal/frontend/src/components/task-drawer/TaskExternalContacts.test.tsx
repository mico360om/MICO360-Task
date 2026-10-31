import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TaskExternalContacts } from './TaskExternalContacts';
import { TaskDrawerContainer } from '../TaskDrawerContainer';
import { useAuthStore } from '../../stores/auth-store';
import type { ApiExternalContact } from '../../api/external-contacts';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const ahmed: ApiExternalContact = {
  id: 'x1', taskId: 't1', name: 'Ahmed Al Said', company: 'OXY', designation: 'Site lead', email: 'ahmed@oxy.com', phone: '+968 9912 3456', remarks: null,
  position: 0, createdById: 'u1', createdAt: '', updatedAt: '',
};

let calls: { method: string; url: string; body: unknown }[];
beforeEach(() => {
  calls = [];
  useAuthStore.getState().setSession({ user: { id: 'u1', email: 'a@b.c', username: 'ada', roles: [] }, accessToken: 'at', refreshToken: 'rt' });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      const method = init?.method ?? 'GET';
      calls.push({ method, url: u, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (u.includes('/projects/p1/external-contacts')) return json({ data: [{ name: 'Sara Nasser', company: 'PDO', designation: null, email: 'sara@pdo.co.om', phone: null, remarks: null }] });
      if (method === 'POST' && u.endsWith('/tasks/t1/external-contacts')) return json({ data: { ...ahmed, id: 'x2', name: 'Sara Nasser' } }, 201);
      if (method === 'DELETE') return new Response(null, { status: 204 });
      if (method === 'PUT') return json({ data: { ...ahmed, ...(init?.body ? JSON.parse(String(init.body)) : {}) } });
      if (u.includes('/dependencies')) return json({ data: { blockedBy: [], blocks: [] } });
      if (u.includes('/checklist')) return json({ data: { items: [], progress: 0 } });
      if (u.endsWith('/tasks/t1')) {
        return json({ data: { id: 't1', key: 'MICO-1', title: 'Rig inspection', description: null, projectId: 'p1', columnId: 'c1', position: 0, priority: 'NORMAL', startDate: null, dueDate: null, progress: 0, completedAt: null, createdAt: '', updatedAt: '', externalContacts: [ahmed] } });
      }
      return json({ data: [] });
    }),
  );
});
afterEach(() => vi.restoreAllMocks());

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(qc, 'invalidateQueries');
  return { invalidate, ...render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>) };
}

describe('TaskExternalContacts (the task panel’s contacts, saved on the server)', () => {
  it('adds a contact picked from the project’s earlier ones, then refreshes the task and every view of it', async () => {
    const { invalidate } = wrap(<TaskExternalContacts taskId="t1" projectId="p1" contacts={[ahmed]} />);
    await userEvent.click(screen.getByRole('button', { name: 'Add a contact' }));
    await userEvent.type(screen.getByRole('combobox', { name: /^Name/ }), 'Sa');
    await userEvent.click(await screen.findByRole('option', { name: 'Sara Nasser · PDO' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
    expect(calls.find((c) => c.url.includes('/projects/p1/external-contacts'))?.url).toMatch(/\?q=Sa$/);
    expect(calls.find((c) => c.method === 'POST')).toMatchObject({
      url: expect.stringMatching(/\/tasks\/t1\/external-contacts$/),
      body: { name: 'Sara Nasser', company: 'PDO', designation: null, email: 'sara@pdo.co.om', phone: null, remarks: null },
    });
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ['task', 't1'] }));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['task-activity', 't1'] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['board'] });
  });

  it('a change sends only the fields changed, so someone else’s change to another field stays', async () => {
    wrap(<TaskExternalContacts taskId="t1" projectId="p1" contacts={[ahmed]} />);
    await userEvent.click(screen.getByRole('button', { name: 'Edit Ahmed Al Said' }));
    const company = screen.getByLabelText('Company');
    await userEvent.clear(company);
    await userEvent.type(company, 'Occidental{Enter}');
    await waitFor(() => expect(calls.find((c) => c.method === 'PUT')?.url).toMatch(/\/external-contacts\/x1$/));
    expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({ company: 'Occidental' });
  });

  it('removes a contact after asking', async () => {
    wrap(<TaskExternalContacts taskId="t1" projectId="p1" contacts={[ahmed]} />);
    await userEvent.click(screen.getByRole('button', { name: 'Remove Ahmed Al Said' }));
    await userEvent.click(within(screen.getByRole('group', { name: 'Remove this contact?' })).getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(calls.find((c) => c.method === 'DELETE')?.url).toMatch(/\/external-contacts\/x1$/));
  });

  it('a contact someone else removed meanwhile: says so and refreshes the task, so it goes', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ error: { code: 'NOT_FOUND', message: 'This contact isn’t on the task any more. Someone may have removed it.' } }, 404)));
    const { invalidate } = wrap(<TaskExternalContacts taskId="t1" projectId="p1" contacts={[ahmed]} />);
    await userEvent.click(screen.getByRole('button', { name: 'Remove Ahmed Al Said' }));
    await userEvent.click(within(screen.getByRole('group', { name: 'Remove this contact?' })).getByRole('button', { name: 'Remove' }));
    expect(await screen.findByText('This contact isn’t on the task any more. Someone may have removed it.')).toBeInTheDocument();
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['task', 't1'] });
  });

  it('the task panel shows the task’s contacts under its details', async () => {
    wrap(<TaskDrawerContainer taskId="t1" onClose={() => {}} />);
    const section = await screen.findByRole('region', { name: 'External contacts' });
    expect(within(section).getByText('Ahmed Al Said')).toBeInTheDocument();
    expect(within(section).getByRole('link', { name: /ahmed@oxy\.com/ })).toHaveAttribute('href', 'mailto:ahmed@oxy.com');
  });
});
