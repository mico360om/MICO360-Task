import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TaskDrawerContainer } from './TaskDrawerContainer';
import { useAuthStore } from '../stores/auth-store';
import { GUEST_WORDS } from '../lib/guest-contacts';
import { CATEGORY_WORDS } from '../lib/task-categories';

// 1.24 The task panel's guests and categories, saved on the server (replaces TaskExternalContacts' panel test).

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
const AHMED = {
  linkId: 'x1', guestId: 'g1', taskId: 't1', name: 'Ahmed Al Harthy', company: 'OXY', designation: 'Site lead', email: 'ahmed@oxy.com', phone: '+968 9912 3456', note: null, position: 0, addedById: 'u1', addedAt: '', retired: false,
};
const HUDA = { id: 'g5', companyId: 'co1', name: 'Huda Saleh', company: 'Daleel', designation: null, email: null, phone: null, notes: null, retiredAt: null, mergedIntoId: null, createdById: null, createdAt: '', updatedAt: '' };
const CATS = [
  { id: 'k1', projectId: 'p1', name: 'Electrical', color: 'indigo', position: 0, retired: false, retiredAt: null },
  { id: 'k2', projectId: 'p1', name: 'HSE', color: 'teal', position: 1, retired: false, retiredAt: null },
];

type Call = { method: string; url: string; body: unknown };
let calls: Call[];
let taskCategories: unknown[];
let requireCategory: boolean;
let reply: (method: string, url: string) => Response | undefined;
beforeEach(() => {
  calls = [];
  taskCategories = [{ id: 'k1', name: 'Electrical', color: 'indigo', retired: false }];
  requireCategory = false;
  reply = () => undefined;
  useAuthStore.getState().setSession({ user: { id: 'u1', email: 'a@b.c', username: 'ada', roles: [] }, accessToken: 'at', refreshToken: 'rt' });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      const method = init?.method ?? 'GET';
      calls.push({ method, url: u, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      const o = reply(method, u);
      if (o) return o;
      if (u.endsWith('/projects/p1/categories')) return json({ data: { requireCategory, categories: CATS, canManage: false } });
      if (u.includes('/projects/p1/guests')) return json({ data: [HUDA] });
      if (method === 'POST' && u.endsWith('/tasks/t1/guests')) return json({ data: { ...AHMED, guestId: 'g5', name: 'Huda Saleh' } }, 201);
      if (method === 'PATCH' && u.endsWith('/tasks/t1/guests/g1')) return json({ data: { ...AHMED, note: 'Call first' } });
      if (method === 'DELETE') return new Response(null, { status: 204 });
      if (method === 'PUT' && u.endsWith('/tasks/t1/categories')) return json({ data: CATS });
      if (u.includes('/assignees')) return json({ data: [{ id: 'u1', username: 'ada', email: '', firstName: 'Ada', lastName: 'L' }] });
      if (u.includes('/members')) return json({ data: [{ id: 'u1', username: 'ada', email: '', firstName: 'Ada', lastName: 'L', role: 'MEMBER' }] });
      if (u.includes('/dependencies')) return json({ data: { blockedBy: [], blocks: [] } });
      if (u.includes('/checklist')) return json({ data: { items: [], progress: 0 } });
      if (u.endsWith('/tasks/t1')) {
        return json({
          data: {
            id: 't1', key: 'MICO-1', title: 'Rig inspection', description: null, projectId: 'p1', columnId: 'c1', position: 0, priority: 'NORMAL', startDate: null, dueDate: null,
            progress: 0, completedAt: null, createdAt: '', updatedAt: '', guests: [{ id: 'g1', name: 'Ahmed Al Harthy', company: 'OXY' }], taskGuests: [AHMED], categories: taskCategories,
          },
        });
      }
      return json({ data: [] });
    }),
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function wrap() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(qc, 'invalidateQueries');
  render(
    <QueryClientProvider client={qc}>
      <TaskDrawerContainer taskId="t1" onClose={() => {}} />
    </QueryClientProvider>,
  );
  return { invalidate };
}
const ahmed = () => screen.findByRole('button', { name: 'Ahmed Al Harthy · OXY · Guest' });
const refreshed = (invalidate: ReturnType<typeof vi.spyOn>) => {
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ['task', 't1'] });
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ['task-activity', 't1'] });
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ['board'] });
};

