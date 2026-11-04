import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../../App';
import { useAuthStore } from '../../stores/auth-store';
import { ApiError } from '../../lib/api-client';
import { card, home, meetingItem, meetingView, projectView, taskView } from './portal-fixtures';

/** The portal's API, replaced: each test says what the server answers. */
const api = vi.hoisted(() => ({
  me: vi.fn(),
  project: vi.fn(),
  task: vi.fn(),
  comment: vi.fn(),
  accept: vi.fn(),
  sendBack: vi.fn(),
  taskListPdf: vi.fn(),
  meetings: vi.fn(),
  meeting: vi.fn(),
  respond: vi.fn(),
  minutesPdf: vi.fn(),
  markDone: vi.fn(),
  whereIs: vi.fn(),
  changePassword: vi.fn(),
}));
vi.mock('../../api/portal', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../api/portal')>()), portal: api }));

/** The staff app must not open its realtime socket for a client. */
const io = vi.hoisted(() => vi.fn());
/** A socket that does nothing (the staff app's, for a staff session). */
const quietSocket = (): unknown => {
  const s: Record<string, unknown> = new Proxy({}, { get: (_t, k) => (k === 'then' ? undefined : k === 'connected' ? false : k === 'io' ? s : () => s) });
  return s;
};
vi.mock('socket.io-client', () => ({ io, default: io }));

const notShared = () => new ApiError(404, 'NOT_FOUND', 'This isn’t shared with you.');

let calls: string[] = [];
function Where() {
  const l = useLocation();
  return <div data-testid="where">{l.pathname}</div>;
}

function renderAt(path: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <App />
        <Where />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const signInAs = (roles: string[]) =>
  useAuthStore.getState().setSession({ user: { id: 'c1', email: 'huda@client.test', username: 'huda', roles }, accessToken: 'at', refreshToken: 'rt' });

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  io.mockReset();
  io.mockImplementation(quietSocket);
  api.me.mockResolvedValue(home());
  api.project.mockResolvedValue(projectView());
  api.task.mockResolvedValue(taskView());
  api.meetings.mockResolvedValue([meetingItem(), meetingItem({ id: 'm2', title: 'Kick-off', date: '2026-10-01', startAt: '2026-10-01T05:00:00.000Z', endAt: null, status: 'Held', invited: false, response: null, hasMinutes: true })]);
  api.meeting.mockResolvedValue(meetingView());
  // Anything else the page asks the server (it must ask nothing else) is recorded.
  calls = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    calls.push(String(url));
    return new Response(JSON.stringify({ error: { code: 'CLIENT_NOT_ALLOWED', message: 'no' } }), { status: 403 });
  }));
  useAuthStore.getState().logout('remote');
  signInAs(['CLIENT']);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Client portal: the shell and home', () => {
  it('shows the client’s projects as cards — company, project, status, progress — in the portal’s own shell', async () => {
    api.me.mockResolvedValue(home([card(), card({ id: 'p2', code: 'RIG', name: 'Rig survey', company: null, percentDone: null, modules: { progress: false, meetings: true } })]));
    renderAt('/portal');
    expect(await screen.findByRole('heading', { level: 1, name: 'Your projects' })).toBeInTheDocument();
    const first = (await screen.findByRole('link', { name: /Office fit-out/ }));
    expect(first).toHaveAttribute('href', '/portal/projects/p1');
    expect(within(first).getByText('Prolens Projects LLC')).toBeInTheDocument();
    // The company's logo (the built-in one when it has none), named for the company.
    expect(within(first).getAllByRole('img', { name: 'Prolens Projects LLC' }).length).toBeGreaterThan(0);
    expect(within(first).getByText('In progress')).toBeInTheDocument();
    expect(within(first).getByText('40% done')).toBeInTheDocument();
    expect(within(first).getByRole('progressbar')).toHaveAttribute('aria-valuenow', '40');
    // Without the Progress module: no figure at all.
    const second = screen.getByRole('link', { name: /Rig survey/ });
    expect(within(second).queryByRole('progressbar')).toBeNull();
    expect(within(second).queryByText(/% done/)).toBeNull();
    // Who is signed in, and their two buttons; none of the staff app.
    expect(screen.getAllByText('Huda Client').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Gulf Builders').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Change password' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: /main/i })).toBeNull();
    expect(screen.queryByRole('searchbox')).toBeNull();
    expect(io).not.toHaveBeenCalled();
    expect(calls).toEqual([]);
  });

  it('with nothing shared yet, says so', async () => {
    api.me.mockResolvedValue(home([]));
    renderAt('/portal');
    expect(await screen.findByText('No projects are shared with you yet.')).toBeInTheDocument();
  });

  it('a failed load says so, with Try again', async () => {
    api.me.mockRejectedValueOnce(new TypeError('offline')).mockResolvedValue(home());
    renderAt('/portal');
    expect(await screen.findByText('Couldn’t load your projects.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('link', { name: /Office fit-out/ })).toBeInTheDocument();
  });

  it('Change password keeps this device signed in with the fresh tokens', async () => {
    api.changePassword.mockResolvedValue({ accessToken: 'new-at', refreshToken: 'new-rt' });
    renderAt('/portal');
    await userEvent.click(await screen.findByRole('button', { name: 'Change password' }));
    const dialog = await screen.findByRole('dialog', { name: 'Change password' });
    await userEvent.type(within(dialog).getByLabelText(/Current password/), 'Password1!');
    await userEvent.type(within(dialog).getByLabelText(/^New password/), 'Better2pass');
    await userEvent.type(within(dialog).getByLabelText(/Confirm new password/), 'Better2pass');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Change password' }));
    expect(await within(dialog).findByRole('status')).toHaveTextContent(/still signed in here/);
    expect(api.changePassword).toHaveBeenCalledWith('Password1!', 'Better2pass');
    expect(useAuthStore.getState().accessToken).toBe('new-at');
    expect(useAuthStore.getState().refreshToken).toBe('new-rt');
    expect(useAuthStore.getState().user?.roles).toEqual(['CLIENT']);
  });

  it('Change password checks the new password first', async () => {
    renderAt('/portal');
    await userEvent.click(await screen.findByRole('button', { name: 'Change password' }));
    const dialog = await screen.findByRole('dialog', { name: 'Change password' });
    await userEvent.type(within(dialog).getByLabelText(/Current password/), 'Password1!');
    await userEvent.type(within(dialog).getByLabelText(/^New password/), 'short');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Change password' }));
    expect(within(dialog).getByRole('alert')).toHaveTextContent(/at least 8 characters/);
    expect(api.changePassword).not.toHaveBeenCalled();
  });

  it('Sign out ends the session and goes to sign-in', async () => {
    renderAt('/portal');
    await userEvent.click(await screen.findByRole('button', { name: 'Sign out' }));
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/login'));
  });
});

