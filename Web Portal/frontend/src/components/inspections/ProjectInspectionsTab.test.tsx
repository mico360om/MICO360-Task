import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { INSPECTION_FORMS_PATH, ProjectInspectionsTab } from './ProjectInspectionsTab';
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
let schedules: { schedules: unknown[]; workingDays: number[] };
let checks: { checks: unknown[]; total: number };
const FORM_REF = { id: 'f1', title: 'Rig daily check', deleted: false };
const ALI = { id: 'u-ali', name: 'Ali Hassan' };
const SARA = { id: 'u-sara', name: 'Sara Al Balushi' };
const check = (taskId: string, over: Record<string, unknown> = {}) => ({ taskId, key: `RIG-${taskId}`, title: 'Daily rig check – Rig 3', dueDate: '2026-10-28', state: 'DUE', daysLate: 0, scheduled: true, form: FORM_REF, place: 'Rig 3', assignees: [ALI], inProgress: null, ...over });
const SCHEDULE = {
  taskId: 't-head',
  key: 'RIG-31',
  title: 'Daily rig check – Rig 3',
  form: FORM_REF,
  place: 'Rig 3',
  assignees: [ALI, SARA],
  rule: { freq: 'WEEKLY', interval: 1, weekdays: [0, 1, 2, 3, 4], createNext: 'ON_SCHEDULE' },
  repeat: 'Every working day',
  onSchedule: true,
  paused: false,
  nextDue: '2026-10-29',
  lastDone: '2026-10-27T05:00:00.000Z',
  openChecks: 2,
  lateChecks: 1,
};

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
  schedules = { schedules: [], workingDays: [0, 1, 2, 3, 4] };
  checks = { checks: [], total: 0 };
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
      if (u === '/projects/p1/inspection-schedules') return json({ data: schedules });
      if (u === '/projects/p1/inspection-checks?state=open') return json({ data: checks });
      if (u === '/tasks/t-head' && method === 'PUT') return json({ data: { id: 't-head' } });
      if (u === '/config') return json({ data: { timeZone: 'Asia/Muscat', productName: 'x', companyName: 'y', serverTime: '' } });
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
    expect(screen.getByRole('link', { name: 'Make a form' })).toHaveAttribute('href', INSPECTION_FORMS_PATH);
  });

  it('offers “Manage forms” to whoever can make forms: in the tab and when starting one', async () => {
    forms = { ...forms, canCreate: true };
    show();
    await screen.findByRole('region', { name: 'In progress (1)' });
    expect(await screen.findByRole('link', { name: 'Manage forms' })).toHaveAttribute('href', INSPECTION_FORMS_PATH);
    await userEvent.click(screen.getByRole('button', { name: 'Start an inspection' }));
    const dialog = await screen.findByRole('dialog', { name: 'Start an inspection' });
    expect(await within(dialog).findByRole('link', { name: 'Manage forms' })).toHaveAttribute('href', INSPECTION_FORMS_PATH);
  });

  it('no “Manage forms” for someone who can’t make forms', async () => {
    show();
    await screen.findByRole('region', { name: 'In progress (1)' });
    await userEvent.click(screen.getByRole('button', { name: 'Start an inspection' }));
    await within(await screen.findByRole('dialog', { name: 'Start an inspection' })).findByRole('radio', { name: /Rig daily check/ });
    expect(screen.queryByRole('link', { name: 'Manage forms' })).toBeNull();
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

  it('a finished check done after its day says so, with how late', async () => {
    list = { ...list, inspections: [item('c', { status: 'FINISHED', finishedAt: '2026-10-28T10:00:00.000Z', result: 'Passed', counts: { total: 3, answered: 3, passed: 3, failed: 0, na: 0 }, task: { id: 't7', key: 'RIG-7', title: 'Daily rig check', done: true, lateDays: 2 } }), item('d', { status: 'FINISHED', finishedAt: '2026-10-28T10:00:00.000Z', result: 'Passed', counts: { total: 3, answered: 3, passed: 3, failed: 0, na: 0 }, task: { id: 't8', key: 'RIG-8', title: 'On time', done: true, lateDays: 0 } })] };
    show();
    const finished = await screen.findByRole('region', { name: 'Finished (2)' });
    expect(within(finished).getAllByText(/Done late/)).toHaveLength(1);
    expect(within(finished).getByText('Done late · 2 days')).toBeInTheDocument();
  });
});

