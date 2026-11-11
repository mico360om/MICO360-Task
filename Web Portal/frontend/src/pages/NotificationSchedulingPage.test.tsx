import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { NotificationSchedulingPage } from './NotificationSchedulingPage';
import { POLICY_KINDS, type CompanyNotificationSettings, type NotificationPolicy } from '../api/notification-settings';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const policy = (): NotificationPolicy => ({
  remindersOn: { dueSoon: true, overdue: true, escalation: true, escalationAdmin: true, approvalWaiting: true, inactivity: true },
  required: ['escalation', 'escalationAdmin', 'approvalWaiting'],
  escalation: { step1Days: 3, step2Days: 5, admins: true, userIds: [] },
  approvals: { step1Days: 2, step2Days: 5 },
  inactivity: { assigneeDays: 5, managerDays: 10 },
  quietHours: { mode: 'workingHours', start: '18:00', end: '07:00', meetings: true, mentions: true },
  channels: Object.fromEntries(POLICY_KINDS.map((k) => [k, { bell: true, push: true, email: k === 'escalationAdmin' || k === 'mentions' }])) as NotificationPolicy['channels'],
});

const settings = (companyId: string): CompanyNotificationSettings => ({
  companyId,
  timeZone: 'Asia/Muscat',
  policy: policy(),
  defaults: policy(),
  holidays: [
    { id: 'h1', day: '2026-11-20', name: 'National Day', recurring: false, source: 'STARTER', expected: false },
    { id: 'h2', day: '2027-05-16', name: 'Eid al-Adha', recurring: false, source: 'STARTER', expected: true },
  ],
  schedules: [
    { id: 's1', name: 'Standard', steps: { before: [2], onDue: true, after: [1], repeatEvery: 2 }, builtIn: 'STANDARD', isDefault: true },
    { id: 's2', name: 'Critical', steps: { before: [5, 2, 1], onDue: true, after: [], repeatEvery: 1 }, builtIn: 'CRITICAL', isDefault: false },
  ],
  banners: [{ name: 'Eid al-Adha', year: 2027, day: '2027-05-16', text: 'Confirm the Eid al-Adha 2027 date' }],
  workingTime: { weekStart: 0, workingHours: { days: [0, 1, 2, 3, 4], start: '08:00', end: '17:00' }, own: companyId === 'c2' },
  people: [
    { id: 'u1', name: 'Sara Ali', email: 'sara@x.co', admin: false },
    { id: 'u2', name: 'Omar Said', email: 'omar@x.co', admin: false },
    { id: 'a1', name: 'Admin', email: 'admin@x.co', admin: true },
  ],
  meetingReminders: { enabled: true, times: [{ minutes: 1440, email: true }] },
});

let companies: { id: string; name: string }[];
let calls: { method: string; url: string; body: unknown }[];
let answer: ((method: string, url: string) => Response | null) | null;

