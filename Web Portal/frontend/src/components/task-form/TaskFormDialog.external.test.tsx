// tgc: 1.24 — external contacts are guests now: the form's "External contacts" box is gone; guests are
// picked in the Assign box ("Internal user | Guest") from the company's guest list, never typed per task.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TaskFormDialog } from './TaskFormDialog';
import type { ApiTask } from '../../api/tasks';
import { useAuthStore } from '../../stores/auth-store';
import { GUEST_WORDS } from '../../lib/guest-contacts';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const PROJECTS = [
  { id: 'p1', code: 'MICO', name: 'MICO360 Platform', status: 'ACTIVE', color: '#1E5A8B', icon: null, ownerId: 'u9', clientName: null, mainCompanyId: 'co1' },
  { id: 'p2', code: 'OPS', name: 'Ops Board', status: 'ACTIVE', color: '#0F766E', icon: null, ownerId: null, clientName: null, mainCompanyId: 'co2' },
  { id: 'p3', code: 'RIG', name: 'Rig Works', status: 'ACTIVE', color: '#0F766E', icon: null, ownerId: null, clientName: null, mainCompanyId: 'co1' },
];
const column = (project: string) => [{ id: `${project}-c1`, projectId: project, name: 'Backlog', category: 'TODO', position: 0, color: '#64748b', enabled: true }];
const person = (id: string, firstName: string, lastName: string) => ({ id, firstName, lastName, username: firstName.toLowerCase(), email: '', avatarUrl: null });
const MEMBERS = [person('u1', 'Mona', 'Owner'), person('u9', 'Omar', 'Ahmed')];
const guest = (id: string, name: string, company: string | null, extra: Record<string, unknown> = {}) => ({
  id, companyId: 'co1', name, company, designation: null, email: null, phone: null, notes: null, retiredAt: null, mergedIntoId: null, createdById: 'u1', createdAt: '', updatedAt: '', ...extra,
});
const AHMED = guest('g1', 'Ahmed Al Harthy', 'Acme', { email: 'ahmed@acme.com' });
const SARA = guest('g2', 'Sara Nasser', 'NWT');
const LISTS: Record<string, ReturnType<typeof guest>[]> = { p1: [AHMED, SARA], p3: [AHMED, SARA], p2: [guest('g7', 'Sara Nasser', 'NWT', { companyId: 'co2' })] };
const taskGuest = (g: ReturnType<typeof guest>, linkId: string) => ({
  linkId, guestId: g.id, taskId: 't1', name: g.name, company: g.company, designation: g.designation, email: g.email, phone: g.phone, note: null, position: 0, addedById: 'u1', addedAt: '', retired: false,
});
const TASK = {
  id: 't1', key: 'MICO-12', title: 'Rig inspection', description: '', projectId: 'p1', columnId: 'p1-c1', columnCategory: 'TODO', position: 0, priority: 'NORMAL',
  startDate: null, dueDate: null, progress: 0, completedAt: null, createdAt: '', updatedAt: '', version: 3, recurrenceRule: null, recurrenceParentId: null, recurrenceNextId: null,
  guests: [{ id: 'g1', name: 'Ahmed Al Harthy', company: 'Acme' }],
  taskGuests: [taskGuest(AHMED, 'x1')],
} as unknown as ApiTask;

