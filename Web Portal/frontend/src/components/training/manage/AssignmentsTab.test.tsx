import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AssignmentsTab } from './AssignmentsTab';
import { assignmentRow, courseRow, fakeTrainingApi, type FakeTrainingApi } from './test-api';
import { renderManage } from './test-render';
import { ApiError } from '../../../lib/api-client';

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
  assignmentRow({ id: 'a3', ruleId: 'r1', targetKind: 'DEPARTMENT', targetId: 'd-ops', targetLabel: 'Operations', dueDays: null, frozen: true, createdByName: null }),
];

beforeEach(() => {
  api = fake.api = fakeTrainingApi();
  api.courses.mockResolvedValue({ courses: COURSES });
  api.assignments.mockResolvedValue({ assignments: ROWS });
});

const rowOf = async (text: string) => (await screen.findByText(text, { selector: 'li *' })).closest('li')!;

describe('Training Center → Assignments', () => {
  it('lists each assignment: course, who it is for, mandatory or optional, due, people, by whom, and rule ones', async () => {
    renderManage(<AssignmentsTab />);
    const list = await screen.findByRole('list', { name: 'Assignments' });
    const [first, second, third] = within(list).getAllByRole('listitem');
    expect(within(first!).getByText('Tasks basics')).toBeInTheDocument();
    expect(within(first!).getByText('Group: Everyone (all staff)')).toBeInTheDocument();
    expect(within(first!).getByText('Mandatory')).toBeInTheDocument();
    expect(within(first!).getByText('Due 14 days after assigned')).toBeInTheDocument();
    expect(within(first!).getByText('12 people · 5 completed · 2 overdue')).toBeInTheDocument();
    expect(within(first!).getByText(/By Tara Trainer · /)).toBeInTheDocument();
    expect(within(second!).getByText('Person: Sam Shared')).toBeInTheDocument();
    expect(within(second!).getByText('Optional')).toBeInTheDocument();
    expect(within(second!).getByText(/^Due 1 Dec/)).toBeInTheDocument();
    expect(within(second!).getByText('1 person · 0 completed · 0 overdue')).toBeInTheDocument();
    expect(within(third!).getByText('From an onboarding rule')).toBeInTheDocument();
    expect(within(third!).getByText('Rule switched off')).toBeInTheDocument();
    expect(within(third!).getByText('No due date')).toBeInTheDocument();
  });

  it('a course filter asks the server for that course’s assignments only', async () => {
    renderManage(<AssignmentsTab />);
    await screen.findByRole('list', { name: 'Assignments' });
    expect(api.assignments).toHaveBeenLastCalledWith(undefined);
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Course' }), 'c2');
    await waitFor(() => expect(api.assignments).toHaveBeenLastCalledWith('c2'));
  });

  it('Assign: published courses, who, mandatory and due — a live preview, then Assign', async () => {
    api.previewAssignment.mockResolvedValue({ reach: 12, already: 3, skipped: [{ name: 'Huda Client', reason: 'can’t see this course' }] });
    api.assign.mockResolvedValue({ assignments: [assignmentRow({ id: 'a9' })] });
    renderManage(<AssignmentsTab />);
    await screen.findByRole('list', { name: 'Assignments' });
    await userEvent.click(screen.getByRole('button', { name: 'Assign' }));
    const dialog = screen.getByRole('dialog', { name: 'Assign training' });
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
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Assign training' })).toBeNull());
    expect(await screen.findByText(/Assigned\. It reaches 12 people\./)).toBeInTheDocument();
  });

  it('Assign to a person: their name, with clients marked', async () => {
    api.previewAssignment.mockResolvedValue({ reach: 1, already: 0, skipped: [] });
    renderManage(<AssignmentsTab />);
    await screen.findByRole('list', { name: 'Assignments' });
    await userEvent.click(screen.getByRole('button', { name: 'Assign' }));
    const dialog = screen.getByRole('dialog', { name: 'Assign training' });
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
    await screen.findByRole('list', { name: 'Assignments' });
    await userEvent.click(screen.getByRole('button', { name: 'Assign' }));
    const dialog = screen.getByRole('dialog', { name: 'Assign training' });
    await userEvent.click(within(dialog).getByRole('radio', { name: 'A day' }));
    expect(within(dialog).getByLabelText('Due day')).toHaveAttribute('min', expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/));
  });

  it('Withdraw: asks first and says what happens to finished and unfinished training', async () => {
    renderManage(<AssignmentsTab />);
    const row = await rowOf('Group: Everyone (all staff)');
    await userEvent.click(within(row).getByRole('button', { name: 'Withdraw' }));
    const confirm = screen.getByRole('alertdialog', { name: 'Withdraw this assignment?' });
    expect(confirm).toHaveTextContent('Completed training is kept');
    expect(confirm).toHaveTextContent('Unfinished training from it is withdrawn');
    await userEvent.click(within(confirm).getByRole('button', { name: 'Withdraw' }));
    await waitFor(() => expect(api.withdraw).toHaveBeenCalledWith('a1'));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(api.assignments.mock.calls.length).toBeGreaterThan(1);
  });

  it('a rule’s assignment can’t be withdrawn alone: change the onboarding rule instead', async () => {
    api.withdraw.mockRejectedValue(new ApiError(409, 'RULE_ASSIGNMENT', 'This assignment comes from the onboarding rule “New staff”. Change the rule instead.'));
    const { where } = renderManage(<AssignmentsTab />);
    const row = await rowOf('Department: Operations');
    await userEvent.click(within(row).getByRole('button', { name: 'Withdraw' }));
    const confirm = screen.getByRole('alertdialog', { name: 'Withdraw this assignment?' });
    await userEvent.click(within(confirm).getByRole('button', { name: 'Withdraw' }));
    expect(await within(confirm).findByText(/Change the onboarding rule instead/)).toBeInTheDocument();
    await userEvent.click(within(confirm).getByRole('button', { name: 'Open onboarding rules' }));
    expect(where.path).toBe('/training/manage?tab=rules');
  });
});
