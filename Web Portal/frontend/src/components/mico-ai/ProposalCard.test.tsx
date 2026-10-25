import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within, fireEvent, act, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ProposalCard, type ProposalActions } from './ProposalCard';
import type { ConfirmBody, CreateTaskChange, MeetingChange, MicoAiProposal, MinutesChange, ProposalChange, UpdateTaskChange } from '../../api/mico-ai';
import { useAuthStore } from '../../stores/auth-store';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const base = { problem: null, locked: false, warning: null, result: null, undo: null };
const create = (id: string, extra: Partial<CreateTaskChange> = {}): CreateTaskChange => ({
  ...base,
  id,
  type: 'create_task',
  fields: { title: 'Replace the gauge', projectId: 'p-rig', assigneeIds: ['u-sara'], due: '2026-10-27', priority: 'HIGH', description: '' },
  labels: { project: 'Rig Inspection Portal', assignees: [{ id: 'u-sara', name: 'Sara Ahmed' }] },
  ...extra,
});
const update = (id: string, extra: Partial<UpdateTaskChange> = {}): UpdateTaskChange => ({
  ...base,
  id,
  type: 'update_task',
  task: { id: 't14', key: 'RIG-14', title: 'Pressure test report', projectId: 'p-rig', project: 'Rig Inspection Portal', url: '?task=t14' },
  base: { version: 3, assigneeIds: ['u-omar'] },
  before: { due: '2026-10-19', priority: 'NORMAL', columnId: 'col-doing', column: 'In progress', assignees: [{ id: 'u-omar', name: 'Omar Said' }] },
  fields: { due: '2026-10-25', columnId: 'col-done', assigneeIds: ['u-sara'] },
  labels: { column: 'Done', assignees: [{ id: 'u-sara', name: 'Sara Ahmed' }] },
  ...extra,
});
const minutes = (id: string, extra: Partial<MinutesChange> = {}): MinutesChange => ({
  ...base,
  id,
  type: 'draft_minutes',
  meeting: { id: 'm-site', title: 'Site visit', startAt: '2026-10-22T06:00:00.000Z', url: '/meetings/m-site' },
  fields: { content: { summary: 'The pressure test moves to rig 3.', discussion: [{ topic: 'RIG-14', text: 'Gauge calibrated.' }], decisions: ['Finish after calibration'], risks: [], nextSteps: ['Sara: certificate by 25 Oct', 'Omar: report'] } },
  base: { status: 'NONE', savedAt: null },
  ...extra,
});
const meeting = (id: string, extra: Partial<MeetingChange> = {}): MeetingChange => ({
  ...base,
  id,
  type: 'schedule_meeting',
  fields: { title: 'Review', projectId: 'p-rig', date: '2026-10-27', time: '10:00', minutes: 30, attendeeIds: ['u-sara'], agenda: ['Pressure test'], description: '' },
  labels: { project: 'Rig Inspection Portal', attendees: [{ id: 'u-sara', name: 'Sara Ahmed' }] },
  ...extra,
});
const card = (items: ProposalChange[], extra: Partial<MicoAiProposal> = {}): MicoAiProposal => ({
  id: 'p1',
  status: 'proposed',
  note: null,
  sendInvites: true,
  hasMeetings: items.some((i) => i.type === 'schedule_meeting'),
  items,
  confirmedAt: null,
  undoUntil: null,
  canUndo: false,
  ...extra,
});

let actions: ProposalActions & { confirmed: ConfirmBody[]; announced: string[] };
function makeActions(result: string | null = null): typeof actions {
  const confirmed: ConfirmBody[] = [];
  const announced: string[] = [];
  return {
    confirmed,
    announced,
    confirm: vi.fn(async (body: ConfirmBody) => {
      confirmed.push(body);
      return result;
    }),
    cancel: vi.fn(async () => null),
    undo: vi.fn(async () => null),
    announce: (t: string) => void announced.push(t),
  };
}