beforeEach(() => {
  companies = [{ id: 'c1', name: 'Prolens Projects LLC' }];
  calls = [];
  answer = null;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url);
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, url: u, body });
    const custom = answer?.(method, u);
    if (custom) return custom;
    if (u.endsWith('/notification-settings')) return json({ data: { companies, timeZone: 'Asia/Muscat' } });
    const m = /\/notification-settings\/([^/?]+)(\/.*)?$/.exec(u.split('?')[0]!);
    if (m && !m[2] && method === 'GET') return json({ data: settings(m[1]!) });
    if (u.includes('/preview')) {
      return json({
        data: {
          person: { id: 'u1', name: 'Sara Ali', active: true },
          companyId: 'c1',
          quietHours: { zone: 'Asia/Muscat', start: '17:00', end: '08:00', daysOff: true },
          paused: null,
          days: [
            {
              day: '2026-11-12',
              working: true,
              holiday: null,
              items: [{ kind: 'overdue', type: 'TASK_OVERDUE', title: 'A task is 1 working day overdue', body: 'MICO-1 · Pour slab', taskId: 't1', bell: true, push: 'hold', email: 'off', releaseAt: '2026-11-15T04:00:00.000Z' }],
            },
            { day: '2026-11-13', working: false, holiday: null, items: [] },
          ],
        },
      });
    }
    if (u.includes('/policy') && method === 'PUT') return json({ data: { ...policy(), ...body } });
    if (u.includes('/working-time') && method === 'PUT') return json({ data: { ...body, own: true } });
    if (u.includes('/working-time') && method === 'DELETE') return json({ data: { weekStart: 0, workingHours: { days: [0, 1, 2, 3, 4], start: '08:00', end: '17:00' }, own: false } });
    if (u.includes('/holidays/starter')) return json({ data: { added: 13 } });
    if (u.includes('/holidays')) return json({ data: { id: 'h9', day: '2026-12-31', name: 'Year end', recurring: true, source: 'ADMIN', expected: false } });
    if (u.includes('/schedules')) return json({ data: method === 'POST' && u.endsWith('/default') ? [] : { id: 's9', name: 'Site work', steps: body?.steps, builtIn: null, isDefault: false } });
    if (u.includes('/system-settings')) return json({ data: [] });
    return json({ data: [] });
  }));
});
afterEach(() => vi.restoreAllMocks());

let location = '';
function Where() {
  const l = useLocation();
  location = `${l.pathname}${l.search}`;
  return null;
}

function renderPage(at = '/admin/settings/notifications') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[at]}>
        <NotificationSchedulingPage />
        <Where />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
const sent = (method: string, part: string) => calls.filter((c) => c.method === method && c.url.includes(part)).map((c) => c.body);

