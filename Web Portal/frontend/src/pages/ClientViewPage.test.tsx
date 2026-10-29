import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ClientViewScreen } from './ClientViewPage';
import { ApiError } from '../lib/api-client';
import type { ClientInspection, ClientView, ClientViewApi } from '../api/client-view';

const VIEW: ClientView = {
  viewer: { name: 'Fatma Al Harthy', email: 'fatma@client.example' },
  project: { name: 'Rig 7 Inspection', code: 'RIG', number: 'OD-2231', clientName: 'Oman Drilling Co.', status: 'ACTIVE', statusLabel: 'In progress', color: '#1E6B8B', icon: null, imageUrl: null },
  progress: { percentDone: 38 },
  timeline: { startDate: '2026-10-01', targetDate: '2026-11-20', today: '2026-10-26', elapsedPercent: 50 },
  milestones: [{ title: 'مسح الموقع', status: 'Done', dueDate: '2026-10-10' }],
  tasks: [
    { title: 'Install sensors', status: 'In progress', dueDate: '2026-11-02' },
    { title: 'Report draft', status: 'Not started', dueDate: null },
  ],
  minutes: [
    {
      id: 'm1',
      title: 'Kick-off',
      date: '2026-10-05',
      approvedOn: '2026-10-06',
      content: { summary: 'Agreed the plan.', discussion: [{ topic: 'Scope', text: 'Three rigs.' }], decisions: ['Start 1 Oct'], risks: ['Weather'], nextSteps: ['Survey'] },
    },
  ],
  inspections: [
    { id: 'i1', title: 'Rig daily check', date: '2026-10-27', place: 'Rig 3', counts: { total: 2, passed: 1, failed: 1, na: 0 }, result: '1 failed', revisionNumber: 2, reopenedOn: '2026-10-27' },
    { id: 'i2', title: 'Deck check', date: '2026-10-20', place: null, counts: { total: 1, passed: 1, failed: 0, na: 0 }, result: 'Passed', revisionNumber: 1, reopenedOn: null },
  ],
  generatedAt: '2026-10-26T08:00:00.000Z',
};

const REPORT: ClientInspection = {
  ...VIEW.inspections![0]!,
  sections: [{ title: 'Well head', items: [{ label: 'Pressure', kind: 'READING', result: 'Fail', reading: '162 psi', limits: '0–150 psi', note: 'Gauge read high' }, { label: 'Valves closed', kind: 'CHECK', result: 'Pass', reading: null, limits: null, note: null }] }],
  signatures: [{ role: 'Inspector', name: 'Ivan Inspector', signedAt: '2026-10-27T08:30:00.000Z', signedOn: '27 Oct 2026, 11:30', image: null, typed: true }],
  unsigned: ['Client'],
};

const signInNeeded = () => new ApiError(401, 'CLIENT_SIGN_IN', 'Enter the code we email you to open this page.');

function fakeApi(over: Partial<ClientViewApi> = {}): ClientViewApi {
  return {
    view: vi.fn(async () => VIEW),
    requestCode: vi.fn(async () => undefined),
    verify: vi.fn(async () => undefined),
    signOut: vi.fn(async () => undefined),
    minutesPdf: vi.fn(async () => ({ blob: new Blob(['%PDF']), fileName: 'minutes-kick-off.pdf' })),
    inspection: vi.fn(async (id: string) => ({ ...REPORT, id })),
    inspectionPdf: vi.fn(async () => ({ blob: new Blob(['%PDF']), fileName: 'inspection-rig-daily-check-2026-10-27.pdf' })),
    ...over,
  };
}

const show = (api: ClientViewApi) =>
  render(
    <MemoryRouter initialEntries={['/client/LINK']}>
      <Routes>
        <Route path="/client/:token" element={<ClientViewScreen api={api} />} />
      </Routes>
    </MemoryRouter>,
  );

beforeEach(() => {
  document.head.querySelectorAll('meta[name="referrer"]').forEach((m) => m.remove());
});

