import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ScheduleDialog } from './ScheduleDialog';
import type { InspectionSchedule } from '../../api/inspections';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const person = (id: string, firstName: string, lastName: string, username: string) => ({ id, firstName, lastName, username, email: '', avatarUrl: null });
const SUN_THU = [0, 1, 2, 3, 4];
const FORMS = [
  { id: 'f1', title: 'Rig daily check', description: null, structure: { sections: [], clientSignature: 'NONE', supervisorSignature: 'NONE' }, version: 1, sectionCount: 2, itemCount: 12, createdBy: null, updatedAt: '', canEdit: false },
  { id: 'f2', title: 'Fire extinguisher check', description: null, structure: { sections: [], clientSignature: 'NONE', supervisorSignature: 'NONE' }, version: 1, sectionCount: 1, itemCount: 4, createdBy: null, updatedAt: '', canEdit: false },
];

type Call = { url: string; method: string; body: Record<string, unknown> | null };
let calls: Call[];
beforeEach(() => {
  calls = [];
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-28T06:00:00Z')); // Wednesday 28 Oct, 10:00 in Muscat
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url).replace(/^.*\/api\/v1/, '');
      const method = init?.method ?? 'GET';
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
      calls.push({ url: u, method, body });
      if (u === '/inspection-forms') return json({ data: { forms: FORMS, canCreate: false } });
      if (u === '/projects/p1/columns') return json({ data: [
        { id: 'c-done', projectId: 'p1', name: 'Done', category: 'DONE', position: 0, color: '#16a34a', enabled: true },
        { id: 'c-off', projectId: 'p1', name: 'Parked', category: 'TODO', position: 1, color: '#64748b', enabled: false },
        { id: 'c-todo', projectId: 'p1', name: 'To do', category: 'TODO', position: 2, color: '#64748b', enabled: true },
      ] });
      if (u === '/projects/p1/members') return json({ data: [person('u-ali', 'Ali', 'Hassan', 'ali'), person('u-sara', 'Sara', 'Al Balushi', 'sara')] });
      if (u === '/users/directory') return json({ data: [] });
      if (u === '/config') return json({ data: { timeZone: 'Asia/Muscat', productName: 'x', companyName: 'y', serverTime: '' } });
      if (u === '/tasks' && method === 'POST') return json({ data: { id: 't-new', key: 'RIG-40', title: body?.title } }, 201);
      if (u === '/tasks/t-head' && method === 'PUT') return json({ data: { id: 't-head', key: 'RIG-31', ...body } });
      if (u === '/tasks/t-head/assignees' && method === 'GET') return json({ data: [person('u-ali', 'Ali', 'Hassan', 'ali')] });
      if (u.startsWith('/tasks/t-head/assignees')) return json({ data: {} });
      return json({ error: { code: 'NOT_FOUND', message: 'Not found.' } }, 404);
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function show(props: Partial<Parameters<typeof ScheduleDialog>[0]> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onClose = vi.fn();
  const onSaved = vi.fn();
  render(
    <QueryClientProvider client={qc}>
      <ScheduleDialog projectId="p1" workingDays={SUN_THU} onClose={onClose} onSaved={onSaved} {...props} />
    </QueryClientProvider>,
  );
  return { onClose, onSaved };
}
const dialog = () => screen.getByRole('dialog', { name: /Schedule an inspection|Edit schedule/ });
async function pickForm(name: RegExp) {
  await userEvent.click(within(dialog()).getByRole('button', { name: 'Form' }));
  await userEvent.click(await screen.findByRole('option', { name }));
}
async function addInspector(name: string) {
  const box = within(dialog()).getByRole('combobox', { name: 'Add inspectors' });
  await userEvent.click(box);
  await userEvent.click(await screen.findByRole('option', { name: new RegExp(name) }));
}
const post = () => calls.find((c) => c.method === 'POST' && c.url === '/tasks');

describe('the schedule dialog (new)', () => {
  it('schedules a check every working day: the name follows the form and place, the line says what will happen, and it saves as a task', async () => {
    const { onSaved, onClose } = show();
    await pickForm(/Rig daily check/);
    const name = within(dialog()).getByRole('textbox', { name: 'Name' });
    expect(name).toHaveValue('Rig daily check');
    await userEvent.type(within(dialog()).getByRole('textbox', { name: 'Place (optional)' }), 'Rig 3');
    expect(name).toHaveValue('Rig daily check – Rig 3');
    expect(within(dialog()).getByLabelText('Starts on')).toHaveValue('2026-10-28');
    await addInspector('Ali Hassan');
    await addInspector('Sara Al Balushi');
    await userEvent.click(within(dialog()).getByRole('radio', { name: 'Every working day' }));
    expect(within(dialog()).getByText('A check is created every working day, due that day, for Ali Hassan and Sara Al Balushi. The first one is due on Wed 28 Oct.')).toBeInTheDocument();
    await userEvent.click(within(dialog()).getByRole('button', { name: 'Schedule it' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(post()!.body).toEqual({
      title: 'Rig daily check – Rig 3',
      projectId: 'p1',
      columnId: 'c-todo',
      dueDate: '2026-10-28',
      recurrenceRule: { freq: 'WEEKLY', interval: 1, weekdays: SUN_THU, createNext: 'ON_SCHEDULE' },
      assigneeIds: ['u-ali', 'u-sara'],
      inspectionFormId: 'f1',
      inspectionPlace: 'Rig 3',
    });
    expect(onClose).toHaveBeenCalled();
  });

  it('every day, starting on a later day, with an end: the first check is due that day', async () => {
    show();
    await pickForm(/Fire extinguisher check/);
    await addInspector('Ali Hassan');
    fireEvent.change(within(dialog()).getByLabelText('Starts on'), { target: { value: '2026-10-30' } });
    await userEvent.click(within(dialog()).getByRole('radio', { name: 'Every day' }));
    await userEvent.selectOptions(within(dialog()).getByLabelText('Ends'), 'COUNT');
    expect(within(dialog()).getByText(/A check is created every day, 10 times, due that day, for Ali Hassan\. The first one is due on Fri 30 Oct\./)).toBeInTheDocument();
    await userEvent.click(within(dialog()).getByRole('button', { name: 'Schedule it' }));
    await waitFor(() => expect(post()).toBeTruthy());
    expect(post()!.body).toMatchObject({ title: 'Fire extinguisher check', dueDate: '2026-10-30', recurrenceRule: { freq: 'DAILY', interval: 1, createNext: 'ON_SCHEDULE', count: 10 }, inspectionPlace: null });
  });

  it('every working day starting on a day off: the first check is the next working day', async () => {
    show();
    await pickForm(/Rig daily check/);
    await addInspector('Ali Hassan');
    fireEvent.change(within(dialog()).getByLabelText('Starts on'), { target: { value: '2026-10-30' } }); // a Friday
    await userEvent.click(within(dialog()).getByRole('radio', { name: 'Every working day' }));
    expect(within(dialog()).getByText(/The first one is due on Sun 1 Nov\./)).toBeInTheDocument();
    await userEvent.click(within(dialog()).getByRole('button', { name: 'Schedule it' }));
    await waitFor(() => expect(post()).toBeTruthy());
    expect(post()!.body).toMatchObject({ dueDate: '2026-11-01' });
  });

  it('weekly on a chosen day, and a custom repeat (never the "next copy" choice: always on schedule)', async () => {
    show();
    await pickForm(/Rig daily check/);
    await addInspector('Ali Hassan');
    await userEvent.click(within(dialog()).getByRole('radio', { name: 'Weekly on…' }));
    await userEvent.click(within(dialog()).getByRole('button', { name: 'Thu' }));
    expect(within(dialog()).getByText(/every Wednesday and Thursday/)).toBeInTheDocument();
    await userEvent.click(within(dialog()).getByRole('radio', { name: 'Custom' }));
    expect(within(dialog()).queryByLabelText('Create the next copy')).toBeNull();
    await userEvent.selectOptions(within(dialog()).getByLabelText('Repeat'), 'MONTHLY');
    await userEvent.click(within(dialog()).getByRole('button', { name: 'Schedule it' }));
    await waitFor(() => expect(post()).toBeTruthy());
    expect((post()!.body!.recurrenceRule as Record<string, unknown>)).toMatchObject({ freq: 'MONTHLY', createNext: 'ON_SCHEDULE' });
  });

  it('a name typed by hand stays when the form or place changes', async () => {
    show();
    await pickForm(/Rig daily check/);
    const name = within(dialog()).getByRole('textbox', { name: 'Name' });
    await userEvent.clear(name);
    await userEvent.type(name, 'فحص الحفار اليومي');
    await userEvent.type(within(dialog()).getByRole('textbox', { name: 'Place (optional)' }), 'Rig 3');
    await pickForm(/Fire extinguisher check/);
    expect(name).toHaveValue('فحص الحفار اليومي');
    expect(name).toHaveAttribute('dir', 'auto');
  });

  it('needs a form and at least one inspector, and says so', async () => {
    show();
    await userEvent.click(within(dialog()).getByRole('button', { name: 'Schedule it' }));
    expect(within(dialog()).getByRole('alert')).toHaveTextContent('Pick a form.');
    await pickForm(/Rig daily check/);
    await userEvent.click(within(dialog()).getByRole('button', { name: 'Schedule it' }));
    expect(within(dialog()).getByRole('alert')).toHaveTextContent('Pick at least one inspector.');
    expect(post()).toBeUndefined();
  });
});

describe('the schedule dialog (edit)', () => {
  it('Save puts a schedule that waits for each check on schedule, even with nothing else changed', async () => {
    const { onSaved } = show({ schedule: { ...schedule, rule: { freq: 'DAILY', interval: 1 }, onSchedule: false, repeat: 'Repeats every day · the next one when this one is done' } });
    await screen.findByRole('list', { name: 'Inspectors' });
    await userEvent.click(within(dialog()).getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(calls.find((c) => c.method === 'PUT')!.body).toMatchObject({ recurrenceRule: { freq: 'DAILY', interval: 1, createNext: 'ON_SCHEDULE' } });
  });

  const schedule: InspectionSchedule = {
    taskId: 't-head',
    key: 'RIG-31',
    title: 'Rig daily check – Rig 3',
    form: { id: 'f1', title: 'Rig daily check', deleted: false },
    place: 'Rig 3',
    assignees: [{ id: 'u-ali', name: 'Ali Hassan' }],
    rule: { freq: 'WEEKLY', interval: 1, weekdays: SUN_THU, createNext: 'ON_SCHEDULE' },
    repeat: 'Every working day',
    onSchedule: true,
    paused: false,
    nextDue: '2026-10-29',
    lastDone: null,
    openChecks: 1,
    lateChecks: 0,
  };

  it('opens on the schedule and saves only what changed through the task API: repeat, place (the name follows), inspectors', async () => {
    const { onSaved } = show({ schedule });
    expect(within(dialog()).getByRole('textbox', { name: 'Name' })).toHaveValue('Rig daily check – Rig 3');
    expect(within(dialog()).getByRole('radio', { name: 'Every working day' })).toBeChecked();
    expect(within(dialog()).queryByLabelText('Starts on')).toBeNull();
    await screen.findByRole('list', { name: 'Inspectors' });
    const place = within(dialog()).getByRole('textbox', { name: 'Place (optional)' });
    await userEvent.clear(place);
    await userEvent.type(place, 'Rig 4');
    await userEvent.click(within(dialog()).getByRole('radio', { name: 'Every day' }));
    await addInspector('Sara Al Balushi');
    await userEvent.click(within(dialog()).getByRole('button', { name: 'Remove Ali Hassan' }));
    expect(within(dialog()).getByText('A check is created every day, due that day, for Sara Al Balushi.')).toBeInTheDocument();
    await userEvent.click(within(dialog()).getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(calls.find((c) => c.method === 'PUT')!.body).toEqual({ title: 'Rig daily check – Rig 4', inspectionPlace: 'Rig 4', recurrenceRule: { freq: 'DAILY', interval: 1, createNext: 'ON_SCHEDULE' } });
    expect(calls.find((c) => c.method === 'POST' && c.url === '/tasks/t-head/assignees')!.body).toEqual({ userIds: ['u-sara'] });
    expect(calls.some((c) => c.method === 'DELETE' && c.url === '/tasks/t-head/assignees/u-ali')).toBe(true);
  });
});
