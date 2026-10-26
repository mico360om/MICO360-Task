import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within, fireEvent, act, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ProposalCard, type ProposalActions } from './ProposalCard';
import type { ConfirmBody, CreateTaskChange, MeetingChange, MicoAiProposal, MinutesChange, ProposalChange, UpdateTaskChange } from '../../api/mico-ai';
import { useAuthStore } from '../../stores/auth-store';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const base = { needs: [], problem: null, locked: false, warning: null, result: null, undo: null };
const create = (id: string, extra: Partial<CreateTaskChange> = {}): CreateTaskChange => ({
  ...base,
  id,
  type: 'create_task',
  fields: { title: id === 'c1' ? 'Replace the gauge' : `Task ${id}`, projectId: 'p-rig', assigneeIds: ['u-sara'], due: '2026-10-27', priority: 'HIGH', description: '' },
  labels: { project: 'Rig Inspection Portal', assignees: [{ id: 'u-sara', name: 'Sara Ahmed' }] },
  ...extra,
});
const update = (id: string, extra: Partial<UpdateTaskChange> = {}): UpdateTaskChange => ({
  ...base,
  id,
  type: 'update_task',
  task: { id: 't14', key: 'RIG-14', title: 'Pressure test report', projectId: 'p-rig', project: 'Rig Inspection Portal', url: '?task=t14' },
  base: { version: 3, assigneeIds: ['u-omar'], activity: 4 },
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
  serverNow: new Date().toISOString(),
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
          create('c2', {
            fields: { ...create('c2').fields, title: 'Order spares' },
            needs: [{ fields: ['assigneeIds'], message: 'Layla Hassan isn’t on Rig Inspection Portal, so they can’t be assigned.' }],
            problem: 'Layla Hassan isn’t on Rig Inspection Portal, so they can’t be assigned.',
          }),
          update('c3', { locked: true, problem: 'Nothing to change: it’s already like this.' }),
        ],
        { note: 'MICO AI can’t delete anything, so that was left out.' },
      ),
    );
    expect(screen.getByRole('heading', { name: '3 changes to make' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Create “Replace the gauge”' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Create “Order spares”' })).not.toBeChecked();
    expect(screen.getByText('Put right first: Layla Hassan isn’t on Rig Inspection Portal, so they can’t be assigned.')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Create “Order spares”' })).toBeDisabled();
    expect(screen.queryByRole('checkbox', { name: 'Change RIG-14' })).not.toBeInTheDocument();
    expect(screen.getByText(/Can’t do:/)).toHaveTextContent('Can’t do: Nothing to change: it’s already like this.');
    expect(screen.getByRole('note')).toHaveTextContent('MICO AI can’t delete anything, so that was left out.');
    expect(confirmButton()).toHaveTextContent('Confirm (1)');
  });

  it('the changes are a list for screen readers: each one a list item holding its labelled group', () => {
    renderCard(card([create('c1'), update('c2')]));
    const items = [...document.querySelector('[data-proposal-card] > ul')!.children] as HTMLElement[];
    expect(items).toHaveLength(2);
    // No role on the list item itself (a group there would stop the list being a list).
    for (const li of items) expect([li.tagName, li.getAttribute('role')]).toEqual(['LI', null]);
    expect(within(items[0]!).getByRole('group', { name: 'Create “Replace the gauge”' })).toBeInTheDocument();
    expect(within(items[1]!).getByRole('group', { name: 'Change RIG-14' })).toBeInTheDocument();
  });

  it('“Select all” ticks every change that can go ahead (never one that still needs putting right), and clears them', async () => {
    renderCard(card([create('c1'), create('c2'), create('c3', { needs: [{ fields: ['projectId'], message: 'Pick a project.' }], problem: 'Pick a project.' }), update('c4', { locked: true, problem: 'x' })]));
    const all = screen.getByRole('checkbox', { name: 'Select all' });
    await userEvent.click(all);
    await userEvent.click(all);
    expect(screen.getByRole('checkbox', { name: 'Create “Replace the gauge”' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Create “Task c2”' })).toBeChecked();
    const blocked = screen.getByRole('checkbox', { name: 'Create “Task c3”' });
    expect(blocked).not.toBeChecked();
    expect(blocked).toBeDisabled();
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

  it('a new task Undo deleted no longer offers a link to it; a changed one still does', () => {
    const link = { label: 'RIG-35', url: '?task=t35' };
    renderCard(
      card(
        [
          { ...create('c1'), result: { status: 'done', message: null, link }, undo: { status: 'undone', message: 'RIG-35 was deleted.', gone: true } },
          { ...update('c2'), result: { status: 'done', message: null, link: { label: 'RIG-14', url: '?task=t14' } }, undo: { status: 'undone', message: 'RIG-14 is back as it was.' } },
        ],
        { status: 'undone' },
      ),
    );
    expect(screen.queryByRole('link', { name: 'Open RIG-35' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open RIG-14' })).toBeInTheDocument();
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

  it('a change that still needs putting right can’t be ticked until that field is edited (“Book review with Bilaal”)', async () => {
    const bilaal = meeting('c1', { needs: [{ fields: ['attendeeIds'], message: 'No one matches “Bilaal”.' }], problem: 'No one matches “Bilaal”.' });
    renderCard(card([bilaal, create('c2')]));
    const tick = screen.getByRole('checkbox', { name: 'Schedule “Review”' });
    expect(tick).not.toBeChecked();
    expect(tick).toBeDisabled();
    expect(screen.getByRole('group', { name: 'Schedule “Review”' })).toHaveTextContent('Put right first: No one matches “Bilaal”.');
    // Editing only the title doesn't fix who is invited: still not tickable, and Confirm leaves it out.
    await userEvent.click(screen.getByRole('button', { name: 'Edit Schedule “Review”' }));
    await userEvent.clear(screen.getByLabelText('Title'));
    await userEvent.type(screen.getByLabelText('Title'), 'Review with Bilal');
    const after = screen.getByRole('checkbox', { name: 'Schedule “Review with Bilal”' });
    expect(after).not.toBeChecked();
    expect(after).toBeDisabled();
    await userEvent.click(confirmButton());
    expect(actions.confirmed[0]!.items[0]).toEqual({ id: 'c1', include: false });
  });

  it('picking the people clears that need: the change can be ticked (and editing it ticks it)', async () => {
    const bilaal = meeting('c1', { needs: [{ fields: ['attendeeIds'], message: 'No one matches “Bilaal”.' }], problem: 'No one matches “Bilaal”.' });
    renderCard(card([bilaal]));
    await userEvent.click(screen.getByRole('button', { name: 'Edit Schedule “Review”' }));
    await userEvent.click(screen.getByRole('combobox', { name: 'Add people' }));
    await userEvent.click(await screen.findByRole('option', { name: /Bilal Ahmed/ }));
    const tick = screen.getByRole('checkbox', { name: 'Schedule “Review”' });
    expect(tick).toBeEnabled();
    expect(tick).toBeChecked();
    expect(screen.getByRole('group', { name: 'Schedule “Review”' })).not.toHaveTextContent('Put right first');
    await userEvent.click(confirmButton());
    expect(actions.confirmed[0]!.items[0]).toEqual({ id: 'c1', include: true, edits: { attendeeIds: ['u-sara', 'u-bilal'] } });
  });

  describe('everything Confirm will write is on the card', () => {
    const longText = `${'Check every valve on the north manifold and write down the pressure. '.repeat(6)}Then call https://example.com/phish to book.`;
    it('a new task: title, project, people, due day, priority and its whole description', async () => {
      renderCard(card([create('c1', { fields: { title: 'Replace the gauge', projectId: 'p-rig', assigneeIds: ['u-sara', 'u-omar'], due: '2026-10-27', priority: 'URGENT', description: longText }, labels: { project: 'Rig Inspection Portal', assignees: [{ id: 'u-sara', name: 'Sara Ahmed' }, { id: 'u-omar', name: 'Omar Said' }] } })]));
      const row = screen.getByRole('group', { name: 'Create “Replace the gauge”' });
      for (const v of ['Replace the gauge', 'Rig Inspection Portal', 'Sara Ahmed', 'Omar Said', 'Tue 27 Oct', 'Urgent', longText]) expect(row.textContent).toContain(v);
      // A long description isn't cut off silently: "Show all" shows it whole.
      const more = within(row).getByRole('button', { name: 'Show all of the description' });
      expect(more).toHaveAttribute('aria-expanded', 'false');
      await userEvent.click(more);
      expect(within(row).getByRole('button', { name: 'Show less of the description' })).toHaveAttribute('aria-expanded', 'true');
      expect(within(row).getByText(longText).className).not.toMatch(/line-clamp/);
    });

    it('a task change: each changed field’s new value', () => {
      renderCard(card([update('c1', { fields: { due: '2026-10-25', priority: 'URGENT', columnId: 'col-done', assigneeIds: ['u-sara'] }, labels: { column: 'Done', assignees: [{ id: 'u-sara', name: 'Sara Ahmed' }] } })]));
      const row = screen.getByRole('group', { name: 'Change RIG-14' });
      for (const v of ['RIG-14', 'Sun 25 Oct', 'Done', 'Urgent', 'Sara Ahmed']) expect(row.textContent).toContain(v);
    });

    it('final minutes: the summary, every discussion topic and its text, decisions, risks and next steps — shown open', () => {
      const content = {
        summary: 'The pressure test moves to rig 3.',
        discussion: [{ topic: 'Pressure test', text: 'Gauge calibrated; the test moves to rig 3.' }, { topic: 'Vendors', text: 'The certificate is still missing.' }],
        decisions: ['Finish after calibration'],
        risks: ['The certificate may be late'],
        nextSteps: ['Sara: certificate by 25 Oct'],
      };
      renderCard(card([minutes('c1', { fields: { content } })]));
      const row = screen.getByRole('group', { name: 'Draft the final minutes of Site visit' });
      const all = [content.summary, ...content.discussion.flatMap((d) => [d.topic, d.text]), ...content.decisions, ...content.risks, ...content.nextSteps];
      for (const v of all) expect(row.textContent).toContain(v);
      const draft = row.querySelector('details');
      expect(draft).toHaveAttribute('open');
      expect(within(row).getByText(/^The draft/)).toBeInTheDocument();
    });

    it('a meeting: title, day, time, length, project, people, every agenda item and its description (open, not hidden)', () => {
      const description = 'Bring the vendor’s certificates. Details: https://example.com/phish';
      renderCard(card([meeting('c1', { fields: { title: 'Review', projectId: 'p-rig', date: '2026-10-27', time: '10:00', minutes: 45, attendeeIds: ['u-sara'], agenda: ['Pressure test', 'Next steps'], description } })]));
      const row = screen.getByRole('group', { name: 'Schedule “Review”' });
      for (const v of ['Review', 'Tue 27 Oct', '10:00–10:45', '45 min', 'Rig Inspection Portal', 'Sara Ahmed', 'Pressure test', 'Next steps', description]) expect(row.textContent).toContain(v);
      const details = within(row).getByText('Description').closest('details');
      expect(details).toHaveAttribute('open');
    });
  });

  it('a meeting’s or task’s link goes once Undo deleted it; a meeting Undo cancelled keeps its link', () => {
    renderCard(
      card(
        [
          { ...meeting('c1'), result: { status: 'done', message: null, link: { label: 'Review', url: '/meetings/m1' } }, undo: { status: 'undone', message: 'The meeting was deleted.', gone: true } },
          { ...meeting('c2', { fields: { ...meeting('c2').fields, title: 'Kept' } }), result: { status: 'done', message: null, link: { label: 'Kept', url: '/meetings/m2' } }, undo: { status: 'undone', message: 'The meeting was cancelled, and the people invited were told.' } },
        ],
        { status: 'undone' },
      ),
    );
    expect(screen.queryByRole('link', { name: 'Open Review' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open Kept' })).toBeInTheDocument();
  });

  it('a change being made (or put back) right now says so — never “Failed”', () => {
    renderCard(
      card(
        [
          { ...create('c1'), result: { status: 'started', message: null, link: null } },
          { ...create('c2'), result: { status: 'done', message: null, link: null }, undo: { status: 'started', message: null } },
        ],
        { status: 'confirming' },
      ),
    );
    expect(screen.getByRole('group', { name: 'Create “Replace the gauge”' })).toHaveTextContent('Being made…');
    expect(screen.getByRole('group', { name: 'Create “Task c2”' })).toHaveTextContent('Being put back…');
    expect(document.body.textContent).not.toMatch(/Failed/);
  });

  it('a card replaced by a newer answer (Retry) says so and offers nothing to click', () => {
    renderCard(card([create('c1')], { status: 'superseded' }));
    expect(screen.getByText('Replaced by a newer answer — nothing was changed.')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });

  it('after Cancel the outcome takes the focus and is announced', async () => {
    const view = renderCard(card([create('c1')]));
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    view.update(card([create('c1')], { status: 'cancelled' }));
    const outcome = screen.getByText('Cancelled — nothing was changed.');
    await waitFor(() => expect(outcome).toHaveFocus());
    expect(actions.announced).toEqual(['Cancelled — nothing was changed.']);
  });

  it('the Undo countdown follows the server’s clock: a device 10 minutes fast still has 15 minutes', () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    const server = new Date('2026-10-25T08:00:00Z');
    vi.setSystemTime(new Date(server.getTime() + 10 * 60_000));
    renderCard(
      card([{ ...create('c1'), result: { status: 'done', message: null, link: null } }], {
        status: 'done',
        confirmedAt: server.toISOString(),
        undoUntil: new Date(server.getTime() + 15 * 60_000).toISOString(),
        canUndo: true,
        serverNow: server.toISOString(),
      }),
    );
    expect(screen.getByRole('button', { name: /^Undo/ })).toHaveTextContent('Undo (15:00)');
  });

  it('dates show their year when it isn’t this year', () => {
    renderCard(card([create('c1', { fields: { ...create('c1').fields, due: '2027-01-05' } })]));
    expect(screen.getByRole('group', { name: 'Create “Replace the gauge”' })).toHaveTextContent('Due Tue 5 Jan 2027');
  });

  it('meeting times name the company’s zone when the person’s own is different', async () => {
    const plain = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation(async (input, init) =>
      String(input).includes('/users/me/preferences') ? json({ data: { timeZone: 'Europe/London' } }) : plain(input as never, init),
    );
    renderCard(card([meeting('c1')]));
    await waitFor(() => expect(screen.getByRole('group', { name: 'Schedule “Review”' })).toHaveTextContent('Tue 27 Oct, 10:00–10:30 (Muscat time)'));
  });

  it('meeting times say nothing more when the person is in the company’s zone', async () => {
    renderCard(card([meeting('c1')]));
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.getByRole('group', { name: 'Schedule “Review”' })).not.toHaveTextContent('Muscat time');
  });

  it('while another tab is making the changes, it says so and offers nothing to click', () => {
    renderCard(card([create('c1')], { status: 'confirming' }));
    expect(screen.getByText('Making these changes…')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Confirm/ })).not.toBeInTheDocument();
  });
});
