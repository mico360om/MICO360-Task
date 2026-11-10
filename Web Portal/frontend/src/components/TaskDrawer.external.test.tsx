// tgc: 1.24 — external contacts are guests now: the panel's separate "External contacts" section (typed
// per task, with mail and call links) is gone; guests from the company's list show under Assigned, after
// the team, and open their details (plain text with Copy — never mailto/tel).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TaskDrawer } from './TaskDrawer';
import type { ApiTask } from '../api/tasks';
import type { ApiTaskGuest } from '../api/guests';
import { GUEST_WORDS } from '../lib/guest-contacts';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
const taskGuest = (guestId: string, linkId: string, name: string, company: string | null, extra: Partial<ApiTaskGuest> = {}): ApiTaskGuest => ({
  linkId, guestId, taskId: 't1', name, company, designation: null, email: null, phone: null, note: null, position: 0, addedById: 'u1', addedAt: '', retired: false, ...extra,
});
const AHMED = taskGuest('g1', 'x1', 'Ahmed Al Harthy', 'OXY', { designation: 'Site engineer', email: 'ahmed@oxy.com', phone: '+968 9912 3456', note: 'Bring the permit' });
const SARA = taskGuest('g2', 'x2', 'Sara Nasser', null);
const task: ApiTask = {
  id: 't1', key: 'MICO-1', title: 'Rig inspection', description: null, projectId: 'p1', columnId: 'c1', columnCategory: 'TODO',
  position: 0, priority: 'NORMAL', startDate: null, dueDate: null, progress: 0, completedAt: null, createdAt: '', updatedAt: '',
  guests: [{ id: 'g1', name: 'Ahmed Al Harthy', company: 'OXY' }, { id: 'g2', name: 'Sara Nasser', company: null }],
  taskGuests: [AHMED, SARA],
};
const team = [{ id: 'u1', name: 'Mona Owner' }];

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes('/projects/p1/guests')) return json({ data: [{ id: 'g5', companyId: 'co1', name: 'Huda Saleh', company: 'Daleel', designation: null, email: null, phone: null, notes: null, retiredAt: null, mergedIntoId: null, createdById: null, createdAt: '', updatedAt: '' }] });
      return json({ data: [] });
    }),
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const assigned = () => screen.getByRole('list', { name: 'Assigned' });