function renderCard(proposal: MicoAiProposal) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const ui = (p: MicoAiProposal) => (
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/mico-ai?chat=c1']}>
        <ProposalCard proposal={p} actions={actions} />
      </MemoryRouter>
    </QueryClientProvider>
  );
  const r = render(ui(proposal));
  return { ...r, update: (p: MicoAiProposal) => r.rerender(ui(p)) };
}

beforeEach(() => {
  actions = makeActions();
  useAuthStore.setState({ user: { id: 'u-omar', email: 'omar@mico360.test', username: 'omar', roles: ['EMPLOYEE'] }, accessToken: 'token', isAuthenticated: true });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string) => {
      const path = String(input).replace(/^.*\/api\/v1/, '').split('?')[0]!;
      if (path === '/config') return json({ data: { timeZone: 'Asia/Muscat', productName: '', companyName: '', serverTime: new Date().toISOString() } });
      if (path === '/users/me/preferences') return json({ data: {} });
      if (path === '/projects') return json({ data: [{ id: 'p-rig', code: 'RIG', name: 'Rig Inspection Portal', status: 'ACTIVE' }, { id: 'p-fal', code: 'FAL', name: 'Falcon CRM', status: 'ACTIVE' }] });
      if (path === '/projects/p-rig/members')
        return json({ data: [{ id: 'u-sara', username: 'sara', email: '', firstName: 'Sara', lastName: 'Ahmed', role: 'MEMBER' }, { id: 'u-omar', username: 'omar', email: '', firstName: 'Omar', lastName: 'Said', role: 'MANAGER' }] });
      if (path === '/projects/p-rig/columns')
        return json({
          data: [
            { id: 'col-todo', projectId: 'p-rig', name: 'To do', category: 'TODO', position: 0, color: '#3A6EA5', enabled: true },
            { id: 'col-doing', projectId: 'p-rig', name: 'In progress', category: 'IN_PROGRESS', position: 1, color: '#B87611', enabled: true },
            { id: 'col-done', projectId: 'p-rig', name: 'Done', category: 'DONE', position: 2, color: '#2E7D53', enabled: true },
            { id: 'col-off', projectId: 'p-rig', name: 'Switched off', category: 'REVIEW', position: 3, color: '#000', enabled: false },
          ],
        });
      if (path === '/users/directory')
        return json({
          data: [
            { id: 'u-omar', username: 'omar', firstName: 'Omar', lastName: 'Said', avatarUrl: null, active: true },
            { id: 'u-sara', username: 'sara', firstName: 'Sara', lastName: 'Ahmed', avatarUrl: null, active: true },
            { id: 'u-bilal', username: 'bilal', firstName: 'Bilal', lastName: 'Ahmed', avatarUrl: null, active: true },
            { id: 'u-gone', username: 'gone', firstName: 'Gone', lastName: 'User', avatarUrl: null, active: false },
          ],
        });
      return json({ data: [] });
    }),
  );
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const confirmButton = () => screen.getByRole('button', { name: /^Confirm/ });

