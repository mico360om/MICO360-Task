import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AssignmentsTab } from './AssignmentsTab';
import { assignmentRow, courseRow, fakeTrainingApi, type FakeTrainingApi } from './test-api';
import { renderManage } from './test-render';

let api: FakeTrainingApi;
const fake = vi.hoisted(() => ({ api: null as FakeTrainingApi | null }));
vi.mock('../../../api/training', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../api/training')>()),
  trainingApi: (await import('./test-api')).followFake(() => fake.api),
}));

const COURSES = [courseRow({ id: 'c1', title: 'Tasks basics' }), courseRow({ id: 'c2', title: 'Meetings basics', moduleKey: 'meetings' })];
const ROWS = [
  assignmentRow({ id: 'a1' }),
  assignmentRow({ id: 'a2', courseId: 'c2', courseTitle: 'Meetings basics', targetKind: 'USER', targetId: 'u-sam', targetLabel: 'Sam Shared', mandatory: false, dueDay: '2026-12-01', dueDays: null, people: 1, completed: 0, overdue: 0 }),
  // A switched-off New staff only rule (one course)…
  assignmentRow({ id: 'a3', ruleId: 'r1', targetKind: 'DEPARTMENT', targetId: 'd-ops', targetLabel: 'Operations', dueDays: null, frozen: true, createdByName: null, people: 2, completed: 1, overdue: 0 }),
  // …and one still on, for two courses: one row for the rule.
  assignmentRow({ id: 'a4', ruleId: 'r2', targetKind: 'COMPANY', targetId: 'co-a', targetLabel: 'Alpha Co', dueDays: 10, people: 3, completed: 1, overdue: 1 }),
  assignmentRow({ id: 'a5', ruleId: 'r2', courseId: 'c2', courseTitle: 'Meetings basics', targetKind: 'COMPANY', targetId: 'co-a', targetLabel: 'Alpha Co', dueDays: 10, people: 2, completed: 0, overdue: 0 }),
];

beforeEach(() => {
  api = fake.api = fakeTrainingApi();
  api.courses.mockResolvedValue({ courses: COURSES });
  api.assignments.mockResolvedValue({ assignments: ROWS });
});

const rowOf = async (text: string) => (await screen.findByText(text, { selector: 'li *' })).closest('li')!;