describe('Notification & Scheduling — the panel', () => {
  it('has one tab per area, Working time first; the open tab is in the address and arrow keys move along', async () => {
    renderPage();
    const tabs = await screen.findAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual(['Working time', 'Holidays', 'Reminders', 'Escalations', 'Inactivity', 'Quiet hours', 'Channels', 'Preview']);
    expect(screen.getByRole('tab', { name: 'Working time' })).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(screen.getByRole('tablist'), { key: 'ArrowRight' });
    await waitFor(() => expect(location).toBe('/admin/settings/notifications?tab=holidays'));
    expect(screen.getByRole('tab', { name: 'Holidays' })).toHaveAttribute('aria-selected', 'true');
  });

  it('shows "Confirm the … date" on other tabs, with a way to the Holidays tab', async () => {
    renderPage();
    expect(await screen.findByText(/Confirm the Eid al-Adha 2027 date/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open Holidays' }));
    await waitFor(() => expect(location).toContain('tab=holidays'));
  });

  it('picks the company when the site has two or more', async () => {
    companies = [
      { id: 'c1', name: 'Prolens Projects LLC' },
      { id: 'c2', name: 'Second Co' },
    ];
    renderPage();
    const pick = await screen.findByRole('combobox', { name: 'Company' });
    fireEvent.change(pick, { target: { value: 'c2' } });
    await waitFor(() => expect(location).toContain('company=c2'));
    await waitFor(() => expect(calls.some((c) => c.method === 'GET' && c.url.endsWith('/notification-settings/c2'))).toBe(true));
  });
});

describe('Notification & Scheduling — Working time', () => {
  it('shows the site’s time zone read-only and saves the days, hours and week start', async () => {
    renderPage();
    expect(await screen.findByText(/Asia\/Muscat — the site’s time zone/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Thu' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Saturday' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save working time' }));
    await waitFor(() => expect(sent('PUT', '/working-time')).toEqual([{ weekStart: 6, workingHours: { days: [0, 1, 2, 3], start: '08:00', end: '17:00' } }]));
    expect(await screen.findByRole('status')).toHaveTextContent('Saved.');
  });

  it('says why a day can’t end before it starts', async () => {
    renderPage();
    fireEvent.change(await screen.findByLabelText('Day ends'), { target: { value: '07:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save working time' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('The day has to end after it starts.');
    expect(sent('PUT', '/working-time')).toEqual([]);
  });

  it('a company with its own working time can follow the site’s again (2+ companies)', async () => {
    companies = [
      { id: 'c1', name: 'Prolens Projects LLC' },
      { id: 'c2', name: 'Second Co' },
    ];
    renderPage('/admin/settings/notifications?company=c2');
    fireEvent.click(await screen.findByRole('button', { name: 'Use the site’s working time' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'DELETE' && c.url.endsWith('/notification-settings/c2/working-time'))).toBe(true));
  });
});

describe('Notification & Scheduling — Holidays', () => {
  it('lists the days off by year, confirms an expected date and adds a company day off every year', async () => {
    renderPage('/admin/settings/notifications?tab=holidays');
    expect(await screen.findByRole('heading', { name: '2026' })).toBeInTheDocument();
    expect(screen.getByText('National Day')).toBeInTheDocument();
    expect(screen.getByText(/expected date \(not announced yet\)/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm Eid al-Adha on Sun 16 May 2027' }));
    await waitFor(() => expect(sent('PUT', '/holidays/h2')).toEqual([{ expected: false }]));

    fireEvent.change(screen.getByLabelText('Day', { selector: 'input[type="date"]' }), { target: { value: '2026-12-31' } });
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Year end' } });
    fireEvent.click(screen.getAllByRole('switch', { name: 'Every year' })[0]!);
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(sent('POST', '/holidays')).toContainEqual({ day: '2026-12-31', name: 'Year end', recurring: true }));
    expect(await screen.findByRole('status')).toHaveTextContent('Day off added.');
  });

  it('asks before removing a day off', async () => {
    renderPage('/admin/settings/notifications?tab=holidays');
    fireEvent.click(await screen.findByRole('button', { name: 'Remove National Day on Fri 20 Nov 2026' }));
    expect(screen.getByText('Remove National Day?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'DELETE' && c.url.endsWith('/holidays/h1'))).toBe(true));
  });

  it('adds the starter public holidays of a year', async () => {
    renderPage('/admin/settings/notifications?tab=holidays');
    fireEvent.click(await screen.findByRole('button', { name: 'Add the starter public holidays for 2027' }));
    await waitFor(() => expect(sent('POST', '/holidays/starter')).toEqual([{ year: 2027 }]));
    expect(await screen.findByRole('status')).toHaveTextContent('13 public holidays added.');
  });
});

describe('Notification & Scheduling — Reminders', () => {
  it('turns a reminder off for the company and marks a kind required', async () => {
    renderPage('/admin/settings/notifications?tab=reminders');
    fireEvent.click(await screen.findByRole('switch', { name: 'Send: Tasks with no activity' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Overdue tasks' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save reminders' }));
    await waitFor(() => expect(sent('PUT', '/policy')).toHaveLength(1));
    const body = sent('PUT', '/policy')[0] as NotificationPolicy;
    expect(body.remindersOn.inactivity).toBe(false);
    expect(body.required).toEqual(['escalation', 'escalationAdmin', 'approvalWaiting', 'overdue']);
  });

  it('shows each schedule in words; Standard (the default) can’t be removed; a new one is added', async () => {
    renderPage('/admin/settings/notifications?tab=reminders');
    expect(await screen.findByText('2 working days before · on the due morning · 1 working day after · then every 2 working days while overdue')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove the Standard schedule' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Remove the Critical schedule' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add a schedule' }));
    const form = screen.getByRole('group', { name: 'New schedule' });
    fireEvent.change(within(form).getByLabelText('Name'), { target: { value: 'Site work' } });
    fireEvent.change(within(form).getByLabelText('Working days before the due day'), { target: { value: '3, 1' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Save schedule' }));
    await waitFor(() => expect(sent('POST', '/schedules')).toEqual([{ name: 'Site work', steps: { before: [3, 1], onDue: true, after: [1], repeatEvery: 2 } }]));
  });

  it('makes another schedule the default', async () => {
    renderPage('/admin/settings/notifications?tab=reminders');
    fireEvent.click(await screen.findByRole('button', { name: 'Make Critical the default' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/schedules/s2/default'))).toBe(true));
  });
});

describe('Notification & Scheduling — Escalations and inactivity', () => {
  it('saves both steps, step 2’s chosen people and the approval steps', async () => {
    renderPage('/admin/settings/notifications?tab=escalations');
    fireEvent.change(await screen.findByLabelText(/Step 1: overdue tasks go to the project’s managers after/), { target: { value: '4' } });
    fireEvent.change(screen.getByLabelText('Add a person'), { target: { value: 'sar' } });
    fireEvent.click(screen.getByRole('button', { name: /Sara Ali/ }));
    expect(screen.getByRole('button', { name: 'Take Sara Ali off step 2' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save escalations' }));
    await waitFor(() =>
      expect(sent('PUT', '/policy')).toEqual([{ escalation: { step1Days: 4, step2Days: 5, admins: true, userIds: ['u1'] }, approvals: { step1Days: 2, step2Days: 5 } }]),
    );
  });

  it('refuses the manager’s inactivity step before the assignees’', async () => {
    renderPage('/admin/settings/notifications?tab=inactivity');
    fireEvent.change(await screen.findByLabelText(/Remind its assignees after/), { target: { value: '8' } });
    fireEvent.change(screen.getByLabelText(/the project’s managers too after/), { target: { value: '6' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save inactivity' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('The manager’s step can’t come before the assignees’.');
    expect(sent('PUT', '/policy')).toEqual([]);
  });
});

describe('Notification & Scheduling — Quiet hours and channels', () => {
  it('sets nightly quiet hours', async () => {
    renderPage('/admin/settings/notifications?tab=quiet-hours');
    expect(await screen.findByRole('radio', { name: 'Outside working hours (Sun–Thu, 08:00–17:00)' })).toBeChecked();
    fireEvent.click(screen.getByRole('radio', { name: 'Every night between two times' }));
    fireEvent.change(screen.getByLabelText('Quiet from'), { target: { value: '21:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save quiet hours' }));
    await waitFor(() => expect(sent('PUT', '/policy')).toEqual([{ quietHours: { mode: 'custom', start: '21:00', end: '07:00', meetings: true, mentions: true } }]));
  });

  it('sets each kind’s defaults; meeting reminder times are here too', async () => {
    renderPage('/admin/settings/notifications?tab=channels');
    fireEvent.click(await screen.findByRole('switch', { name: 'Overdue tasks: email by default' }));
    expect(screen.queryByRole('switch', { name: 'Meeting reminders: email by default' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Save channels' }));
    await waitFor(() => expect((sent('PUT', '/policy')[0] as NotificationPolicy).channels.overdue).toEqual({ bell: true, push: true, email: true }));
    expect(screen.getByRole('heading', { name: 'Meeting reminders' })).toBeInTheDocument();
  });
});

describe('Notification & Scheduling — Preview for a person', () => {
  it('shows what they would get each day, and how', async () => {
    renderPage('/admin/settings/notifications?tab=preview');
    fireEvent.change(await screen.findByRole('combobox', { name: 'Person' }), { target: { value: 'u1' } });
    expect(await screen.findByText('A task is 1 working day overdue')).toBeInTheDocument();
    expect(screen.getByText('Phone at Sun 15 Nov, 08:00')).toBeInTheDocument();
    expect(screen.getByText('Not a working day')).toBeInTheDocument();
    expect(calls.some((c) => c.url.endsWith('/notification-settings/c1/preview?userId=u1'))).toBe(true);
  });
});