describe('TaskDrawerContainer: guests and categories', () => {
  it('shows the task’s guests under Assigned (after the team) and its categories; no External contacts section', async () => {
    wrap();
    await ahmed();
    const box = await screen.findByRole('region', { name: CATEGORY_WORDS.heading });
    expect(within(box).getByRole('img', { name: 'Category: Electrical' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'External contacts' })).toBeNull();
    expect(calls.some((c) => c.url.endsWith('/projects/p1/categories'))).toBe(true);
  });

  it('a guest picked in the Assign control is put on the task, then the task, its history and every view refresh', async () => {
    const { invalidate } = wrap();
    await ahmed();
    await userEvent.click(screen.getByRole('button', { name: 'Add assignee' }));
    await userEvent.click(screen.getByRole('radio', { name: GUEST_WORDS.guest }));
    await userEvent.click(await screen.findByRole('option', { name: /^Huda Saleh/ }));
    await waitFor(() => expect(calls.find((c) => c.method === 'POST' && c.url.endsWith('/tasks/t1/guests'))?.body).toEqual({ guestId: 'g5' }));
    await waitFor(() => refreshed(invalidate));
  });

  it('a guest’s note is saved, and Remove guest takes them off', async () => {
    const { invalidate } = wrap();
    await userEvent.click(await ahmed());
    const dialog = screen.getByRole('dialog', { name: 'Ahmed Al Harthy' });
    await userEvent.type(within(dialog).getByRole('textbox', { name: GUEST_WORDS.note }), 'Call first');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save note' }));
    await waitFor(() => expect(calls.find((c) => c.method === 'PATCH')).toMatchObject({ url: expect.stringMatching(/\/tasks\/t1\/guests\/g1$/), body: { note: 'Call first' } }));
    await userEvent.click(within(dialog).getByRole('button', { name: GUEST_WORDS.remove }));
    await waitFor(() => expect(calls.find((c) => c.method === 'DELETE')?.url).toMatch(/\/tasks\/t1\/guests\/g1$/));
    await waitFor(() => refreshed(invalidate));
  });

  it('taking off the last team member of a task with guests: the server’s reason is shown', async () => {
    reply = (method, url) =>
      method === 'DELETE' && url.endsWith('/tasks/t1/assignees/u1') ? json({ error: { code: 'NEEDS_TEAM_MEMBER', message: GUEST_WORDS.lastTeamMember } }, 400) : undefined;
    wrap();
    await ahmed();
    await userEvent.click(await screen.findByRole('button', { name: 'Remove Ada L' }));
    expect(await screen.findByText(GUEST_WORDS.lastTeamMember)).toBeInTheDocument();
  });

  it('categories: Edit saves the task’s new set and refreshes every view; a refusal is shown', async () => {
    const { invalidate } = wrap();
    const box = await screen.findByRole('region', { name: CATEGORY_WORDS.heading });
    await userEvent.click(await within(box).findByRole('button', { name: 'Edit categories' }));
    await userEvent.click(within(box).getByRole('button', { name: 'HSE' }));
    await userEvent.click(within(box).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(calls.find((c) => c.method === 'PUT' && c.url.endsWith('/tasks/t1/categories'))?.body).toEqual({ categoryIds: ['k1', 'k2'] }));
    await waitFor(() => refreshed(invalidate));
    reply = (method, url) => (method === 'PUT' && url.endsWith('/tasks/t1/categories') ? json({ error: { code: 'VALIDATION_ERROR', message: CATEGORY_WORDS.pickOne } }, 400) : undefined);
    await userEvent.click(await within(box).findByRole('button', { name: 'Edit categories' }));
    await userEvent.click(within(box).getByRole('button', { name: 'Electrical' }));
    await userEvent.click(within(box).getByRole('button', { name: 'Save' }));
    expect(await within(box).findByText(CATEGORY_WORDS.pickOne)).toBeInTheDocument();
  });

  it('a project that asks every task for a category marks a task without one “Needs a category”', async () => {
    taskCategories = [];
    requireCategory = true;
    wrap();
    const box = await screen.findByRole('region', { name: CATEGORY_WORDS.heading });
    expect(within(box).getByText(CATEGORY_WORDS.needs)).toBeInTheDocument();
  });
});