type Call = { url: string; method: string; body: Record<string, unknown> | null };
let calls: Call[];
beforeEach(() => {
  localStorage.clear();
  calls = [];
  useAuthStore.getState().setSession({ user: { id: 'u1', email: 'm@x', username: 'mona', roles: [] }, accessToken: 'at', refreshToken: 'rt' });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      const method = init?.method ?? 'GET';
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
      calls.push({ url: u, method, body });
      const cols = /\/projects\/(p\d)\/columns/.exec(u);
      if (cols) return json({ data: column(cols[1]!) });
      if (/\/projects\/p\d\/members/.test(u)) return json({ data: MEMBERS });
      if (/\/projects\/p\d\/guests\/check/.test(u)) return json({ data: { same: String(body?.name).startsWith('Ahmed') ? [AHMED] : [], similar: [] } });
      const list = /\/projects\/(p\d)\/guests(?:\?q=(.*))?$/.exec(u);
      if (list && method === 'GET') {
        const q = decodeURIComponent(list[2] ?? '').toLowerCase();
        return json({ data: (LISTS[list[1]!] ?? []).filter((g) => !q || g.name.toLowerCase().includes(q) || (g.company ?? '').toLowerCase().includes(q)) });
      }
      if (u.endsWith('/projects')) return json({ data: PROJECTS });
      if (u.endsWith('/users/directory')) return json({ data: MEMBERS });
      if (u.endsWith('/config')) return json({ data: { timeZone: 'Asia/Muscat', productName: 'x', companyName: 'y', serverTime: '' } });
      if (u.endsWith('/tasks') && method === 'POST') return json({ data: { id: 't99', key: 'MICO-9', title: body?.title, projectId: body?.projectId, columnId: body?.columnId } }, 201);
      if (u.endsWith('/tasks/t1/assignees') && method === 'GET') return json({ data: [person('u9', 'Omar', 'Ahmed')] });
      if (/\/tasks\/t1$/.test(u) && method === 'PUT') return json({ data: { ...TASK, ...body, version: 4 } });
      if (u.endsWith('/tasks/t1/guests') && method === 'POST') return json({ data: taskGuest(SARA, 'x9') }, 201);
      if (/\/tasks\/t1\/(guests|assignees)\/\w+$/.test(u) && method === 'DELETE') return new Response(null, { status: 204 });
      if (u.endsWith('/tasks/t1/assignees') && method === 'POST') return json({ data: [] });
      return json({ data: [] });
    }),
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function renderDialog(props: Partial<React.ComponentProps<typeof TaskFormDialog>> = {}) {
  const onClose = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <TaskFormDialog onClose={onClose} {...props} />
    </QueryClientProvider>,
  );
  return { onClose };
}
const ready = () => waitFor(() => expect(screen.getByRole('button', { name: 'Column' })).toHaveTextContent('Backlog'));
const chips = () => within(screen.getByRole('list', { name: 'Assigned people' })).getAllByRole('listitem');
async function pickGuest(name: RegExp) {
  await userEvent.click(screen.getByRole('radio', { name: GUEST_WORDS.guest }));
  await userEvent.click(screen.getByRole('combobox', { name: GUEST_WORDS.search }));
  await userEvent.click(await screen.findByRole('option', { name: name }));
}