describe('scheduled inspections on the Inspections tab', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-28T06:00:00Z')); // Wednesday 28 Oct in Muscat
  });
  afterEach(() => vi.useRealTimers());

  it('lists due checks late first, in the danger colour with how late, then today and upcoming', async () => {
    checks = {
      total: 3,
      checks: [
        check('1', { dueDate: '2026-10-26', state: 'LATE', daysLate: 2 }),
        check('2', { dueDate: '2026-10-28', place: 'الحفار ٣', inProgress: { inspectionId: 'i9', inspector: SARA } }),
        check('3', { dueDate: '2026-11-02', scheduled: false, form: { id: 'f-old', title: 'Old deck check', deleted: true } }),
      ],
    };
    show();
    const due = await screen.findByRole('region', { name: 'Due checks (3)' });
    const rows = within(due).getAllByRole('listitem');
    expect(rows.map((r) => r.textContent)).toEqual([expect.stringMatching(/2 days late/), expect.stringMatching(/Due today/), expect.stringMatching(/Due Mon 2 Nov/)]);
    expect(within(rows[0]!).getByText('2 days late').className).toMatch(/text-danger/);
    expect(within(rows[1]!).getByText('الحفار ٣')).toHaveAttribute('dir', 'auto');
    expect(rows[1]).toHaveTextContent('Sara Al Balushi is doing it');
    expect(within(rows[1]!).getByRole('link', { name: /^Continue/ })).toHaveAttribute('href', '/inspections/i9');
    expect(within(rows[2]!).getByText(/Form deleted — this check can still be done/)).toBeInTheDocument();
  });

  it('Start starts the check with its form, place and task, and opens it', async () => {
    checks = { total: 1, checks: [check('1', { dueDate: '2026-10-26', state: 'LATE', daysLate: 2 })] };
    show();
    const due = await screen.findByRole('region', { name: 'Due checks (1)' });
    await userEvent.click(within(due).getByRole('button', { name: /^Start/ }));
    await screen.findByText('Opened inspection');
    expect(calls.find((c) => c.method === 'POST')!.body).toEqual({ formId: 'f1', taskId: '1', place: 'Rig 3' });
  });

  it('a check’s name opens the task', async () => {
    checks = { total: 1, checks: [check('1')] };
    const onOpenTask = vi.fn();
    show({ onOpenTask });
    const due = await screen.findByRole('region', { name: 'Due checks (1)' });
    await userEvent.click(within(due).getByRole('button', { name: 'Daily rig check – Rig 3' }));
    expect(onOpenTask).toHaveBeenCalledWith('1');
  });

  it('says when no checks are due', async () => {
    show();
    const due = await screen.findByRole('region', { name: 'Due checks (0)' });
    expect(within(due).getByText(/No checks are due/)).toBeInTheDocument();
  });

  it('lists schedules with their form, place, inspectors, repeat, next due, last done and late count', async () => {
    schedules = { ...schedules, schedules: [SCHEDULE] };
    show();
    const region = await screen.findByRole('region', { name: 'Schedules (1)' });
    const [row] = within(region).getAllByRole('listitem');
    expect(row).toHaveTextContent('Daily rig check – Rig 3');
    expect(row).toHaveTextContent('Rig daily check');
    expect(row).toHaveTextContent('Every working day');
    expect(row).toHaveTextContent('Next due Thu 29 Oct');
    expect(row).toHaveTextContent('Last done 27 Oct 2026');
    expect(within(row!).getByText('1 late').className).toMatch(/text-danger/);
    expect(within(row!).getByLabelText('Inspectors: Ali Hassan and Sara Al Balushi')).toBeInTheDocument();
  });

  it('an older schedule that waits for each check says so (no next day while one is open)', async () => {
    schedules = { ...schedules, schedules: [{ ...SCHEDULE, rule: { freq: 'DAILY', interval: 1 }, onSchedule: false, repeat: 'Repeats every day · the next one when this one is done', nextDue: null }] };
    show();
    const region = await screen.findByRole('region', { name: 'Schedules (1)' });
    const [row] = within(region).getAllByRole('listitem');
    expect(row).toHaveTextContent('Repeats every day · the next one when this one is done');
    expect(row).not.toHaveTextContent('No more checks');
  });

  it('Stop asks first, then stops the repeat (the checks already made stay)', async () => {
    schedules = { ...schedules, schedules: [SCHEDULE] };
    show();
    const region = await screen.findByRole('region', { name: 'Schedules (1)' });
    await userEvent.click(within(region).getByRole('button', { name: /^Stop/ }));
    const confirm = await screen.findByRole('alertdialog', { name: 'Stop scheduling?' });
    expect(confirm).toHaveTextContent('Checks already created stay.');
    await userEvent.click(within(confirm).getByRole('button', { name: 'Stop scheduling' }));
    await waitFor(() => expect(calls.find((c) => c.method === 'PUT')).toBeTruthy());
    expect(calls.find((c) => c.method === 'PUT')).toMatchObject({ url: '/tasks/t-head', body: { recurrenceRule: null } });
  });

  it('Schedule an inspection and Edit open the schedule dialog', async () => {
    schedules = { ...schedules, schedules: [SCHEDULE] };
    show();
    const region = await screen.findByRole('region', { name: 'Schedules (1)' });
    await userEvent.click(within(region).getByRole('button', { name: /^Edit/ }));
    expect(await screen.findByRole('dialog', { name: 'Edit schedule' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await userEvent.click(screen.getByRole('button', { name: 'Schedule an inspection' }));
    expect(await screen.findByRole('dialog', { name: 'Schedule an inspection' })).toBeInTheDocument();
  });

  it('an archived project: nothing to start or schedule', async () => {
    list = { ...list, canStart: false };
    schedules = { ...schedules, schedules: [SCHEDULE] };
    checks = { total: 1, checks: [check('1')] };
    show();
    await screen.findByRole('region', { name: 'Schedules (1)' });
    expect(screen.queryByRole('button', { name: 'Schedule an inspection' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Start/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Stop/ })).toBeNull();
  });

  it('“Schedules” says when there are none, and how to make one', async () => {
    show();
    const region = await screen.findByRole('region', { name: 'Schedules (0)' });
    expect(within(region).getByText(/No schedules yet/)).toBeInTheDocument();
  });
});