describe('the client page', () => {
  it('asks for the email first, showing nothing of the project and none of the staff app', async () => {
    show(fakeApi({ view: vi.fn(async () => Promise.reject(signInNeeded())) }));
    expect(await screen.findByRole('heading', { name: 'View a shared project' })).toBeInTheDocument();
    expect(screen.getByLabelText('Email address')).toBeInTheDocument();
    expect(screen.queryByText(/Rig 7/)).toBeNull();
    for (const staff of ['Dashboard', 'Kanban Board', 'Projects', 'My Tasks', 'Chat']) expect(screen.queryByRole('link', { name: staff })).toBeNull();
    // The MICO360 wordmark: the coloured one on light, the white one in dark mode (as the staff app does).
    const logos = screen.getAllByAltText('MICO360 Tasks') as HTMLImageElement[];
    expect(logos.map((l) => [l.getAttribute('src')!.includes('logo-w'), l.className.includes('dark:hidden') || l.className.includes('dark:block')])).toEqual([
      [false, true],
      [true, true],
    ]);
  });

  it('emails a code, then opens the page with it', async () => {
    const user = userEvent.setup();
    let signedIn = false;
    const api = fakeApi({
      view: vi.fn(async () => (signedIn ? VIEW : Promise.reject(signInNeeded()))),
      verify: vi.fn(async () => {
        signedIn = true;
      }),
    });
    show(api);
    await user.type(await screen.findByLabelText('Email address'), 'fatma@client.example');
    await user.click(screen.getByRole('button', { name: 'Email me a code' }));
    expect(api.requestCode).toHaveBeenCalledWith('fatma@client.example');
    // Worded so it never says whether the address is on the list.
    expect(await screen.findByText((_, el) => el?.tagName === 'P' && /^If fatma@client\.example can open this page, we’ve emailed it a 6-digit code/.test(el.textContent ?? ''))).toBeInTheDocument();
    await user.type(screen.getByLabelText('6-digit code'), '482913');
    await user.click(screen.getByRole('button', { name: 'Open the project' }));
    expect(api.verify).toHaveBeenCalledWith('fatma@client.example', '482913');
    expect(await screen.findByRole('heading', { level: 1, name: 'Rig 7 Inspection' })).toBeInTheDocument();
  });

  it('takes a pasted code with the spaces and line break it was copied with', async () => {
    const user = userEvent.setup();
    const api = fakeApi({ view: vi.fn(async () => Promise.reject(signInNeeded())) });
    show(api);
    await user.type(await screen.findByLabelText('Email address'), 'fatma@client.example');
    await user.click(screen.getByRole('button', { name: 'Email me a code' }));
    const box = await screen.findByLabelText('6-digit code');
    // As copied from the plain-text email (indented, then a line break), and as written "482 913".
    for (const pasted of ['    482913\n', '482 913']) {
      await user.clear(box);
      await user.click(box);
      await user.paste(pasted);
      expect(box).toHaveValue('482913');
    }
    await user.click(screen.getByRole('button', { name: 'Open the project' }));
    expect(api.verify).toHaveBeenCalledWith('fatma@client.example', '482913');
  });

  it('says plainly when a code didn’t work, and keeps the code box ready for another try', async () => {
    const user = userEvent.setup();
    const refusal = 'That code didn’t work. Use the email address this page was shared with and the newest code we sent.';
    const api = fakeApi({
      view: vi.fn(async () => Promise.reject(signInNeeded())),
      verify: vi.fn(async () => Promise.reject(new ApiError(401, 'CLIENT_CODE_INVALID', refusal))),
    });
    show(api);
    await user.type(await screen.findByLabelText('Email address'), 'someone@else.example');
    await user.click(screen.getByRole('button', { name: 'Email me a code' }));
    const box = await screen.findByLabelText('6-digit code');
    await user.type(box, '111111');
    await user.click(screen.getByRole('button', { name: 'Open the project' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(refusal);
    expect(box).toHaveAttribute('aria-invalid', 'true');
  });

  it('a link that has ended (removed, replaced, archived) gets one friendly message and no form', async () => {
    show(fakeApi({ view: vi.fn(async () => Promise.reject(new ApiError(404, 'CLIENT_LINK_ENDED', 'anything the server says'))) }));
    expect(await screen.findByRole('heading', { name: 'This link no longer works' })).toBeInTheDocument();
    expect(screen.getByText('If you still need access, ask the person who shared the project with you to send a new one.')).toBeInTheDocument();
    expect(screen.queryByLabelText('Email address')).toBeNull();
  });

  it('shows progress, the timeline with today, the shared milestones and tasks in plain words, and the minutes', async () => {
    show(fakeApi());
    expect(await screen.findByRole('heading', { level: 1, name: 'Rig 7 Inspection' })).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Project progress' })).toHaveAttribute('aria-valuenow', '38');
    expect(screen.getByText('38%')).toBeInTheDocument();
    const timeline = screen.getByRole('region', { name: 'Timeline' });
    expect(within(timeline).getByText('1 Oct 2026')).toBeInTheDocument();
    expect(within(timeline).getByText('20 Nov 2026')).toBeInTheDocument();
    expect(within(timeline).getByText(/Today/)).toBeInTheDocument();
    const milestones = screen.getByRole('region', { name: 'Milestones' });
    expect(within(milestones).getByText('مسح الموقع')).toHaveAttribute('dir', 'auto');
    expect(within(milestones).getByText('Done')).toBeInTheDocument();
    const tasks = screen.getByRole('region', { name: 'Tasks' });
    expect(within(tasks).getByText('Install sensors')).toBeInTheDocument();
    expect(within(tasks).getByText('Due 2 Nov 2026')).toBeInTheDocument();
    expect(within(tasks).getByText('No due date')).toBeInTheDocument();
    const minutes = screen.getByRole('region', { name: 'Meeting minutes' });
    // Each meeting's title is a heading holding the button that opens or closes it (no <summary>).
    const heading = within(minutes).getByRole('heading', { level: 3, name: /Kick-off/ });
    const toggle = within(heading).getByRole('button', { name: /Kick-off/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(minutes.querySelector('summary, details')).toBeNull();
    expect(within(minutes).getByText('Agreed the plan.')).toBeInTheDocument();
    expect(within(minutes).getByRole('button', { name: 'Download the minutes of Kick-off (PDF)' })).toBeInTheDocument();
  });

  it('opens and closes a meeting’s minutes with its heading button', async () => {
    const user = userEvent.setup();
    show(fakeApi());
    const toggle = await screen.findByRole('button', { name: /Kick-off/, expanded: true });
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Agreed the plan.')).toBeNull();
    await user.click(toggle);
    expect(screen.getByText('Agreed the plan.')).toBeInTheDocument();
  });

  it('downloads the client copy of the minutes', async () => {
    const user = userEvent.setup();
    const api = fakeApi();
    URL.createObjectURL = vi.fn(() => 'blob:x');
    URL.revokeObjectURL = vi.fn();
    show(api);
    await user.click(await screen.findByRole('button', { name: 'Download the minutes of Kick-off (PDF)' }));
    expect(api.minutesPdf).toHaveBeenCalledWith('m1');
  });

  it('lists the reports shared with the client; one opened shows its items, signatures and PDF', async () => {
    const user = userEvent.setup();
    const api = fakeApi();
    URL.createObjectURL = vi.fn(() => 'blob:x');
    URL.revokeObjectURL = vi.fn();
    show(api);
    const section = await screen.findByRole('region', { name: 'Inspection reports' });
    const toggle = within(section).getByRole('button', { name: /^Rig daily check/ });
    // The newest is opened, so it (alone) is read in full.
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(within(section).getAllByText('1 failed').length).toBeGreaterThan(0);
    expect((await within(section).findAllByText('Gauge read high', { exact: false })).length).toBeGreaterThan(0);
    expect(within(section).getAllByText('Ivan Inspector').length).toBeGreaterThan(0);
    expect(within(section).getByText('Not signed', { exact: false })).toBeInTheDocument();
    // Signed when, as the company's clock says it (the PDF says the same).
    expect(within(section).getByText(/Signed 27 Oct 2026, 11:30/)).toBeInTheDocument();
    expect(api.inspection).toHaveBeenCalledTimes(1);
    expect(api.inspection).toHaveBeenCalledWith('i1');
    await user.click(within(section).getByRole('button', { name: 'Download the inspection report Rig daily check (PDF)' }));
    expect(api.inspectionPdf).toHaveBeenCalledWith('i1');
    // Another one is read when it is opened.
    await user.click(within(section).getByRole('button', { name: /^Deck check/ }));
    await waitFor(() => expect(api.inspection).toHaveBeenCalledWith('i2'));
  });

  it('says which revision a reopened and signed-again report is', async () => {
    show(fakeApi());
    const section = await screen.findByRole('region', { name: 'Inspection reports' });
    expect(within(section).getAllByText(/Revision 2 · reopened on 27 Oct 2026/).length).toBeGreaterThan(0);
    expect(within(section).queryByText(/Revision 1/)).toBeNull();
  });

  it('a report that can’t be read when opened says so, with a way to try again', async () => {
    const user = userEvent.setup();
    const inspection = vi.fn().mockRejectedValueOnce(new TypeError('Failed to fetch')).mockImplementation(async (id: string) => ({ ...REPORT, id }));
    show(fakeApi({ inspection }));
    const section = await screen.findByRole('region', { name: 'Inspection reports' });
    expect(await within(section).findByText('Couldn’t load this report.', { exact: false })).toBeInTheDocument();
    await user.click(within(section).getByRole('button', { name: 'Try again' }));
    expect((await within(section).findAllByText('Gauge read high', { exact: false })).length).toBeGreaterThan(0);
  });

  it('says so when nothing has been shared yet (and has no reports section without any)', async () => {
    show(fakeApi({ view: vi.fn(async () => ({ ...VIEW, milestones: [], tasks: [], minutes: [], inspections: [] })) }));
    expect(await screen.findByText('No milestones have been shared yet.')).toBeInTheDocument();
    expect(screen.getByText('No tasks have been shared yet.')).toBeInTheDocument();
    expect(screen.getByText('No meeting minutes have been shared yet.')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Inspection reports' })).toBeNull();
    expect(screen.queryByText(/inspection reports/i)).toBeNull();
  });

  it('signs this device out', async () => {
    const user = userEvent.setup();
    const api = fakeApi();
    show(api);
    await user.click(await screen.findByRole('button', { name: 'Sign out' }));
    expect(api.signOut).toHaveBeenCalled();
    expect(await screen.findByLabelText('Email address')).toBeInTheDocument();
  });

  it('never sends its address on as a referrer', async () => {
    show(fakeApi());
    await screen.findByRole('heading', { level: 1, name: 'Rig 7 Inspection' });
    await waitFor(() => expect(document.head.querySelector('meta[name="referrer"]')).toHaveAttribute('content', 'no-referrer'));
  });
});