describe('Task form: guests in the Assign box', () => {
  it('switches between Internal user and Guest; a picked guest shows after the team members with a Guest badge, and the signed-in person is added to look after them', async () => {
    renderDialog({ projectId: 'p1' });
    await ready();
    const mode = screen.getByRole('radiogroup', { name: GUEST_WORDS.modeLabel });
    expect(within(mode).getByRole('radio', { name: GUEST_WORDS.internal })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('combobox', { name: 'Add people' })).toBeInTheDocument();
    await userEvent.click(within(mode).getByRole('radio', { name: GUEST_WORDS.guest }));
    expect(screen.queryByRole('combobox', { name: 'Add people' })).toBeNull();
    await userEvent.click(screen.getByRole('combobox', { name: GUEST_WORDS.search }));
    await userEvent.click(await screen.findByRole('option', { name: /^Ahmed Al Harthy \(Acme\)/ }));
    const [first, second] = chips();
    expect(first).toHaveTextContent('Mona Owner');
    expect(second).toHaveTextContent('Ahmed Al Harthy · Acme');
    expect(within(second!).getByText(GUEST_WORDS.badge)).toBeInTheDocument();
    // Back to the team: the people search again.
    await userEvent.click(within(mode).getByRole('radio', { name: GUEST_WORDS.internal }));
    expect(screen.getByRole('combobox', { name: 'Add people' })).toBeInTheDocument();
  });

  it('a new task is created with its guests (by id) and its team members', async () => {
    const { onClose } = renderDialog({ projectId: 'p1' });
    await ready();
    await userEvent.type(screen.getByLabelText(/^Task title/), 'Rig inspection');
    await pickGuest(/^Ahmed Al Harthy/);
    await userEvent.click(screen.getByRole('combobox', { name: GUEST_WORDS.search }));
    await userEvent.click(await screen.findByRole('option', { name: /^Sara Nasser/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Create task' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    const create = calls.find((c) => c.method === 'POST' && c.url.endsWith('/tasks'))!;
    expect(create.body?.guests).toEqual([{ guestId: 'g1' }, { guestId: 'g2' }]);
    expect(create.body?.assigneeIds).toEqual(['u1']);
    expect(create.body).not.toHaveProperty('externalContacts');
  });

  it('saving with guests and no team member is blocked in the form', async () => {
    renderDialog({ projectId: 'p1' });
    await ready();
    await userEvent.type(screen.getByLabelText(/^Task title/), 'Rig inspection');
    await pickGuest(/^Ahmed Al Harthy/);
    await userEvent.click(screen.getByRole('button', { name: 'Remove Mona Owner' }));
    await userEvent.click(screen.getByRole('button', { name: 'Create task' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(GUEST_WORDS.needsTeam);
    expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/tasks'))).toBe(false);
    // The guest taken off again: nothing in the way.
    await userEvent.click(screen.getByRole('button', { name: 'Remove Ahmed Al Harthy (Acme)' }));
    expect(screen.queryByText(GUEST_WORDS.needsTeam)).toBeNull();
  });

  it('a new guest typed in the form: the same person on the list is offered, and Use them picks them', async () => {
    renderDialog({ projectId: 'p1' });
    await ready();
    await userEvent.click(screen.getByRole('radio', { name: GUEST_WORDS.guest }));
    await userEvent.click(screen.getByRole('button', { name: GUEST_WORDS.newGuest }));
    const form = screen.getByRole('group', { name: GUEST_WORDS.newGuest });
    await userEvent.type(within(form).getByRole('textbox', { name: /^Name/ }), 'Ahmed Al Harthy');
    await userEvent.click(await within(form).findByRole('button', { name: GUEST_WORDS.useThem }));
    expect(chips().map((li) => li.textContent)).toEqual([expect.stringContaining('Mona Owner'), expect.stringContaining('Ahmed Al Harthy · Acme')]);
    expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/projects/p1/guests'))).toBe(false);
  });

  it('editing applies the guest changes after the task save: team members added first, then guests added and removed, team members removed last', async () => {
    const { onClose } = renderDialog({ task: TASK });
    await ready();
    await waitFor(() => expect(chips().map((li) => li.textContent)).toEqual([expect.stringContaining('Omar Ahmed'), expect.stringContaining('Ahmed Al Harthy · Acme')]));
    // Team: Mona in, Omar out. Guests: Sara in, Ahmed out.
    const people = screen.getByRole('combobox', { name: 'Add people' });
    await userEvent.click(people);
    await userEvent.type(people, 'Mon');
    await userEvent.click(await screen.findByRole('option', { name: /Mona Owner/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Remove Omar Ahmed' }));
    await userEvent.click(screen.getByRole('button', { name: 'Remove Ahmed Al Harthy (Acme)' }));
    await pickGuest(/^Sara Nasser/);
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    const writes = calls.filter((c) => c.method !== 'GET' && /\/tasks\/t1\/(assignees|guests)/.test(c.url)).map((c) => [c.method, c.url.replace(/^.*\/api\/v1/, ''), c.body]);
    expect(writes).toEqual([
      ['POST', '/tasks/t1/assignees', { userIds: ['u1'] }],
      ['POST', '/tasks/t1/guests', { guestId: 'g2' }],
      ['DELETE', '/tasks/t1/guests/g1', null],
      ['DELETE', '/tasks/t1/assignees/u9', null],
    ]);
  });

  it('changing the project: guests on the new project’s company list stay, the others are taken off with a note', async () => {
    renderDialog({ defaultProjectId: 'p1' });
    await ready();
    await pickGuest(/^Ahmed Al Harthy/);
    // The same company: nothing to check.
    await userEvent.click(screen.getByRole('button', { name: 'Project' }));
    await userEvent.click(await screen.findByRole('option', { name: /Rig Works/ }));
    await ready();
    expect(screen.getByRole('button', { name: 'Remove Ahmed Al Harthy (Acme)' })).toBeInTheDocument();
    // Another company's project, whose list hasn't got them.
    await userEvent.click(screen.getByRole('button', { name: 'Project' }));
    await userEvent.click(await screen.findByRole('option', { name: /Ops Board/ }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Remove Ahmed Al Harthy (Acme)' })).toBeNull());
    expect(screen.getByText(/Ahmed Al Harthy \(Acme\) isn’t on Ops Board’s guest list/)).toBeInTheDocument();
    expect(calls.some((c) => /\/projects\/p2\/guests\?q=Ahmed/.test(c.url))).toBe(true);
    expect(calls.some((c) => /\/projects\/p3\/guests\?q=Ahmed/.test(c.url))).toBe(false);
  });

  it('a task from a server without guests (older) offers no Guest switch when edited', async () => {
    renderDialog({ task: { ...TASK, guests: undefined, taskGuests: undefined } as unknown as ApiTask });
    await ready();
    expect(screen.queryByRole('radiogroup', { name: GUEST_WORDS.modeLabel })).toBeNull();
    expect(screen.queryByRole('group', { name: 'External contacts' })).toBeNull();
  });
});
