import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../../App';
import { useAuthStore } from '../../stores/auth-store';
import { ApiError } from '../../lib/api-client';
import { card, home, meetingItem, meetingView, notice, notices, noticeSettings, portalFile, projectView, taskView } from './portal-fixtures';
import { EMPTY_PORTAL_TRAINING, PREVIEW_ONLY, type PortalApi } from '../../api/portal';
import { useTourStore } from '../../components/training/tour-store';
import { card as courseCard, detail as courseDetail, lesson as courseLesson, mine as courseMine, myTraining } from '../../components/training/training-fixtures';
import { PortalApiProvider } from '../../components/portal/portal-context';
import { PortalPreviewRoutes } from './PortalPreviewRoutes';

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
  upload: vi.fn(),
  file: vi.fn(),
  notices: vi.fn(),
  readNotice: vi.fn(),
  readAllNotices: vi.fn(),
  settings: vi.fn(),
  setSettings: vi.fn(),
  // The Learning Hub (Training Center).
  training: vi.fn(),
  trainingSummary: vi.fn(),
  trainingCourse: vi.fn(),
  trainingStart: vi.fn(),
  trainingLesson: vi.fn(),
  trainingProgress: vi.fn(),
  trainingComplete: vi.fn(),
  trainingStartAttempt: vi.fn(),
  trainingSaveAnswers: vi.fn(),
  trainingSubmit: vi.fn(),
  trainingResult: vi.fn(),
  trainingFile: vi.fn(),
  trainingCertificatePdf: vi.fn(),
  trainingFeedback: vi.fn(),
  trainingTourDone: vi.fn(),
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
  api.notices.mockResolvedValue(notices());
  api.settings.mockResolvedValue(noticeSettings());
  api.training.mockResolvedValue(EMPTY_PORTAL_TRAINING);
  api.trainingSummary.mockResolvedValue({ assigned: 0, overdue: 0, inProgress: 0, tour: { show: false } });
  useTourStore.setState({ open: false, autoShown: false });
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
    expect(screen.getAllByText('Fabrikam Logistics').length).toBeGreaterThan(0);
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