describe('Learning Hub → Manage → Assigned', () => {
  it('lists each assignment: course, who it is for, mandatory or optional, due, people, by whom — and one row per New staff only rule', async () => {
    renderManage(<AssignmentsTab />);
    const list = await screen.findByRole('list', { name: 'Assigned' });
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(4);
    const [first, second, third, fourth] = items;
    expect(within(first!).getByText('Tasks basics')).toBeInTheDocument();
    expect(within(first!).getByText('Group: Everyone (all staff)')).toBeInTheDocument();
    expect(within(first!).getByText('Mandatory')).toBeInTheDocument();
    expect(within(first!).getByText('Due 14 days after assigned')).toBeInTheDocument();
    expect(within(first!).getByText('12 people · 5 finished · 2 overdue')).toBeInTheDocument();
    expect(within(first!).getByText(/By Tara Trainer · /)).toBeInTheDocument();
    expect(within(second!).getByText('Person: Sam Shared')).toBeInTheDocument();
    expect(within(second!).getByText('Optional')).toBeInTheDocument();
    expect(within(second!).getByText(/^Due 1 Dec/)).toBeInTheDocument();
    expect(within(second!).getByText('1 person · 0 finished · 0 overdue')).toBeInTheDocument();
    expect(within(second!).getByRole('button', { name: 'Withdraw' })).toBeInTheDocument();
    // New staff only: switched off (Switch on), and on (Switch off) — never Withdraw.
    expect(within(third!).getByText('New staff only')).toBeInTheDocument();
    expect(within(third!).getByText('Switched off')).toBeInTheDocument();
    expect(within(third!).getByText('Department: Operations')).toBeInTheDocument();
    expect(within(third!).getByText('No due date')).toBeInTheDocument();
    expect(within(third!).getByRole('button', { name: 'Switch on' })).toBeInTheDocument();
    expect(within(third!).queryByRole('button', { name: 'Withdraw' })).toBeNull();
    expect(within(fourth!).getByText('Tasks basics, Meetings basics')).toBeInTheDocument();
    expect(within(fourth!).getByText('Company: Alpha Co')).toBeInTheDocument();
    expect(within(fourth!).getByText('Due 10 days after they join')).toBeInTheDocument();
    expect(within(fourth!).getByText('5 people · 1 finished · 1 overdue')).toBeInTheDocument();
    expect(within(fourth!).getByRole('button', { name: 'Switch off' })).toBeInTheDocument();
    expect(within(fourth!).queryByText('Switched off')).toBeNull();
  });

  it('Switch off a New staff only rule: asks first, says nobody loses anything, and freezes the whole rule (never a delete)', async () => {
    renderManage(<AssignmentsTab />);
    const row = await rowOf('Company: Alpha Co');
    await userEvent.click(within(row).getByRole('button', { name: 'Switch off' }));
    const confirm = screen.getByRole('alertdialog', { name: 'Switch off New staff only?' });
    expect(confirm).toHaveTextContent('Nobody new gets');
    expect(confirm).toHaveTextContent('Nobody loses anything');
    await userEvent.click(within(confirm).getByRole('button', { name: 'Switch off' }));
    await waitFor(() => expect(api.updateRule).toHaveBeenCalledWith('r2', { active: false }));
    expect(api.deleteRule).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(api.assignments.mock.calls.length).toBeGreaterThan(1);
  });

  it('Switch on again: new people get it again', async () => {
    renderManage(<AssignmentsTab />);
    const row = await rowOf('Department: Operations');
    await userEvent.click(within(row).getByRole('button', { name: 'Switch on' }));
    await waitFor(() => expect(api.updateRule).toHaveBeenCalledWith('r1', { active: true }));
  });

  it('a course filter asks the server for that course’s assignments only', async () => {
    renderManage(<AssignmentsTab />);
    await screen.findByRole('list', { name: 'Assigned' });
    expect(api.assignments).toHaveBeenLastCalledWith(undefined);
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Course' }), 'c2');
    await waitFor(() => expect(api.assignments).toHaveBeenLastCalledWith('c2'));
  });

  it('Assign: published courses, who, mandatory and due — a live preview, then Assign', async () => {
    api.previewAssignment.mockResolvedValue({ reach: 12, already: 3, skipped: [{ name: 'Huda Client', reason: 'can’t see this course' }] });
    api.assign.mockResolvedValue({ assignments: [assignmentRow({ id: 'a9' })] });
    renderManage(<AssignmentsTab />);
    await screen.findByRole('list', { name: 'Assigned' });
    await userEvent.click(screen.getByRole('button', { name: 'Assign a course' }));
    const dialog = screen.getByRole('dialog', { name: 'Assign a course' });
    expect(api.courses).toHaveBeenCalledWith({ status: 'PUBLISHED' });
    // Nothing chosen yet: no preview, and Assign waits.
    expect(within(dialog).getByRole('button', { name: 'Assign' })).toBeDisabled();
    await userEvent.click(await within(dialog).findByRole('checkbox', { name: 'Tasks basics' }));
    await userEvent.click(within(dialog).getByRole('radio', { name: 'Group' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Group to assign' }));
    await userEvent.click(await screen.findByRole('option', { name: 'Everyone (all staff)' }));
    await waitFor(() => expect(api.previewAssignment).toHaveBeenLastCalledWith({ courseIds: ['c1'], targetKind: 'GROUP', targetId: 'everyone', mandatory: true, dueDay: null, dueDays: null }));
    const preview = await within(dialog).findByRole('status', { name: 'Preview' });
    expect(within(preview).getByText('Reaches 12 people · 3 already have it · 1 can’t see it')).toBeInTheDocument();
    expect(within(preview).getByText(/Huda Client/)).toBeInTheDocument();
    // Optional, due 10 days after they get it: the preview follows.
    await userEvent.click(within(dialog).getByRole('radio', { name: /Optional/ }));
    await userEvent.click(within(dialog).getByRole('radio', { name: 'Days after it is assigned' }));
    const days = within(dialog).getByRole('spinbutton', { name: 'Number of days' });
    await userEvent.clear(days);
    await userEvent.type(days, '10');
    await waitFor(() => expect(api.previewAssignment).toHaveBeenLastCalledWith({ courseIds: ['c1'], targetKind: 'GROUP', targetId: 'everyone', mandatory: false, dueDay: null, dueDays: 10 }));
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Assign' })).toBeEnabled());
    await userEvent.click(within(dialog).getByRole('button', { name: 'Assign' }));
    await waitFor(() => expect(api.assign).toHaveBeenCalledWith({ courseIds: ['c1'], targetKind: 'GROUP', targetId: 'everyone', mandatory: false, dueDay: null, dueDays: 10 }));
    expect(api.assign.mock.calls[0]![0]).not.toHaveProperty('newStaffOnly');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Assign a course' })).toBeNull());
    expect(await screen.findByText(/Assigned\. It reaches 12 people\./)).toBeInTheDocument();
  });

  it('Assign to a person: their name, with clients marked', async () => {
    api.previewAssignment.mockResolvedValue({ reach: 1, already: 0, skipped: [] });
    renderManage(<AssignmentsTab />);
    await screen.findByRole('list', { name: 'Assigned' });
    await userEvent.click(screen.getByRole('button', { name: 'Assign a course' }));
    const dialog = screen.getByRole('dialog', { name: 'Assign a course' });
    await userEvent.click(await within(dialog).findByRole('checkbox', { name: 'Meetings basics' }));
    await userEvent.click(within(dialog).getByRole('radio', { name: 'Person' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Person to assign' }));
    expect(await screen.findByRole('option', { name: /Huda Client.*Client/ })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('option', { name: /Sam Shared/ }));
    await waitFor(() => expect(api.previewAssignment).toHaveBeenLastCalledWith(expect.objectContaining({ courseIds: ['c2'], targetKind: 'USER', targetId: 'u-sam' })));
    expect(await within(dialog).findByText('Reaches 1 person · 0 already have it · 0 can’t see it')).toBeInTheDocument();
  });

  it('a due day must be today or later', async () => {
    renderManage(<AssignmentsTab />);
    await screen.findByRole('list', { name: 'Assigned' });
    await userEvent.click(screen.getByRole('button', { name: 'Assign a course' }));
    const dialog = screen.getByRole('dialog', { name: 'Assign a course' });
    await userEvent.click(within(dialog).getByRole('radio', { name: 'A day' }));
    expect(within(dialog).getByLabelText('Due day')).toHaveAttribute('min', expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/));
  });

  it('Withdraw: asks first and says what happens to finished and unfinished training', async () => {
    renderManage(<AssignmentsTab />);
    const row = await rowOf('Group: Everyone (all staff)');
    await userEvent.click(within(row).getByRole('button', { name: 'Withdraw' }));
    const confirm = screen.getByRole('alertdialog', { name: 'Withdraw this assignment?' });
    expect(confirm).toHaveTextContent('Finished courses are kept');
    expect(confirm).toHaveTextContent('Unfinished courses from it are withdrawn');
    await userEvent.click(within(confirm).getByRole('button', { name: 'Withdraw' }));
    await waitFor(() => expect(api.withdraw).toHaveBeenCalledWith('a1'));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(api.assignments.mock.calls.length).toBeGreaterThan(1);
  });

  it('New staff only (a group, a department or a company): only people who join from now on — due days after they join, no fixed day', async () => {
    api.previewAssignment.mockResolvedValue({ reach: 0, already: 0, skipped: [] });
    api.assign.mockResolvedValue({ assignments: [assignmentRow({ id: 'a9', ruleId: 'r9' })] });
    renderManage(<AssignmentsTab />);
    await screen.findByRole('list', { name: 'Assigned' });
    await userEvent.click(screen.getByRole('button', { name: 'Assign a course' }));
    const dialog = screen.getByRole('dialog', { name: 'Assign a course' });
    await userEvent.click(await within(dialog).findByRole('checkbox', { name: 'Tasks basics' }));
    await userEvent.click(within(dialog).getByRole('radio', { name: 'Group' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Group to assign' }));
    await userEvent.click(await screen.findByRole('option', { name: 'Everyone (all staff)' }));
    // Everyone in it is the default: now, and people who join later.
    expect(within(dialog).getByRole('radio', { name: /Everyone in it, now and when people join/ })).toBeChecked();
    await userEvent.click(within(dialog).getByRole('radio', { name: /Only people who join from now on/ }));
    // No fixed due day for people who haven't joined yet.
    expect(within(dialog).queryByRole('radio', { name: 'A day' })).toBeNull();
    await userEvent.click(within(dialog).getByRole('radio', { name: 'Days after they join' }));
    await waitFor(() => expect(api.previewAssignment).toHaveBeenLastCalledWith({ courseIds: ['c1'], targetKind: 'GROUP', targetId: 'everyone', mandatory: true, dueDay: null, dueDays: 14, newStaffOnly: true }));
    expect(await within(dialog).findByText('Nobody yet. People who join from now on get it.')).toBeInTheDocument();
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Assign' })).toBeEnabled());
    await userEvent.click(within(dialog).getByRole('button', { name: 'Assign' }));
    await waitFor(() => expect(api.assign).toHaveBeenCalledWith({ courseIds: ['c1'], targetKind: 'GROUP', targetId: 'everyone', mandatory: true, dueDay: null, dueDays: 14, newStaffOnly: true }));
  });

  it('New staff only isn’t offered for a person or a project, and choosing one of those clears it', async () => {
    api.previewAssignment.mockResolvedValue({ reach: 1, already: 0, skipped: [] });
    renderManage(<AssignmentsTab />);
    await screen.findByRole('list', { name: 'Assigned' });
    await userEvent.click(screen.getByRole('button', { name: 'Assign a course' }));
    const dialog = screen.getByRole('dialog', { name: 'Assign a course' });
    await userEvent.click(await within(dialog).findByRole('checkbox', { name: 'Tasks basics' }));
    await userEvent.click(within(dialog).getByRole('radio', { name: 'Company' }));
    await userEvent.click(within(dialog).getByRole('radio', { name: /Only people who join from now on/ }));
    await userEvent.click(within(dialog).getByRole('radio', { name: 'Person' }));
    expect(within(dialog).queryByRole('radio', { name: /Only people who join from now on/ })).toBeNull();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Person to assign' }));
    await userEvent.click(await screen.findByRole('option', { name: /Sam Shared/ }));
    await waitFor(() => expect(api.previewAssignment).toHaveBeenLastCalledWith(expect.objectContaining({ targetKind: 'USER', targetId: 'u-sam' })));
    expect(api.previewAssignment.mock.lastCall![0]).not.toHaveProperty('newStaffOnly');
    // A fixed day is back for a person.
    expect(within(dialog).getByRole('radio', { name: 'A day' })).toBeInTheDocument();
  });

  it('Assign to several people: a searchable checklist, chips with remove buttons, “n people chosen”, sent as PEOPLE with userIds', async () => {
    api.previewAssignment.mockResolvedValue({ reach: 2, already: 0, skipped: [] });
    api.assign.mockResolvedValue({ assignments: [] });
    renderManage(<AssignmentsTab />);
    await screen.findByRole('list', { name: 'Assigned' });
    await userEvent.click(screen.getByRole('button', { name: 'Assign a course' }));
    const dialog = screen.getByRole('dialog', { name: 'Assign a course' });
    const radios = within(dialog).getAllByRole('radio').map((r) => (r.closest('label') as HTMLElement).textContent);
    expect(radios[0]).toBe('People');
    await userEvent.click(await within(dialog).findByRole('checkbox', { name: 'Tasks basics' }));
    await userEvent.click(within(dialog).getByRole('radio', { name: 'People' }));
    // Staff course: clients aren't offered.
    expect(within(dialog).queryByRole('checkbox', { name: /Huda Client/ })).toBeNull();
    expect(within(dialog).getByText('0 people chosen')).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('checkbox', { name: /Sam Shared/ }));
    await userEvent.click(within(dialog).getByRole('checkbox', { name: /Omar Ahmed/ }));
    expect(within(dialog).getByText('2 people chosen')).toBeInTheDocument();
    await waitFor(() => expect(api.previewAssignment).toHaveBeenLastCalledWith({ courseIds: ['c1'], targetKind: 'PEOPLE', userIds: ['u-sam', 'u-omar'], mandatory: true, dueDay: null, dueDays: null }));
    // Search narrows the list; chips remove one person.
    await userEvent.type(within(dialog).getByRole('searchbox', { name: 'Find a person' }), 'omar');
    expect(within(dialog).queryByRole('checkbox', { name: /Sam Shared/ })).toBeNull();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Remove Sam Shared' }));
    expect(within(dialog).getByText('1 person chosen')).toBeInTheDocument();
    await userEvent.clear(within(dialog).getByRole('searchbox', { name: 'Find a person' }));
    await userEvent.click(within(dialog).getByRole('checkbox', { name: /Sam Shared/ }));
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Assign' })).toBeEnabled());
    await userEvent.click(within(dialog).getByRole('button', { name: 'Assign' }));
    await waitFor(() => expect(api.assign).toHaveBeenCalledWith({ courseIds: ['c1'], targetKind: 'PEOPLE', userIds: ['u-omar', 'u-sam'], mandatory: true, dueDay: null, dueDays: null }));
    expect(api.assign.mock.calls[0]![0]).not.toHaveProperty('targetId');
  });

  it('People: a client course offers clients; New staff only isn’t offered; nobody ticked keeps Assign off', async () => {
    api.courses.mockResolvedValue({ courses: [courseRow({ id: 'c9', title: 'Client guide', audience: 'CLIENTS' })] });
    renderManage(<AssignmentsTab />);
    await screen.findByRole('list', { name: 'Assigned' });
    await userEvent.click(screen.getByRole('button', { name: 'Assign a course' }));
    const dialog = screen.getByRole('dialog', { name: 'Assign a course' });
    await userEvent.click(await within(dialog).findByRole('checkbox', { name: 'Client guide' }));
    await userEvent.click(within(dialog).getByRole('radio', { name: 'People' }));
    expect(within(dialog).getByRole('checkbox', { name: /Huda Client/ })).toBeInTheDocument();
    expect(within(dialog).queryByRole('checkbox', { name: /Sam Shared/ })).toBeNull();
    expect(within(dialog).queryByRole('radio', { name: /Only people who join from now on/ })).toBeNull();
    expect(within(dialog).getByRole('button', { name: 'Assign' })).toBeDisabled();
  });

  it('a grouped row “3 people”: a toggle lists the members, each with Withdraw; the row’s Withdraw withdraws them all', async () => {
    api.assignments.mockResolvedValue({
      assignments: [
        assignmentRow({
          id: 'b1',
          batchId: 'batch-1',
          targetKind: 'PEOPLE',
          targetId: '',
          targetLabel: '3 people',
          people: 3,
          members: [
            { assignmentId: 'm1', userId: 'u-omar', name: 'Omar Ahmed' },
            { assignmentId: 'm2', userId: 'u-sam', name: 'Sam Shared' },
            { assignmentId: 'm3', userId: 'u-x', name: 'Zed Zee' },
          ],
        }),
      ],
    });
    renderManage(<AssignmentsTab />);
    const list = await screen.findByRole('list', { name: 'Assigned' });
    const row = within(list).getAllByRole('listitem')[0]!;
    expect(within(row).getByText('3 people', { selector: 'p' })).toBeInTheDocument();
    expect(within(row).queryByText('Omar Ahmed')).toBeNull();
    const toggle = within(row).getByRole('button', { name: /Show people/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(within(row).getByText('Omar Ahmed')).toBeInTheDocument();
    // One person.
    await userEvent.click(within(row).getByRole('button', { name: 'Withdraw Sam Shared' }));
    let confirm = screen.getByRole('alertdialog', { name: 'Withdraw this assignment?' });
    expect(confirm).toHaveTextContent('Sam Shared');
    await userEvent.click(within(confirm).getByRole('button', { name: 'Withdraw' }));
    await waitFor(() => expect(api.withdraw).toHaveBeenCalledWith('m2'));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    // All of them.
    await userEvent.click(within(row).getByRole('button', { name: 'Withdraw all' }));
    confirm = screen.getByRole('alertdialog', { name: 'Withdraw this assignment?' });
    expect(confirm).toHaveTextContent('3 people');
    await userEvent.click(within(confirm).getByRole('button', { name: 'Withdraw' }));
    await waitFor(() => expect(api.withdrawBatch).toHaveBeenCalledWith('batch-1'));
  });
});