describe('MICO AI review card', () => {
  it('lists every change with a tick box; a change with a problem starts unticked; one that can’t go ahead has none', () => {
    renderCard(
      card(
        [
          create('c1'),
          create('c2', { fields: { ...create('c2').fields, title: 'Order spares' }, problem: 'Layla Hassan isn’t on Rig Inspection Portal, so they can’t be assigned.' }),
          update('c3', { locked: true, problem: 'Nothing to change: it’s already like this.' }),
        ],
        { note: 'MICO AI can’t delete anything, so that was left out.' },
      ),
    );
    expect(screen.getByRole('heading', { name: '3 changes to make' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Create “Replace the gauge”' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Create “Order spares”' })).not.toBeChecked();
    expect(screen.getByText('Layla Hassan isn’t on Rig Inspection Portal, so they can’t be assigned.')).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: 'Change RIG-14' })).not.toBeInTheDocument();
    expect(screen.getByText(/Can’t do:/)).toHaveTextContent('Can’t do: Nothing to change: it’s already like this.');
    expect(screen.getByRole('note')).toHaveTextContent('MICO AI can’t delete anything, so that was left out.');
    expect(confirmButton()).toHaveTextContent('Confirm (1)');
  });

  it('“Select all” ticks every change that can go ahead, and clears them; nothing ticked means nothing to confirm', async () => {
    renderCard(card([create('c1'), create('c2', { problem: 'Pick a project.' }), update('c3', { locked: true, problem: 'x' })]));
    const all = screen.getByRole('checkbox', { name: 'Select all' });
    await userEvent.click(all);
    expect(screen.getAllByRole('checkbox', { name: /^Create/ }).every((c) => (c as HTMLInputElement).checked)).toBe(true);
    expect(confirmButton()).toHaveTextContent('Confirm (2)');
    await userEvent.click(all);
    expect(confirmButton()).toBeDisabled();
  });

  it('shows a new task’s project, people, day (with its weekday) and priority, and a task change as before → after', () => {
    renderCard(card([create('c1', { ownerDefault: true }), update('c2')]));
    const row1 = screen.getByRole('group', { name: 'Create “Replace the gauge”' });
    expect(row1).toHaveTextContent('Rig Inspection Portal');
    expect(row1).toHaveTextContent('Sara Ahmed');
    expect(row1).toHaveTextContent('Tue 27 Oct');
    expect(row1).toHaveTextContent('High');
    expect(row1).toHaveTextContent('the project’s owner');
    const row2 = screen.getByRole('group', { name: 'Change RIG-14' });
    expect(within(row2).getByRole('link', { name: /RIG-14/ })).toHaveAttribute('href', '/mico-ai?chat=c1&task=t14');
    expect(row2).toHaveTextContent('DueMon 19 Oct→Sun 25 Oct');
    expect(row2).toHaveTextContent('StatusIn progress→Done');
    expect(row2).toHaveTextContent('AssignedOmar Said→Sara Ahmed');
  });

  it('edits a new task inline with the app’s own controls, and Confirm sends the edits', async () => {
    renderCard(card([create('c1'), create('c2', { fields: { ...create('c2').fields, title: 'Second' } })]));
    await userEvent.click(screen.getByRole('button', { name: 'Edit Create “Replace the gauge”' }));
    const due = screen.getByLabelText('Due date');
    fireEvent.change(due, { target: { value: '2026-11-02' } });
    await userEvent.click(await screen.findByRole('button', { name: 'Remove Sara Ahmed' }));
    await userEvent.clear(screen.getByLabelText('Title'));
    await userEvent.type(screen.getByLabelText('Title'), 'Replace the north gauge');
    // The row shows the edited values at once.
    expect(screen.getByRole('group', { name: 'Create “Replace the north gauge”' })).toHaveTextContent('Mon 2 Nov');
    await userEvent.click(confirmButton());
    expect(actions.confirmed).toEqual([
      {
        items: [
          { id: 'c1', include: true, edits: { due: '2026-11-02', assigneeIds: [], title: 'Replace the north gauge' } },
          { id: 'c2', include: true },
        ],
      },
    ]);
  });

  it('edits a task change: the status from the project’s own columns', async () => {
    renderCard(card([update('c1')]));
    await userEvent.click(screen.getByRole('button', { name: 'Edit Change RIG-14' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Status' }));
    expect(screen.queryByRole('option', { name: /Switched off/ })).not.toBeInTheDocument();
    await userEvent.click(await screen.findByRole('option', { name: /To do/ }));
    expect(screen.getByRole('group', { name: 'Change RIG-14' })).toHaveTextContent('StatusIn progress→To do');
    await userEvent.click(confirmButton());
    expect(actions.confirmed[0]!.items[0]).toEqual({ id: 'c1', include: true, edits: { columnId: 'col-todo' } });
  });

  it('Confirm can’t be sent twice: both buttons turn off at once', async () => {
    let finish: (v: string | null) => void = () => {};
    actions.confirm = vi.fn(() => new Promise<string | null>((r) => (finish = r)));
    renderCard(card([create('c1')]));
    const b = confirmButton();
    fireEvent.click(b);
    fireEvent.click(b);
    expect(actions.confirm).toHaveBeenCalledTimes(1);
    expect(b).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    expect(b).toHaveTextContent(/Making the changes/);
    await act(async () => finish('Couldn’t reach the server. Check your connection and try again.'));
    expect(screen.getByRole('alert')).toHaveTextContent('Couldn’t reach the server');
    expect(confirmButton()).toBeEnabled();
  });

  it('after Confirm: each change’s result, a summary that takes the focus, and one announcement', async () => {
    const items = [create('c1'), create('c2', { fields: { ...create('c2').fields, title: 'Second' } })];
    const view = renderCard(card(items));
    await userEvent.click(confirmButton());
    view.update(
      card(
        [
          { ...items[0]!, result: { status: 'done', message: null, link: { label: 'RIG-35', url: '?task=t35' } } },
          { ...items[1]!, result: { status: 'refused', message: 'Sara Ahmed isn’t on Rig Inspection Portal, so they can’t be assigned.', link: null } },
        ],
        { status: 'done', confirmedAt: new Date().toISOString(), undoUntil: new Date(Date.now() + 15 * 60_000).toISOString(), canUndo: true },
      ),
    );
    const summary = screen.getByText('1 done, 1 refused');
    await waitFor(() => expect(summary.closest('[tabindex="-1"]')).toHaveFocus());
    expect(screen.getByRole('link', { name: 'Open RIG-35' })).toHaveAttribute('href', '/mico-ai?chat=c1&task=t35');
    expect(screen.getByRole('group', { name: 'Create “Second”' })).toHaveTextContent('Refused: Sara Ahmed isn’t on Rig Inspection Portal, so they can’t be assigned.');
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(actions.announced).toEqual(['Changes made: 1 done, 1 refused.']);
  });

  it('Undo counts down from 15 minutes (quietly), undoes, then goes away when the time is up', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    const start = new Date('2026-10-25T08:00:00Z');
    vi.setSystemTime(start);
    const done = card([{ ...create('c1'), result: { status: 'done', message: null, link: { label: 'RIG-35', url: '?task=t35' } } }], {
      status: 'done',
      confirmedAt: start.toISOString(),
      undoUntil: new Date(start.getTime() + 15 * 60_000).toISOString(),
      canUndo: true,
    });
    const view = renderCard(done);
    expect(screen.getByRole('button', { name: /^Undo/ })).toHaveTextContent('Undo (15:00)');
    act(() => vi.advanceTimersByTime(28_000));
    expect(screen.getByRole('button', { name: /^Undo/ })).toHaveTextContent('Undo (14:32)');
    expect(screen.getByRole('button', { name: /^Undo/ })).toHaveAttribute('aria-label', 'Undo these changes (open for 15 minutes)');
    fireEvent.click(screen.getByRole('button', { name: /^Undo/ }));
    await act(async () => {});
    expect(actions.undo).toHaveBeenCalledTimes(1);
    view.update(
      card([{ ...done.items[0]!, undo: { status: 'undone', message: 'RIG-35 was deleted.' } }], { status: 'undone', confirmedAt: done.confirmedAt, undoUntil: done.undoUntil, canUndo: false }),
    );
    expect(screen.getByRole('group', { name: /Create/ })).toHaveTextContent('Undone: RIG-35 was deleted.');
    expect(actions.announced).toEqual(['Undo: 1 put back.']);

    // Another card, left alone: the button goes when the time is up.
    const other = renderCard({ ...done, id: 'p2' });
    act(() => vi.advanceTimersByTime(15 * 60_000));
    expect(within(other.container).queryByRole('button', { name: /^Undo/ })).not.toBeInTheDocument();
    expect(within(other.container).getByText('Undo is no longer available.')).toBeInTheDocument();
  });

  it('a change Undo couldn’t put back says why', () => {
    renderCard(
      card([{ ...create('c1'), result: { status: 'done', message: null, link: null }, undo: { status: 'refused', message: 'Sara Ahmed changed RIG-35 since, so it was left as it is.' } }], { status: 'undone' }),
    );
    expect(screen.getByRole('group', { name: /Create/ })).toHaveTextContent('Not undone: Sara Ahmed changed RIG-35 since, so it was left as it is.');
    expect(screen.getByText('0 put back, 1 left as it was')).toBeInTheDocument();
  });

  it('Cancel closes the card without changing anything', async () => {
    const view = renderCard(card([create('c1')]));
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(actions.cancel).toHaveBeenCalledTimes(1);
    view.update(card([create('c1')], { status: 'cancelled' }));
    expect(screen.getByText('Cancelled — nothing was changed.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Confirm/ })).not.toBeInTheDocument();
  });

  it('a meeting: when, how long, who and the agenda; “Email the invitations” is on by default and can be turned off', async () => {
    renderCard(card([meeting('c1')]));
    const row = screen.getByRole('group', { name: 'Schedule “Review”' });
    expect(row).toHaveTextContent('Tue 27 Oct, 10:00–10:30');
    expect(row).toHaveTextContent('30 min');
    expect(row).toHaveTextContent('Sara Ahmed');
    expect(row).toHaveTextContent('Pressure test');
    const invite = screen.getByRole('checkbox', { name: 'Email the invitations' });
    expect(invite).toBeChecked();
    await userEvent.click(invite);
    await userEvent.click(confirmButton());
    expect(actions.confirmed[0]).toEqual({ items: [{ id: 'c1', include: true }], sendInvites: false });
  });

  it('a meeting’s people come from the directory (active people, not the organizer)', async () => {
    renderCard(card([meeting('c1')]));
    await userEvent.click(screen.getByRole('button', { name: 'Edit Schedule “Review”' }));
    fireEvent.change(screen.getByLabelText('Time'), { target: { value: '11:30' } });
    await userEvent.click(screen.getByRole('combobox', { name: 'Add people' }));
    expect(await screen.findByRole('option', { name: /Bilal Ahmed/ })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /Gone User/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /Omar Said/ })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('option', { name: /Bilal Ahmed/ }));
    await userEvent.click(confirmButton());
    expect(actions.confirmed[0]!.items[0]).toEqual({ id: 'c1', include: true, edits: { time: '11:30', attendeeIds: ['u-sara', 'u-bilal'] } });
  });

  it('final minutes: a preview, where they go (a draft, never final or emailed), and their text can be edited', async () => {
    renderCard(card([minutes('c1', { warning: 'This replaces the draft saved on Fri 23 Oct 2026 (Undo puts it back).' })]));
    const row = screen.getByRole('group', { name: 'Draft the final minutes of Site visit' });
    expect(row).toHaveTextContent('The pressure test moves to rig 3.');
    expect(row).toHaveTextContent('1 decision · 2 next steps');
    expect(row).toHaveTextContent(/draft for review on the meeting page — never final or emailed/i);
    expect(row).toHaveTextContent('This replaces the draft saved on Fri 23 Oct 2026');
    await userEvent.click(screen.getByRole('button', { name: 'Edit Draft the final minutes of Site visit' }));
    await userEvent.clear(screen.getByLabelText('Summary'));
    await userEvent.type(screen.getByLabelText('Summary'), 'Moved to rig 3.');
    await userEvent.type(screen.getByLabelText('Decisions (one a line)'), '{Enter}Order a spare gauge');
    await userEvent.click(confirmButton());
    expect(actions.confirmed[0]!.items[0]).toEqual({
      id: 'c1',
      include: true,
      edits: {
        content: {
          summary: 'Moved to rig 3.',
          discussion: [{ topic: 'RIG-14', text: 'Gauge calibrated.' }],
          decisions: ['Finish after calibration', 'Order a spare gauge'],
          risks: [],
          nextSteps: ['Sara: certificate by 25 Oct', 'Omar: report'],
        },
      },
    });
  });

  it('while another tab is making the changes, it says so and offers nothing to click', () => {
    renderCard(card([create('c1')], { status: 'confirming' }));
    expect(screen.getByText('Making these changes…')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Confirm/ })).not.toBeInTheDocument();
  });
});