describe('TaskDrawer: guests under Assigned', () => {
  it('lists the team members first, then the guests as “Ahmed Al Harthy · OXY · Guest”; no separate External contacts section', () => {
    render(<TaskDrawer task={task} checklist={[]} comments={[]} assignees={team} onClose={vi.fn()} />);
    const items = within(assigned()).getAllByRole('listitem');
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent('Mona Owner');
    expect(items[1]).toHaveTextContent('Ahmed Al Harthy · OXY');
    expect(within(items[1]!).getByText(GUEST_WORDS.badge)).toBeInTheDocument();
    expect(items[2]).toHaveTextContent('Sara Nasser');
    expect(within(items[2]!).getByText(GUEST_WORDS.badge)).toBeInTheDocument();
    expect(within(assigned()).getByRole('button', { name: 'Ahmed Al Harthy · OXY · Guest' })).toBeInTheDocument();
    expect(within(assigned()).getByRole('button', { name: 'Sara Nasser · Guest' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'External contacts' })).toBeNull();
  });

  it('reads a list row’s short guests when the full ones aren’t there', () => {
    render(<TaskDrawer task={{ ...task, taskGuests: undefined }} checklist={[]} comments={[]} assignees={team} onClose={vi.fn()} />);
    expect(within(assigned()).getByRole('button', { name: 'Ahmed Al Harthy · OXY · Guest' })).toBeInTheDocument();
  });

  it('a guest’s details: name, company, designation, phone and email as plain text, each with Copy — no mail, call or message links', async () => {
    const user = userEvent.setup();
    render(<TaskDrawer task={task} checklist={[]} comments={[]} assignees={team} onClose={vi.fn()} />);
    await user.click(within(assigned()).getByRole('button', { name: 'Ahmed Al Harthy · OXY · Guest' }));
    const dialog = screen.getByRole('dialog', { name: 'Ahmed Al Harthy' });
    for (const text of ['OXY', 'Site engineer', '+968 9912 3456', 'ahmed@oxy.com']) expect(within(dialog).getByText(text)).toBeInTheDocument();
    expect(within(dialog).queryAllByRole('link')).toHaveLength(0);
    expect(document.querySelector('a[href^="mailto:"], a[href^="tel:"], a[href^="sms:"]')).toBeNull();
    expect(within(dialog).getByText(GUEST_WORDS.hint)).toBeInTheDocument();
    const copyPhone = within(dialog).getByRole('button', { name: 'Copy phone' });
    await user.click(copyPhone);
    expect(await navigator.clipboard.readText()).toBe('+968 9912 3456');
    expect(copyPhone).toHaveTextContent(GUEST_WORDS.copied);
    await user.click(within(dialog).getByRole('button', { name: 'Copy email' }));
    expect(await navigator.clipboard.readText()).toBe('ahmed@oxy.com');
    for (const name of ['Copy name', 'Copy company', 'Copy designation']) expect(within(dialog).getByRole('button', { name })).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog', { name: 'Ahmed Al Harthy' })).toBeNull();
  });

  it('this task’s note for the guest is changed by whoever can edit the task (and checked first)', async () => {
    const onSetGuestNote = vi.fn(async () => {});
    render(<TaskDrawer task={task} checklist={[]} comments={[]} assignees={team} onSetGuestNote={onSetGuestNote} onRemoveGuest={vi.fn()} onClose={vi.fn()} />);
    await userEvent.click(within(assigned()).getByRole('button', { name: 'Ahmed Al Harthy · OXY · Guest' }));
    const dialog = screen.getByRole('dialog', { name: 'Ahmed Al Harthy' });
    const note = within(dialog).getByRole('textbox', { name: GUEST_WORDS.note });
    expect(note).toHaveValue('Bring the permit');
    fireEvent.change(note, { target: { value: 'x'.repeat(1001) } });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save note' }));
    expect(within(dialog).getByText('A note can have at most 1000 characters.')).toBeInTheDocument();
    expect(onSetGuestNote).not.toHaveBeenCalled();
    await userEvent.clear(note);
    await userEvent.type(note, 'Bring the permit and the gas test  ');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save note' }));
    expect(onSetGuestNote).toHaveBeenCalledWith('g1', 'Bring the permit and the gas test');
    expect(await within(dialog).findByText('Saved')).toBeInTheDocument();
  });

  it('a note the server refuses says why', async () => {
    const onSetGuestNote = vi.fn(async () => {
      throw new Error('This guest isn’t on the task any more.');
    });
    render(<TaskDrawer task={task} checklist={[]} comments={[]} assignees={team} onSetGuestNote={onSetGuestNote} onClose={vi.fn()} />);
    await userEvent.click(within(assigned()).getByRole('button', { name: 'Sara Nasser · Guest' }));
    const dialog = screen.getByRole('dialog', { name: 'Sara Nasser' });
    await userEvent.type(within(dialog).getByRole('textbox', { name: GUEST_WORDS.note }), 'Call first');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save note' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('This guest isn’t on the task any more.');
  });

  it('Remove guest takes them off the task', async () => {
    const onRemoveGuest = vi.fn(async () => {});
    render(<TaskDrawer task={task} checklist={[]} comments={[]} assignees={team} onRemoveGuest={onRemoveGuest} onClose={vi.fn()} />);
    await userEvent.click(within(assigned()).getByRole('button', { name: 'Sara Nasser · Guest' }));
    await userEvent.click(within(screen.getByRole('dialog', { name: 'Sara Nasser' })).getByRole('button', { name: GUEST_WORDS.remove }));
    expect(onRemoveGuest).toHaveBeenCalledWith('g2');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Sara Nasser' })).toBeNull());
  });

  it('read-only (no way to change them): guests are shown, their details have no note box and no Remove', async () => {
    render(<TaskDrawer task={task} checklist={[]} comments={[]} assignees={team} onClose={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Add assignee' })).toBeNull();
    await userEvent.click(within(assigned()).getByRole('button', { name: 'Ahmed Al Harthy · OXY · Guest' }));
    const dialog = screen.getByRole('dialog', { name: 'Ahmed Al Harthy' });
    expect(within(dialog).getByText('Bring the permit')).toBeInTheDocument();
    expect(within(dialog).queryByRole('textbox')).toBeNull();
    expect(within(dialog).queryByRole('button', { name: GUEST_WORDS.remove })).toBeNull();
  });

  it('the Assign control’s “Internal user | Guest” switch: a guest is picked from the company’s list', async () => {
    const onAddGuest = vi.fn(async () => {});
    const onAssignUser = vi.fn(async () => {});
    render(
      <TaskDrawer task={task} checklist={[]} comments={[]} assignees={team} assignableUsers={[...team, { id: 'u2', name: 'Omar Ahmed' }]} onAssignUser={onAssignUser} onAddGuest={onAddGuest} onClose={vi.fn()} />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Add assignee' }));
    const mode = screen.getByRole('radiogroup', { name: GUEST_WORDS.modeLabel });
    expect(screen.getByRole('combobox', { name: 'Find a teammate' })).toBeInTheDocument();
    await userEvent.click(within(mode).getByRole('radio', { name: GUEST_WORDS.guest }));
    expect(screen.queryByRole('combobox', { name: 'Find a teammate' })).toBeNull();
    await userEvent.click(await screen.findByRole('option', { name: /^Huda Saleh \(Daleel\)/ }));
    expect(onAddGuest).toHaveBeenCalledWith('g5');
    expect(onAssignUser).not.toHaveBeenCalled();
  });

  it('taking off the last team member of a task with guests: the server’s reason is shown', async () => {
    const onUnassignUser = vi.fn(async () => {
      throw new Error(GUEST_WORDS.lastTeamMember);
    });
    render(<TaskDrawer task={task} checklist={[]} comments={[]} assignees={team} onUnassignUser={onUnassignUser} onClose={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Remove Mona Owner' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(GUEST_WORDS.lastTeamMember);
  });

  it('1.23.6: a search result’s contact (…&contact=<id>) — now a guest — comes into view, marked', () => {
    const scroll = vi.fn();
    const before = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = scroll;
    window.history.replaceState(null, '', '/board?task=t1&contact=x2');
    try {
      render(<TaskDrawer task={task} checklist={[]} comments={[]} assignees={team} onClose={vi.fn()} />);
      const sara = within(assigned()).getByRole('button', { name: 'Sara Nasser · Guest' });
      expect(sara).toHaveAttribute('data-found', 'true');
      expect(sara).toHaveFocus();
      expect(scroll).toHaveBeenCalled();
    } finally {
      window.history.replaceState(null, '', '/');
      Element.prototype.scrollIntoView = before;
    }
  });
});