describe('Client portal: a project', () => {
  it('opens on its first granted tab, with a tab per granted module', async () => {
    renderAt('/portal/projects/p1');
    expect(await screen.findByRole('heading', { level: 1, name: 'Office fit-out' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/portal/projects/p1/progress'));
    const tabs = screen.getByRole('navigation', { name: 'Project sections' });
    expect(within(tabs).getByRole('link', { name: 'Progress & tasks' })).toHaveAttribute('aria-current', 'page');
    expect(within(tabs).getByRole('link', { name: 'Meetings & minutes' })).toBeInTheDocument();
    expect(screen.getByText('MICO')).toBeInTheDocument();
    expect(screen.getByText('Project no. 2026-07')).toBeInTheDocument();
  });

  it('a module that isn’t granted has no tab; a link to it opens the granted one', async () => {
    api.project.mockResolvedValue(projectView({ modules: { progress: true, meetings: false }, actions: { comment: true, signOff: true, respond: false, download: false } }));
    renderAt('/portal/projects/p1/meetings');
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/portal/projects/p1/progress'));
    const tabs = await screen.findByRole('navigation', { name: 'Project sections' });
    expect(within(tabs).queryByRole('link', { name: 'Meetings & minutes' })).toBeNull();
    expect(api.meetings).not.toHaveBeenCalled();
  });

  it('the Meetings module alone: the project opens on Meetings & minutes, and Progress isn’t asked for', async () => {
    api.project.mockResolvedValue(projectView({ modules: { progress: false, meetings: true }, progress: null }));
    renderAt('/portal/projects/p1/progress');
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/portal/projects/p1/meetings'));
    expect(await screen.findByText('Site walk-through')).toBeInTheDocument();
  });

  it('Progress & tasks: progress, timeline, milestones and the shared tasks with their numbers, due days, Late and Accepted', async () => {
    renderAt('/portal/projects/p1/progress');
    expect(await screen.findByText('40%')).toBeInTheDocument();
    expect(screen.getByText('1 Oct 2026')).toBeInTheDocument();
    expect(screen.getByText('31 Dec 2026')).toBeInTheDocument();
    const milestones = screen.getByRole('region', { name: 'Milestones' });
    expect(within(milestones).getByText('Design signed off')).toBeInTheDocument();
    expect(within(milestones).getByText('Accepted 12 Oct 2026')).toBeInTheDocument();
    const tasks = screen.getByRole('region', { name: 'Tasks' });
    const row = within(tasks).getByRole('link', { name: /Install the glass doors/ });
    expect(row).toHaveAttribute('href', '/portal/projects/p1/tasks/t1');
    expect(within(row).getByText('MICO-7')).toBeInTheDocument();
    expect(within(row).getByText('Due 30 Oct 2026')).toBeInTheDocument();
    expect(within(within(tasks).getByRole('link', { name: /Lay the carpet/ })).getByText('Late')).toBeInTheDocument();
    expect(within(within(tasks).getByRole('link', { name: /Paint the walls/ })).getByText('Waiting for your sign-off')).toBeInTheDocument();
  });

  it('Download task list (PDF) only with the Download action, saved under the server’s file name', async () => {
    const file = new File(['%PDF'], 'MICO-client-tasks-2026-11-04.pdf', { type: 'application/pdf' });
    api.taskListPdf.mockResolvedValue(file);
    const createObjectURL = vi.fn(() => 'blob:x');
    const revoke = vi.fn();
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL, revokeObjectURL: revoke }));
    const clicked: string[] = [];
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push(this.download);
    });
    renderAt('/portal/projects/p1/progress');
    await userEvent.click(await screen.findByRole('button', { name: 'Download task list (PDF)' }));
    await waitFor(() => expect(clicked).toEqual(['MICO-client-tasks-2026-11-04.pdf']));
    expect(api.taskListPdf).toHaveBeenCalledWith('p1');
    click.mockRestore();
  });

  it('without the Download action there is no download button', async () => {
    api.project.mockResolvedValue(projectView({ actions: { comment: true, signOff: true, respond: true, download: false } }));
    renderAt('/portal/projects/p1/progress');
    expect(await screen.findByText('Install the glass doors')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Download/ })).toBeNull();
  });

  it('a project that isn’t shared (404) says so, kindly', async () => {
    api.project.mockRejectedValue(notShared());
    renderAt('/portal/projects/nope');
    expect(await screen.findByRole('heading', { name: 'This isn’t shared with you.' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to your projects' })).toHaveAttribute('href', '/portal');
  });
});

describe('Client portal: a task', () => {
  it('shows status, due day and the shared description; the thread names nobody on the team', async () => {
    renderAt('/portal/projects/p1/tasks/t2');
    expect(await screen.findByRole('heading', { level: 2, name: 'Paint the walls' })).toBeInTheDocument();
    expect(screen.getByText('Two coats, white.')).toBeInTheDocument();
    expect(screen.getByText('20 Oct 2026')).toBeInTheDocument();
    const comments = screen.getByRole('region', { name: 'Comments' });
    expect(within(comments).getByText('You')).toBeInTheDocument();
    expect(within(comments).getByText('Project team')).toBeInTheDocument();
    expect(within(comments).getByText('Snow white, as agreed.')).toBeInTheDocument();
    expect(api.task).toHaveBeenCalledWith('p1', 't2');
  });

  it('a comment is sent, and the answer shows it', async () => {
    const after = taskView();
    after.comments = [...after.comments!, { id: 'c3', from: 'you', replyTo: null, body: 'Thanks!', createdAt: '2026-11-04T06:00:00.000Z', edited: false }];
    api.comment.mockResolvedValue(after);
    renderAt('/portal/projects/p1/tasks/t2');
    await userEvent.type(await screen.findByLabelText('Add a comment'), '  Thanks!  ');
    await userEvent.click(screen.getByRole('button', { name: 'Send comment' }));
    expect(await screen.findByText('Thanks!')).toBeInTheDocument();
    expect(api.comment).toHaveBeenCalledWith('p1', 't2', 'Thanks!');
    expect(screen.getByRole('status')).toHaveTextContent('Comment sent to the project team.');
    expect(screen.getByLabelText('Add a comment')).toHaveValue('');
  });

  it('an empty comment is not sent', async () => {
    renderAt('/portal/projects/p1/tasks/t2');
    await userEvent.click(await screen.findByRole('button', { name: 'Send comment' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Write a comment first.');
    expect(api.comment).not.toHaveBeenCalled();
  });

  it('without the Comment action there is no thread and no box', async () => {
    api.task.mockResolvedValue(taskView({ comments: null, can: { comment: false, signOff: true } }));
    renderAt('/portal/projects/p1/tasks/t2');
    expect(await screen.findByRole('heading', { level: 2, name: 'Paint the walls' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Comments' })).toBeNull();
    expect(screen.queryByLabelText('Add a comment')).toBeNull();
  });

  it('Accept asks first, then accepts', async () => {
    api.accept.mockResolvedValue(taskView({ can: { comment: true, signOff: false } }, { awaitingSignOff: false, acceptedOn: '2026-11-04' }));
    renderAt('/portal/projects/p1/tasks/t2');
    await userEvent.click(await screen.findByRole('button', { name: 'Accept' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Accept MICO-8?' });
    expect(api.accept).not.toHaveBeenCalled();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Accept' }));
    await waitFor(() => expect(api.accept).toHaveBeenCalledWith('p1', 't2'));
    expect(await screen.findByText('You accepted this task on 4 Nov 2026.')).toBeInTheDocument();
    expect(screen.getByText('Accepted 4 Nov 2026')).toBeInTheDocument();
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('Send back needs a reason, then sends it back', async () => {
    api.sendBack.mockResolvedValue(taskView({ can: { comment: true, signOff: false } }, { status: 'In progress', awaitingSignOff: false }));
    renderAt('/portal/projects/p1/tasks/t2');
    await userEvent.click(await screen.findByRole('button', { name: 'Send back' }));
    const dialog = await screen.findByRole('dialog', { name: 'Send MICO-8 back?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Send back' }));
    expect(within(dialog).getByText('Say why you are sending it back.')).toBeInTheDocument();
    expect(api.sendBack).not.toHaveBeenCalled();
    await userEvent.type(within(dialog).getByLabelText(/Why are you sending it back/), 'The corner is not painted');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Send back' }));
    await waitFor(() => expect(api.sendBack).toHaveBeenCalledWith('p1', 't2', 'The corner is not painted'));
    expect(await screen.findByText(/Sent back\. The task is in progress again/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Accept' })).toBeNull();
  });

  it('a refused sign-off (403) is said in the dialog, which stays open', async () => {
    api.accept.mockRejectedValue(new ApiError(403, 'FORBIDDEN', 'You can’t do that on this project. Ask the project team if you need to.'));
    renderAt('/portal/projects/p1/tasks/t2');
    await userEvent.click(await screen.findByRole('button', { name: 'Accept' }));
    const dialog = await screen.findByRole('alertdialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Accept' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('You can’t do that on this project.');
  });

  it('no Accept or Send back without the Sign off action (or before it is finished)', async () => {
    api.task.mockResolvedValue(taskView({ can: { comment: true, signOff: false } }));
    renderAt('/portal/projects/p1/tasks/t2');
    expect(await screen.findByRole('heading', { level: 2, name: 'Paint the walls' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Accept' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Send back' })).toBeNull();
  });

  it('a task that isn’t shared (404) says so', async () => {
    api.task.mockRejectedValue(notShared());
    renderAt('/portal/projects/p1/tasks/secret');
    expect(await screen.findByRole('heading', { name: 'This isn’t shared with you.' })).toBeInTheDocument();
  });
});

describe('Client portal: meetings', () => {
  it('lists meetings with their day, status, the client’s answer and Minutes', async () => {
    renderAt('/portal/projects/p1/meetings');
    const first = await screen.findByRole('link', { name: /Site walk-through/ });
    expect(first).toHaveAttribute('href', '/portal/projects/p1/meetings/m1');
    expect(within(first).getByText('Fri 30 Oct 2026 · 09:00–10:00')).toBeInTheDocument();
    expect(within(first).getByText('Invited')).toBeInTheDocument();
    expect(within(first).getByText('Scheduled')).toBeInTheDocument();
    const second = screen.getByRole('link', { name: /Kick-off/ });
    expect(within(second).getByText('Minutes')).toBeInTheDocument();
    expect(within(second).queryByText('Invited')).toBeNull();
  });

  it('a meeting: when, where, link, agenda; the answer is saved', async () => {
    api.respond.mockResolvedValue(meetingView({}, { response: 'TENTATIVE' }));
    renderAt('/portal/projects/p1/meetings/m1');
    expect(await screen.findByRole('heading', { level: 2, name: 'Site walk-through' })).toBeInTheDocument();
    expect(screen.getByText('Muscat office')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'https://meet.example.com/abc' })).toHaveAttribute('rel', 'noopener noreferrer');
    expect(screen.getByText('Walk the site together.')).toBeInTheDocument();
    expect(screen.getByText('Doors', { selector: 'bdi' })).toBeInTheDocument();
    const answers = screen.getByRole('group', { name: 'Your answer' });
    await userEvent.click(within(answers).getByRole('button', { name: 'Maybe' }));
    await waitFor(() => expect(api.respond).toHaveBeenCalledWith('p1', 'm1', 'TENTATIVE'));
    expect(await screen.findByText('Your answer is saved: Maybe.')).toBeInTheDocument();
    expect(within(answers).getByRole('button', { name: 'Maybe' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('their own action item is marked done', async () => {
    const after = meetingView();
    after.actionItems = after.actionItems.map((a) => ({ ...a, done: true }));
    api.markDone.mockResolvedValue(after);
    renderAt('/portal/projects/p1/meetings/m1');
    await userEvent.click(await screen.findByRole('button', { name: 'Mark done: Send the carpet samples' }));
    await waitFor(() => expect(api.markDone).toHaveBeenCalledWith('p1', 'a1'));
    await waitFor(() => expect(screen.queryByRole('button', { name: /Mark done/ })).toBeNull());
    // The one already done has no button.
    expect(screen.getAllByText('Done').length).toBeGreaterThan(0);
  });

  it('the approved minutes show, and download with the Download action', async () => {
    api.minutesPdf.mockResolvedValue(new File(['%PDF'], 'minutes.pdf', { type: 'application/pdf' }));
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    renderAt('/portal/projects/p1/meetings/m1');
    const minutes = await screen.findByRole('region', { name: 'Minutes' });
    expect(within(minutes).getByText('All on track.')).toBeInTheDocument();
    expect(within(minutes).getByText('Keep the white')).toBeInTheDocument();
    expect(within(minutes).getByText('Approved 31 Oct 2026')).toBeInTheDocument();
    await userEvent.click(within(minutes).getByRole('button', { name: 'Download minutes (PDF)' }));
    await waitFor(() => expect(api.minutesPdf).toHaveBeenCalledWith('p1', 'm1'));
    click.mockRestore();
  });

  it('without the Reply or Download actions: no answer buttons, no Mark done, no download', async () => {
    api.meeting.mockResolvedValue(meetingView({ can: { respond: false, markDone: false, downloadMinutes: false } }));
    renderAt('/portal/projects/p1/meetings/m1');
    expect(await screen.findByRole('heading', { level: 2, name: 'Site walk-through' })).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Your answer' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Mark done/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Download/ })).toBeNull();
    expect(screen.getByText('Send the carpet samples')).toBeInTheDocument();
  });

  it('a meeting that isn’t shared (404) says so', async () => {
    api.meeting.mockRejectedValue(notShared());
    renderAt('/portal/projects/p1/meetings/secret');
    expect(await screen.findByRole('heading', { name: 'This isn’t shared with you.' })).toBeInTheDocument();
  });
});

describe('Client portal: routing', () => {
  it('an invitation email’s /meetings/<id> link opens that meeting in the portal', async () => {
    api.whereIs.mockResolvedValue({ projectId: 'p1', meetingId: 'm1' });
    renderAt('/meetings/m1');
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/portal/projects/p1/meetings/m1'));
    expect(await screen.findByRole('heading', { level: 2, name: 'Site walk-through' })).toBeInTheDocument();
    expect(api.whereIs).toHaveBeenCalledWith('m1');
    expect(calls).toEqual([]);
  });

  it('an invitation link to a meeting that isn’t shared says so', async () => {
    api.whereIs.mockRejectedValue(notShared());
    renderAt('/meetings/zzz');
    expect(await screen.findByRole('heading', { name: 'This isn’t shared with you.' })).toBeInTheDocument();
  });

  it('a client typing a staff address lands on the portal, and no staff request or socket starts', async () => {
    for (const path of ['/dashboard', '/projects/p1', '/admin/users', '/chat', '/my-tasks', '/no-such-page']) {
      const view = renderAt(path);
      expect(await screen.findByRole('heading', { level: 1, name: 'Your projects' })).toBeInTheDocument();
      expect(screen.getByTestId('where')).toHaveTextContent(/^\/portal$/);
      view.unmount();
    }
    expect(calls).toEqual([]);
    expect(io).not.toHaveBeenCalled();
  });

  it('staff opening the portal go to their dashboard', async () => {
    signInAs(['EMPLOYEE']);
    renderAt('/portal/projects/p1/progress');
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/dashboard'));
    expect(api.project).not.toHaveBeenCalled();
    expect(api.me).not.toHaveBeenCalled();
  });
});

describe('Client portal: signing in', () => {
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const clientSession = { user: { id: 'c1', email: 'huda@client.test', username: 'huda', roles: ['CLIENT'] }, accessToken: 'at', refreshToken: 'rt' };
  beforeEach(() => {
    useAuthStore.getState().logout('remote');
    useAuthStore.setState({ endedBy: null });
    api.whereIs.mockResolvedValue({ projectId: 'p1', meetingId: 'm1' });
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      calls.push(u);
      if (init?.method === 'HEAD') return new Response(null, { status: 404 });
      if (u.endsWith('/config')) return json({ data: { timeZone: 'Asia/Muscat', productName: '', companyName: '', serverTime: '', emailEnabled: true, androidAppUrl: null } });
      if (u.endsWith('/auth/login') || u.endsWith('/auth/otp/verify')) return json({ data: clientSession });
      if (u.endsWith('/auth/otp/request')) return json({ data: { sent: true } });
      return json({ error: { code: 'CLIENT_NOT_ALLOWED', message: 'no' } }, 403);
    }));
  });

  async function signInWithPassword() {
    await userEvent.type(await screen.findByLabelText(/email or username/i), 'huda');
    await userEvent.type(screen.getByLabelText(/^password/i), 'Password1!');
    await userEvent.click(screen.getByRole('button', { name: /^sign in$/i }));
  }
  const staffCalls = () => calls.filter((u) => !/\/(config|auth\/[a-z/]+)$/.test(u) && !u.includes('.apk'));

  it('a client signing in with a password lands on the portal', async () => {
    renderAt('/login');
    await signInWithPassword();
    expect(await screen.findByRole('heading', { level: 1, name: 'Your projects' })).toBeInTheDocument();
    expect(screen.getByTestId('where')).toHaveTextContent(/^\/portal$/);
    expect(staffCalls()).toEqual([]);
    expect(io).not.toHaveBeenCalled();
  });

  it('a session that ended on a staff page still lands the client on the portal', async () => {
    renderAt('/dashboard');
    await signInWithPassword();
    expect(await screen.findByRole('heading', { level: 1, name: 'Your projects' })).toBeInTheDocument();
    expect(staffCalls()).toEqual([]);
  });

  it('with the email code, a client lands on the portal too', async () => {
    renderAt('/login');
    await userEvent.click(await screen.findByRole('tab', { name: /email code/i }));
    await userEvent.type(screen.getByLabelText(/email or username/i), 'huda@client.test');
    await userEvent.click(screen.getByRole('button', { name: /email me a code/i }));
    await userEvent.type(await screen.findByLabelText(/one-time code/i), '482913');
    await userEvent.click(screen.getByRole('button', { name: /verify & sign in/i }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Your projects' })).toBeInTheDocument();
  });

  it('an invitation link opened signed out: after sign-in the meeting opens in the portal', async () => {
    renderAt('/meetings/m1');
    await signInWithPassword();
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/portal/projects/p1/meetings/m1'));
    expect(await screen.findByRole('heading', { level: 2, name: 'Site walk-through' })).toBeInTheDocument();
    expect(staffCalls()).toEqual([]);
  });

  it('a portal deep link survives sign-in', async () => {
    renderAt('/portal/projects/p1/tasks/t2');
    await signInWithPassword();
    expect(await screen.findByRole('heading', { level: 2, name: 'Paint the walls' })).toBeInTheDocument();
    expect(screen.getByTestId('where')).toHaveTextContent('/portal/projects/p1/tasks/t2');
  });
});