// Owner, 10 Nov 2026: comments newest first, the write box on top, live, and replies.
describe('Client portal: comments newest first, live, with replies', () => {
  const at = (h: number) => `2026-11-10T0${h}:00:00.000Z`;
  const three = () =>
    taskView({
      comments: [
        { id: 'c1', from: 'you', replyTo: null, body: 'Which white?', createdAt: at(1), edited: false },
        { id: 'c2', from: 'team', replyTo: 'c1', body: 'Snow white, as agreed.', createdAt: at(2), edited: false },
        { id: 'c3', from: 'you', replyTo: null, body: 'And the doors?', createdAt: at(3), edited: false },
      ],
    });
  const tops = () =>
    within(screen.getByRole('list', { name: 'Comments, newest first' }))
      .getAllByRole('listitem')
      .filter((li) => li.parentElement?.getAttribute('aria-label') === 'Comments, newest first')
      .map((li) => li.querySelector('[data-comment-body]')?.textContent);

  it('the newest comment first, replies under their comment, the write box above them', async () => {
    api.task.mockResolvedValue(three());
    renderAt('/portal/projects/p1/tasks/t2');
    expect(await screen.findByText('And the doors?')).toBeInTheDocument();
    expect(tops()).toEqual(['And the doors?', 'Which white?']);
    expect(within(screen.getByRole('list', { name: 'Replies' })).getByText('Snow white, as agreed.')).toBeInTheDocument();
    const box = screen.getByLabelText('Add a comment');
    expect(box.compareDocumentPosition(screen.getByText('And the doors?')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('my comment shows at the top at once and once only when the answer comes', async () => {
    let answer: (v: unknown) => void = () => {};
    api.comment.mockReturnValue(new Promise((r) => (answer = r)));
    renderAt('/portal/projects/p1/tasks/t2');
    await userEvent.type(await screen.findByLabelText('Add a comment'), 'Thanks!');
    await userEvent.click(screen.getByRole('button', { name: 'Send comment' }));
    expect(tops()[0]).toBe('Thanks!');
    expect(screen.getByText('Sending…')).toBeInTheDocument();
    expect(screen.getByLabelText('Add a comment')).toHaveValue('');
    const after = taskView();
    after.comments = [...after.comments!, { id: 'c3', from: 'you', replyTo: null, body: 'Thanks!', createdAt: at(9), edited: false }];
    answer(after);
    await waitFor(() => expect(screen.queryByText('Sending…')).toBeNull());
    expect(screen.getAllByText('Thanks!')).toHaveLength(1);
    expect(screen.getByRole('status')).toHaveTextContent('Comment sent to the project team.');
  });

  it('one that didn’t go says so and keeps its words; Try again sends it again', async () => {
    api.comment.mockRejectedValueOnce(new TypeError('offline')).mockResolvedValueOnce(taskView());
    renderAt('/portal/projects/p1/tasks/t2');
    await userEvent.type(await screen.findByLabelText('Add a comment'), 'Please call me');
    await userEvent.click(screen.getByRole('button', { name: 'Send comment' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/^Not sent — /);
    expect(screen.getByText('Please call me')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(api.comment).toHaveBeenLastCalledWith('p1', 't2', 'Please call me');
  });

  it('reads the task again every few seconds while it is open, so the team’s replies arrive by themselves — marked “New reply”', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      renderAt('/portal/projects/p1/tasks/t2');
      expect(await screen.findByText('Snow white, as agreed.')).toBeInTheDocument();
      const later = taskView();
      later.comments = [...later.comments!, { id: 'c9', from: 'team', replyTo: 'c1', body: 'Two coats done.', createdAt: at(9), edited: false }];
      api.task.mockResolvedValue(later);
      await vi.advanceTimersByTimeAsync(5_500);
      expect(await screen.findByText('Two coats done.')).toBeInTheDocument();
      expect(screen.getByText('New reply')).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('a re-read still on its way when the answer comes doesn’t wipe the answer (no flicker back)', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      renderAt('/portal/projects/p1/tasks/t2');
      expect(await screen.findByText('Snow white, as agreed.')).toBeInTheDocument();
      let late: (v: unknown) => void = () => {};
      api.task.mockReturnValueOnce(new Promise((r) => (late = r)));
      await vi.advanceTimersByTimeAsync(5_200); // a re-read starts, and hangs
      const after = taskView();
      after.comments = [...after.comments!, { id: 'c3', from: 'you', replyTo: null, body: 'Thanks!', createdAt: at(9), edited: false }];
      api.comment.mockResolvedValue(after);
      await userEvent.type(screen.getByLabelText('Add a comment'), 'Thanks!');
      await userEvent.click(screen.getByRole('button', { name: 'Send comment' }));
      await waitFor(() => expect(screen.queryByText('Sending…')).toBeNull());
      late(taskView()); // the old answer arrives last
      await vi.advanceTimersByTimeAsync(50);
      expect(screen.getByText('Thanks!')).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('without the Comment action the task isn’t read again by itself', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      api.task.mockResolvedValue(taskView({ comments: null, can: { comment: false, signOff: true } }));
      renderAt('/portal/projects/p1/tasks/t2');
      expect(await screen.findByRole('heading', { level: 2, name: 'Paint the walls' })).toBeInTheDocument();
      await vi.advanceTimersByTimeAsync(12_000);
      expect(api.task).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('replies: to their own comment or the team’s reply, in the same thread; the team’s is never named', async () => {
    api.comment.mockResolvedValue(taskView());
    renderAt('/portal/projects/p1/tasks/t2');
    await userEvent.click(await screen.findByRole('button', { name: 'Reply to the project team' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Reply to the project team' }), 'Perfect');
    await userEvent.click(screen.getByRole('button', { name: 'Send reply' }));
    expect(api.comment).toHaveBeenCalledWith('p1', 't2', 'Perfect', 'c2');
    await waitFor(() => expect(screen.queryByRole('textbox', { name: 'Reply to the project team' })).toBeNull());
    await userEvent.click(screen.getByRole('button', { name: 'Reply to your comment' }));
    expect(screen.getByRole('textbox', { name: 'Reply to your comment' })).toHaveValue('');
  });

  it('their reply under a comment that was deleted keeps its thread: “Comment deleted” above it', async () => {
    api.task.mockResolvedValue(taskView({ comments: [{ id: 'r1', from: 'you', replyTo: 'gone', body: 'Still waiting', createdAt: at(4), edited: false }] }));
    renderAt('/portal/projects/p1/tasks/t2');
    expect(await screen.findByText('Comment deleted')).toBeInTheDocument();
    expect(screen.getByText('Still waiting')).toBeInTheDocument();
  });

  it('shows the newest 30, then more with Show older comments', async () => {
    const many = Array.from({ length: 35 }, (_, i) => ({ id: `k${i}`, from: 'you' as const, replyTo: null, body: `Note ${i}`, createdAt: new Date(Date.UTC(2026, 10, 1, 0, i)).toISOString(), edited: false }));
    api.task.mockResolvedValue(taskView({ comments: many }));
    renderAt('/portal/projects/p1/tasks/t2');
    expect(await screen.findByText('Note 34')).toBeInTheDocument();
    expect(screen.queryByText('Note 4')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Show older comments' }));
    expect(screen.getByText('Note 0')).toBeInTheDocument();
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

/** Downloads are caught: the names the page saved files under. */
function catchDownloads() {
  const saved: string[] = [];
  Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:x'), revokeObjectURL: vi.fn() });
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    saved.push(this.download);
  });
  return { saved, restore: () => click.mockRestore() };
}

describe('1.23.7 Client portal: files on a task', () => {
  const twoFiles = () => [
    portalFile(),
    portalFile({ id: 'f2', name: 'Snag photos.zip', type: 'application/zip', sizeBytes: 2048, addedAt: '2026-11-05T06:00:00.000Z', from: 'you' }),
  ];

  it('lists the files — name, size, day, who added them — and Download saves under the server’s name', async () => {
    api.task.mockResolvedValue(taskView({ files: twoFiles(), can: { comment: true, signOff: true, upload: false } }));
    api.file.mockResolvedValue(new File(['%PDF'], 'Site plan (server).pdf', { type: 'application/pdf' }));
    const downloads = catchDownloads();
    renderAt('/portal/projects/p1/tasks/t2');
    const section = await screen.findByRole('region', { name: 'Files' });
    const items = within(section).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(within(items[0]!).getByText('Site plan.pdf')).toBeInTheDocument();
    expect(within(items[0]!).getByText(/1\.2 MB/)).toBeInTheDocument();
    expect(within(items[0]!).getByText(/3 Nov 2026/)).toBeInTheDocument();
    expect(within(items[0]!).getByText(/Shared by the project team/)).toBeInTheDocument();
    expect(within(items[1]!).getByText(/2 KB/)).toBeInTheDocument();
    expect(within(items[1]!).getByText(/Uploaded by you/)).toBeInTheDocument();
    // Without the Upload action: no upload box.
    expect(within(section).queryByLabelText('Upload a document')).toBeNull();
    await userEvent.click(within(items[0]!).getByRole('button', { name: 'Download Site plan.pdf' }));
    await waitFor(() => expect(downloads.saved).toEqual(['Site plan (server).pdf']));
    expect(api.file).toHaveBeenCalledWith('p1', 't2', 'f1');
    downloads.restore();
  });

  it('a failed download says so in plain words', async () => {
    api.task.mockResolvedValue(taskView({ files: twoFiles() }));
    api.file.mockRejectedValue(notShared());
    renderAt('/portal/projects/p1/tasks/t2');
    const section = await screen.findByRole('region', { name: 'Files' });
    await userEvent.click(within(section).getByRole('button', { name: 'Download Snag photos.zip' }));
    expect(await within(section).findByRole('alert')).toHaveTextContent('This isn’t shared with you.');
  });

  it('with Upload: a document goes up with its progress shown, the list shows it, and the client is told who sees it', async () => {
    api.task.mockResolvedValue(taskView({ files: [], can: { comment: true, signOff: true, upload: true } }));
    const after = taskView({ files: [portalFile({ id: 'f9', name: 'Snag list.pdf', from: 'you' })], can: { comment: true, signOff: true, upload: true } });
    let release: () => void = () => {};
    api.upload.mockImplementation((_p: string, _t: string, _f: File, onProgress?: (n: number) => void) => {
      onProgress?.(0.4);
      return new Promise((resolve) => {
        release = () => resolve(after);
      });
    });
    renderAt('/portal/projects/p1/tasks/t2');
    const section = await screen.findByRole('region', { name: 'Files' });
    expect(within(section).getByText('No documents yet.')).toBeInTheDocument();
    expect(section).toHaveTextContent(/The project team sees what you upload\. Other clients on this project see it only if the team shares it with them\./);
    const doc = new File(['hello'], 'Snag list.pdf', { type: 'application/pdf' });
    await userEvent.upload(within(section).getByLabelText('Upload a document'), doc);
    expect(await within(section).findByRole('progressbar', { name: 'Uploading Snag list.pdf' })).toHaveAttribute('aria-valuenow', '40');
    expect(within(section).getByLabelText('Upload a document')).toBeDisabled();
    release();
    expect(await within(section).findByText('Uploaded by you', { exact: false })).toBeInTheDocument();
    expect(within(section).getByRole('status')).toHaveTextContent('Uploaded Snag list.pdf. The project team can see it.');
    expect(within(section).queryByRole('progressbar')).toBeNull();
    expect(api.upload).toHaveBeenCalledWith('p1', 't2', doc, expect.any(Function));
  });

  it('a refused upload says the server’s words (400), and plain words for 403, 404 and 429', async () => {
    api.task.mockResolvedValue(taskView({ files: [], can: { comment: true, signOff: true, upload: true } }));
    api.upload
      .mockRejectedValueOnce(new ApiError(400, 'VALIDATION', 'This type of file can’t be uploaded.'))
      .mockRejectedValueOnce(new ApiError(403, 'FORBIDDEN', 'Request failed (403)'))
      .mockRejectedValueOnce(notShared())
      .mockRejectedValueOnce(new ApiError(429, 'RATE_LIMITED', 'Request failed (429)'));
    renderAt('/portal/projects/p1/tasks/t2');
    const input = await screen.findByLabelText('Upload a document');
    const doc = () => new File(['x'], 'run.exe', { type: 'application/octet-stream' });
    await userEvent.upload(input, doc());
    expect(await screen.findByRole('alert')).toHaveTextContent('This type of file can’t be uploaded.');
    await userEvent.upload(input, doc());
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('You can’t do that on this project.'));
    await userEvent.upload(input, doc());
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('This isn’t shared with you.'));
    await userEvent.upload(input, doc());
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Too many uploads at once. Wait a minute and try again.'));
    expect(api.upload).toHaveBeenCalledTimes(4);
  });

  it('a file over 10 MB is stopped before it is sent', async () => {
    api.task.mockResolvedValue(taskView({ files: [], can: { comment: true, signOff: true, upload: true } }));
    renderAt('/portal/projects/p1/tasks/t2');
    const big = new File(['x'], 'site video.mov', { type: 'video/quicktime' });
    Object.defineProperty(big, 'size', { value: 11 * 1024 * 1024 });
    await userEvent.upload(await screen.findByLabelText('Upload a document'), big);
    expect(await screen.findByRole('alert')).toHaveTextContent('site video.mov is bigger than 10 MB. Choose a smaller file.');
    expect(api.upload).not.toHaveBeenCalled();
  });

  it('no Files section with no files and no Upload action (nor from an older server)', async () => {
    api.task.mockResolvedValue(taskView({ files: [], can: { comment: true, signOff: true, upload: false } }));
    const first = renderAt('/portal/projects/p1/tasks/t2');
    expect(await screen.findByRole('heading', { level: 2, name: 'Paint the walls' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Files' })).toBeNull();
    first.unmount();
    api.task.mockResolvedValue(taskView());
    renderAt('/portal/projects/p1/tasks/t2');
    expect(await screen.findByRole('heading', { level: 2, name: 'Paint the walls' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Files' })).toBeNull();
  });
});

describe('1.23.7 Client portal: the bell and Notifications', () => {
  const three = () => [
    notice(),
    notice({ id: 'n2', kind: 'minutes', title: 'Minutes approved: Site walk-through', taskId: null, meetingId: 'm1', read: true, createdAt: '2026-11-03T06:00:00.000Z' }),
    notice({ id: 'n3', kind: 'document', title: 'New document on MICO-12', body: 'Site plan.pdf', project: { id: 'p2', name: 'Rig survey' }, taskId: 't9', createdAt: '2026-11-02T06:00:00.000Z' }),
  ];

  it('the bell in the header says how many are unread, and opens Notifications', async () => {
    api.notices.mockResolvedValue(notices(three()));
    renderAt('/portal');
    const bell = await screen.findByRole('link', { name: 'Notifications, 2 unread' });
    expect(within(bell).getByText('2')).toBeInTheDocument();
    await userEvent.click(bell);
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/portal/notifications'));
    expect(await screen.findByRole('heading', { level: 1, name: 'Notifications' })).toBeInTheDocument();
  });

  it('with nothing unread the bell has no count', async () => {
    api.notices.mockResolvedValue(notices([notice({ read: true })]));
    renderAt('/portal');
    await waitFor(() => expect(api.notices).toHaveBeenCalled());
    const bell = await screen.findByRole('link', { name: 'Notifications' });
    expect(bell).toHaveAttribute('href', '/portal/notifications');
    expect(bell).not.toHaveTextContent(/\d/);
  });

  it('lists each notice — title, project, when, unread — linked to its item; opening one marks it read', async () => {
    api.notices.mockResolvedValue(notices(three()));
    api.readNotice.mockResolvedValue({ unread: 1 });
    renderAt('/portal/notifications');
    const list = await screen.findByRole('list', { name: 'Notifications' });
    const links = within(list).getAllByRole('link');
    expect(links.map((l) => l.getAttribute('href'))).toEqual(['/portal/projects/p1/tasks/t2', '/portal/projects/p1/meetings/m1', '/portal/projects/p2/tasks/t9']);
    expect(links[0]).toHaveTextContent('The project team replied to your comment');
    expect(links[0]).toHaveTextContent('Office fit-out');
    expect(links[0]).toHaveTextContent('4 Nov 2026, 10:30');
    expect(links[0]).toHaveTextContent('Unread');
    expect(links[1]).not.toHaveTextContent('Unread');
    expect(links[2]).toHaveTextContent('Site plan.pdf');
    expect(links[2]).toHaveTextContent('Rig survey');
    await userEvent.click(links[0]!);
    await waitFor(() => expect(api.readNotice).toHaveBeenCalledWith('n1'));
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/portal/projects/p1/tasks/t2'));
    expect(await screen.findByRole('link', { name: 'Notifications, 1 unread' })).toBeInTheDocument();
  });

  it('opening one already read asks nothing', async () => {
    api.notices.mockResolvedValue(notices(three()));
    renderAt('/portal/notifications');
    await userEvent.click(await screen.findByRole('link', { name: /Minutes approved/ }));
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/portal/projects/p1/meetings/m1'));
    expect(api.readNotice).not.toHaveBeenCalled();
  });

  it('Mark all as read', async () => {
    api.notices.mockResolvedValue(notices(three()));
    api.readAllNotices.mockResolvedValue({ unread: 0 });
    renderAt('/portal/notifications');
    await userEvent.click(await screen.findByRole('button', { name: 'Mark all as read' }));
    await waitFor(() => expect(api.readAllNotices).toHaveBeenCalled());
    expect(await screen.findByRole('link', { name: 'Notifications' })).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Notifications' })).not.toHaveTextContent('Unread');
    expect(screen.getByRole('status')).toHaveTextContent('All notifications are marked as read.');
    expect(screen.queryByRole('button', { name: 'Mark all as read' })).toBeNull();
  });

  it('with none yet it says so, and links to the settings', async () => {
    renderAt('/portal/notifications');
    expect(await screen.findByText('No notifications yet.')).toBeInTheDocument();
    expect(within(screen.getByRole('main')).getByRole('link', { name: 'Notification settings' })).toHaveAttribute('href', '/portal/settings');
    expect(screen.queryByRole('button', { name: 'Mark all as read' })).toBeNull();
  });
});

describe('1.23.7 Client portal: notification settings', () => {
  it('four switches, invitations always sent, and the projects whose notices the team turned off', async () => {
    api.settings.mockResolvedValue(
      noticeSettings({ document: false }, [
        { id: 'p1', name: 'Office fit-out', notify: true },
        { id: 'p2', name: 'Rig survey', notify: false },
      ]),
    );
    renderAt('/portal/settings');
    expect(await screen.findByRole('heading', { level: 1, name: 'Notification settings' })).toBeInTheDocument();
    expect(await screen.findByRole('switch', { name: 'Replies to your comments' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('switch', { name: 'Tasks ready for your sign-off' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('switch', { name: 'Approved meeting minutes' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('switch', { name: 'New documents shared with you' })).toHaveAttribute('aria-checked', 'false');
    expect(screen.getAllByRole('switch')).toHaveLength(4);
    expect(screen.getByText('Meeting invitations')).toBeInTheDocument();
    expect(screen.getByText('Always sent')).toBeInTheDocument();
    expect(screen.getByText(/The project team has turned notifications off for/)).toHaveTextContent('The project team has turned notifications off for: Rig survey.');
  });

  it('no line about projects when the team lets every project’s notices through', async () => {
    renderAt('/portal/settings');
    expect(await screen.findByRole('switch', { name: 'Replies to your comments' })).toBeInTheDocument();
    expect(screen.queryByText(/turned notifications off/)).toBeNull();
  });

  it('a switch saves at once, and says so', async () => {
    api.setSettings.mockResolvedValue(noticeSettings({ reply: false }));
    renderAt('/portal/settings');
    const sw = await screen.findByRole('switch', { name: 'Replies to your comments' });
    await userEvent.click(sw);
    await waitFor(() => expect(api.setSettings).toHaveBeenCalledWith({ reply: false }));
    expect(await screen.findByRole('status')).toHaveTextContent('Saved. Replies to your comments: off.');
    expect(screen.getByRole('switch', { name: 'Replies to your comments' })).toHaveAttribute('aria-checked', 'false');
  });

  it('a failed save says so, and the switch goes back', async () => {
    api.setSettings.mockRejectedValue(new TypeError('offline'));
    renderAt('/portal/settings');
    await userEvent.click(await screen.findByRole('switch', { name: 'Approved meeting minutes' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t save your choice. Check your connection and try again.');
    expect(screen.getByRole('switch', { name: 'Approved meeting minutes' })).toHaveAttribute('aria-checked', 'true');
  });
});

/** Another API for the portal's pages (as Preview as client gives them): every read answered, every write recorded. */
function otherApi() {
  return {
    me: vi.fn(async () => home()),
    project: vi.fn(async () => projectView()),
    task: vi.fn(async () => taskView({ files: [portalFile()], can: { comment: true, signOff: true, upload: true } })),
    meetings: vi.fn(async () => [meetingItem()]),
    meeting: vi.fn(async () => meetingView()),
    notices: vi.fn(async () => notices([notice()])),
    settings: vi.fn(async () => noticeSettings()),
    training: vi.fn(async () => EMPTY_PORTAL_TRAINING),
    trainingSummary: vi.fn(async () => ({ assigned: 0, overdue: 0, inProgress: 0, tour: { show: false } })),
    comment: vi.fn(),
    accept: vi.fn(),
    sendBack: vi.fn(),
    taskListPdf: vi.fn(),
    respond: vi.fn(),
    minutesPdf: vi.fn(),
    markDone: vi.fn(),
    whereIs: vi.fn(),
    changePassword: vi.fn(),
    upload: vi.fn(),
    file: vi.fn(),
    readNotice: vi.fn(),
    readAllNotices: vi.fn(),
    setSettings: vi.fn(),
    trainingCourse: vi.fn(),
    trainingStart: vi.fn(),
    trainingLesson: vi.fn(),
    trainingProgress: vi.fn(),
    trainingComplete: vi.fn(),
    trainingStartAttempt: vi.fn(),
    trainingSaveAnswers: vi.fn(),
    trainingSubmit: vi.fn(),
    trainingResult: vi.fn(),
    trainingFile: vi.fn(),
    trainingCertificatePdf: vi.fn(),
    trainingFeedback: vi.fn(),
    trainingTourDone: vi.fn(),
  };
}
type OtherApi = ReturnType<typeof otherApi>;
const WRITES = [
  'comment', 'accept', 'sendBack', 'taskListPdf', 'respond', 'minutesPdf', 'markDone', 'whereIs', 'changePassword', 'upload', 'file', 'readNotice', 'readAllNotices', 'setSettings',
  'trainingStart', 'trainingProgress', 'trainingComplete', 'trainingStartAttempt', 'trainingSaveAnswers', 'trainingSubmit', 'trainingFeedback', 'trainingTourDone',
] as const;

/** The portal's pages as Preview as client shows them: through the given API, read-only. */
function renderPreview(path: string, given: OtherApi, preview = true) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <PortalApiProvider api={given as unknown as PortalApi} preview={preview}>
        <MemoryRouter initialEntries={[path]}>
          <PortalPreviewRoutes />
          <Where />
        </MemoryRouter>
      </PortalApiProvider>
    </QueryClientProvider>,
  );
}

/** Shown, but switched off, with a hint that it's a preview. */
function off(el: HTMLElement) {
  expect(el).toBeDisabled();
  expect(el).toHaveAttribute('title', expect.stringMatching(/^Preview/));
}

describe('1.23.7 Client portal: Preview as client', () => {
  it('a preview is a still look: the task is not read again by itself (owner, 10 Nov 2026)', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const other = otherApi();
      renderPreview('/portal/projects/p1/tasks/t2', other);
      expect(await screen.findByRole('heading', { level: 2, name: 'Paint the walls' })).toBeInTheDocument();
      await vi.advanceTimersByTimeAsync(12_000);
      expect(other.task).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('every read goes through the API the pages are given, never the client’s own', async () => {
    const other = otherApi();
    const task = renderPreview('/portal/projects/p1/tasks/t2', other, false);
    expect(await screen.findByRole('heading', { level: 2, name: 'Paint the walls' })).toBeInTheDocument();
    task.unmount();
    const meeting = renderPreview('/portal/projects/p1/meetings/m1', other, false);
    expect(await screen.findByRole('heading', { level: 2, name: 'Site walk-through' })).toBeInTheDocument();
    meeting.unmount();
    const list = renderPreview('/portal/projects/p1/meetings', other, false);
    expect(await screen.findByRole('link', { name: /Site walk-through/ })).toBeInTheDocument();
    list.unmount();
    renderPreview('/portal/settings', other, false);
    expect(await screen.findByRole('switch', { name: 'Replies to your comments' })).toBeInTheDocument();
    for (const read of ['me', 'project', 'task', 'meetings', 'meeting', 'notices', 'settings'] as const) expect(other[read], read).toHaveBeenCalled();
    for (const fn of Object.values(api)) expect(fn).not.toHaveBeenCalled();
  });

  it('a banner says it is a preview; on a task every action is shown but switched off', async () => {
    const other = otherApi();
    renderPreview('/portal/projects/p1/tasks/t2', other);
    expect(await screen.findByText(PREVIEW_ONLY)).toBeInTheDocument();
    expect(await screen.findByRole('heading', { level: 2, name: 'Paint the walls' })).toBeInTheDocument();
    off(screen.getByRole('button', { name: 'Accept' }));
    off(screen.getByRole('button', { name: 'Send back' }));
    off(screen.getByLabelText('Add a comment'));
    off(screen.getByRole('button', { name: 'Send comment' }));
    expect(screen.getByLabelText('Upload a document')).toBeDisabled();
    off(screen.getByRole('button', { name: 'Download Site plan.pdf' }));
    off(screen.getByRole('button', { name: 'Change password' }));
    off(screen.getByRole('button', { name: 'Sign out' }));
    // The privacy notice is words, not a way out of the preview.
    expect(screen.queryByRole('link', { name: 'Privacy notice' })).toBeNull();
    expect(screen.getByText('Privacy notice')).toBeInTheDocument();
    // Pressing them does nothing.
    await userEvent.click(screen.getByRole('button', { name: 'Accept' }));
    await userEvent.click(screen.getByRole('button', { name: 'Change password' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
    for (const w of WRITES) expect(other[w], w).not.toHaveBeenCalled();
  });

  it('on a meeting and the task list: answers, Mark done and the PDFs are switched off', async () => {
    const other = otherApi();
    const meeting = renderPreview('/portal/projects/p1/meetings/m1', other);
    expect(await screen.findByRole('heading', { level: 2, name: 'Site walk-through' })).toBeInTheDocument();
    const answers = screen.getByRole('group', { name: 'Your answer' });
    for (const name of ['Accept', 'Maybe', 'Decline']) off(within(answers).getByRole('button', { name }));
    off(screen.getByRole('button', { name: 'Mark done: Send the carpet samples' }));
    off(screen.getByRole('button', { name: 'Download minutes (PDF)' }));
    meeting.unmount();
    renderPreview('/portal/projects/p1/progress', other);
    off(await screen.findByRole('button', { name: 'Download task list (PDF)' }));
    for (const w of WRITES) expect(other[w], w).not.toHaveBeenCalled();
  });

  it('notifications and settings are read, but marking read and the switches are off', async () => {
    const other = otherApi();
    const page = renderPreview('/portal/notifications', other);
    off(await screen.findByRole('button', { name: 'Mark all as read' }));
    await userEvent.click(screen.getByRole('link', { name: /The project team replied/ }));
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/portal/projects/p1/tasks/t2'));
    page.unmount();
    renderPreview('/portal/settings', other);
    const switches = await screen.findAllByRole('switch');
    expect(switches).toHaveLength(4);
    for (const s of switches) expect(s).toBeDisabled();
    await userEvent.click(switches[0]!);
    for (const w of WRITES) expect(other[w], w).not.toHaveBeenCalled();
  });

  it('the preview has every portal page a client has (but the invitation-link redirect)', () => {
    const read = (f: string) => readFileSync(join(__dirname, f), 'utf8');
    const app = read('../../App.tsx');
    const block = app.slice(app.indexOf('<Route element={<ClientRoute />}>'), app.indexOf('<Route element={<StaffRoute />}>'));
    const paths = (text: string) => [...text.matchAll(/path="([^"]+)"/g)].map((m) => m[1]!);
    const preview = paths(read('PortalPreviewRoutes.tsx'));
    expect(paths(block).length).toBeGreaterThan(8);
    expect(paths(block).filter((p) => !preview.includes(p) && p !== '/portal/meetings/:meetingId' && p !== '/portal/*')).toEqual([]);
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

describe('Learning Hub in the Client portal', () => {
  const PORTAL_COURSE = courseCard({ id: 'pc1', title: 'Client portal basics', moduleKey: 'portal', audience: 'CLIENTS', mine: courseMine({ dueDay: '2026-11-04', overdue: true }) });

  it('the header’s Learning Hub (44px) with how many courses wait, red when one is overdue; the home page’s card says so too', async () => {
    api.trainingSummary.mockResolvedValue({ assigned: 2, overdue: 1, inProgress: 1, tour: { show: false } });
    renderAt('/portal');
    const link = await screen.findByRole('link', { name: 'Learning Hub, 2 to do, 1 overdue' });
    expect(link).toHaveAttribute('href', '/portal/training');
    expect(link.className).toContain('!min-h-11');
    expect(link.querySelector('[data-training-badge="overdue"]')).toHaveTextContent('1');
    const cardLink = await screen.findByRole('link', { name: /Learning Hub 2 courses for you to do/ });
    expect(within(cardLink).getByText('1 overdue')).toBeInTheDocument();
    expect(calls).toEqual([]);
  });

  it('nothing waiting: no count', async () => {
    renderAt('/portal');
    expect(await screen.findByRole('link', { name: 'Learning Hub' })).toBeInTheDocument();
    expect(document.querySelector('[data-training-badge]')).toBeNull();
  });

  it('Learn this feature on the home page: the portal’s course (through the portal’s API)', async () => {
    api.training.mockResolvedValue({ ...EMPTY_PORTAL_TRAINING, catalogue: [PORTAL_COURSE] });
    renderAt('/portal');
    expect(await screen.findByRole('link', { name: 'Learn this feature' })).toHaveAttribute('href', '/portal/training/courses/pc1?module=portal');
    expect(calls).toEqual([]);
  });

  it('/portal/training: Up next (overdue in red), older certificates, and more courses — a course never listed twice; all through the portal’s API', async () => {
    const other = courseCard({ id: 'pc2', title: 'Sign-off basics', moduleKey: 'portal', audience: 'CLIENTS', mine: courseMine({ enrolled: false, assigned: false, mandatory: false, status: 'NOT_STARTED', progressPct: 0, dueDay: null }) });
    api.training.mockResolvedValue({ ...myTraining({ assigned: [PORTAL_COURSE], inProgress: [], completed: [] }), catalogue: [PORTAL_COURSE, other], tour: { show: false } });
    renderAt('/portal/training');
    expect(await screen.findByRole('heading', { level: 1, name: 'Learning Hub' })).toBeInTheDocument();
    const upNext = await screen.findByRole('region', { name: 'Up next' });
    expect(within(upNext).getByRole('link', { name: 'Client portal basics' })).toHaveAttribute('href', '/portal/training/courses/pc1');
    expect(within(upNext).getByText('Overdue · was due 4 Nov')).toBeInTheDocument();
    // Listed once: not again under the courses below.
    expect(screen.getAllByRole('link', { name: 'Client portal basics' })).toHaveLength(1);
    const more = screen.getByRole('region', { name: /^More courses/ });
    expect(within(more).getByRole('link', { name: 'Sign-off basics' })).toHaveAttribute('href', '/portal/training/courses/pc2');
    expect(screen.getByRole('button', { name: 'Older certificates' })).toBeInTheDocument();
    expect(screen.queryByText(/catalogue/i)).toBeNull();
    expect(screen.getByRole('link', { name: 'Learning Hub' })).toHaveAttribute('aria-current', 'page');
    expect(calls).toEqual([]);
    expect(io).not.toHaveBeenCalled();
  });

  it('/portal/training with nothing to do: one line, the courses below (filters only above 3 courses)', async () => {
    const list = [1, 2, 3, 4].map((n) => courseCard({ id: `p${n}`, title: `Portal course ${n}`, moduleKey: 'portal', audience: 'CLIENTS', mine: courseMine({ enrolled: false, assigned: false, mandatory: false, status: 'NOT_STARTED', progressPct: 0, dueDay: null }) }));
    api.training.mockResolvedValue({ ...EMPTY_PORTAL_TRAINING, catalogue: list.slice(0, 3) });
    const a = renderAt('/portal/training');
    expect(await screen.findByText('Nothing to do right now')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: /^Courses \(3\)/ })).toBeInTheDocument();
    expect(screen.queryByRole('searchbox', { name: 'Search courses' })).toBeNull();
    a.unmount();
    api.training.mockResolvedValue({ ...EMPTY_PORTAL_TRAINING, catalogue: list });
    renderAt('/portal/training');
    expect(await screen.findByRole('searchbox', { name: 'Search courses' })).toBeInTheDocument();
  });

  it('a course and its lesson: the staff pages’ parts, through the portal’s API', async () => {
    api.trainingCourse.mockResolvedValue(courseDetail({ id: 'pc1', title: 'Client portal basics', moduleKey: 'portal', audience: 'CLIENTS', mine: courseMine({ enrolled: false, status: 'NOT_STARTED', progressPct: 0 }), resumeLessonId: 'l2' }));
    api.trainingStart.mockResolvedValue(courseDetail({ id: 'pc1', resumeLessonId: 'l2' }));
    api.trainingLesson.mockResolvedValue(courseLesson({ courseId: 'pc1', courseTitle: 'Client portal basics', steps: [{ id: 's1', position: 0, title: 'Open a project', body: null, image: null }] }));
    api.trainingComplete.mockResolvedValue({ courseProgressPct: 50, courseCompleted: false, certificateId: null, nextLessonId: 'l3' });
    renderAt('/portal/training/courses/pc1');
    expect(await screen.findByRole('heading', { level: 1, name: 'Client portal basics' })).toBeInTheDocument();
    expect(within(screen.getByRole('navigation', { name: 'Breadcrumb' })).getByRole('link', { name: 'Learning Hub' })).toHaveAttribute('href', '/portal/training');
    await userEvent.click(screen.getByRole('button', { name: 'Start' }));
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/portal/training/courses/pc1/lessons/l2'));
    expect(api.trainingStart).toHaveBeenCalledWith('pc1');
    expect(await screen.findByRole('heading', { level: 1, name: 'Make a task' })).toBeInTheDocument();
    // One step: its one Next finishes the lesson and opens the next one.
    await userEvent.click(screen.getByRole('button', { name: 'Next lesson' }));
    await waitFor(() => expect(api.trainingComplete).toHaveBeenCalledWith('l2'));
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/portal/training/courses/pc1/lessons/l3'));
    expect(calls).toEqual([]);
  });

  it('the first-time tour (3 steps) opens by itself for a new client; Skip tells the server', async () => {
    api.trainingSummary.mockResolvedValue({ assigned: 0, overdue: 0, inProgress: 0, tour: { show: true } });
    api.trainingTourDone.mockResolvedValue({ ok: true });
    renderAt('/portal');
    expect(await screen.findByRole('dialog', { name: 'Your projects' })).toBeInTheDocument();
    expect(screen.getByText('Step 1 of 3')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByRole('dialog', { name: 'Notifications' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Skip tour' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() => expect(api.trainingTourDone).toHaveBeenCalledTimes(1));
    expect(calls).toEqual([]);
  });

  it('Tour of the site again from the Learning Hub (the portal has no account menu)', async () => {
    renderAt('/portal/training');
    await userEvent.click(await screen.findByRole('button', { name: 'Tour of the site' }));
    expect(await screen.findByRole('dialog', { name: 'Your projects' })).toBeInTheDocument();
  });

  it('in a Preview as client: the Learning Hub is shown empty, and nothing is sent', async () => {
    const other = otherApi();
    renderPreview('/portal/training', other);
    expect(await screen.findByText('Preview — the client’s courses aren’t shown here.')).toBeInTheDocument();
    off(screen.getByRole('button', { name: 'Tour of the site' }));
    expect(other.training).toHaveBeenCalled();
    for (const w of WRITES) expect(other[w], w).not.toHaveBeenCalled();
    for (const fn of Object.values(api)) expect(fn).not.toHaveBeenCalled();
  });
});
