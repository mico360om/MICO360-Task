import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RulesTab } from './RulesTab';
import { courseRow, fakeTrainingApi, ruleRow, type FakeTrainingApi } from './test-api';
import { renderManage } from './test-render';
import { ApiError } from '../../../lib/api-client';

let api: FakeTrainingApi;
const fake = vi.hoisted(() => ({ api: null as FakeTrainingApi | null }));
vi.mock('../../../api/training', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../api/training')>()),
  trainingApi: (await import('./test-api')).followFake(() => fake.api),
}));

const COURSES = [courseRow({ id: 'c1', title: 'Tasks basics' }), courseRow({ id: 'c2', title: 'Meetings basics' })];
const RULES = [
  ruleRow({ id: 'r1', name: 'New staff', courseIds: ['c1', 'c2'], courseTitles: ['Tasks basics', 'Meetings basics'] }),
  ruleRow({ id: 'r2', name: 'New clients', targetId: 'clients', targetLabel: 'Clients', mandatory: false, dueDays: null, active: false, people: 0 }),
];

beforeEach(() => {
  api = fake.api = fakeTrainingApi();
  api.courses.mockResolvedValue({ courses: COURSES });
  api.rules.mockResolvedValue({ rules: RULES });
});

const ruleItem = async (name: string) => (await screen.findByRole('heading', { name })).closest('li')!;

describe('Training Center → Onboarding rules', () => {
  it('says what a rule does and lists each one: who, courses, mandatory, due, people and whether it is on', async () => {
    renderManage(<RulesTab />);
    expect(screen.getByText(/New accounts get these courses automatically/)).toBeInTheDocument();
    const staff = await ruleItem('New staff');
    expect(within(staff).getByText('Group: Employees')).toBeInTheDocument();
    expect(within(staff).getByText('Tasks basics, Meetings basics')).toBeInTheDocument();
    expect(within(staff).getByText('Mandatory')).toBeInTheDocument();
    expect(within(staff).getByText('Due 14 days after the account is made')).toBeInTheDocument();
    expect(within(staff).getByText('4 people so far')).toBeInTheDocument();
    expect(within(staff).getByRole('switch', { name: 'Rule on: New staff' })).toHaveAttribute('aria-checked', 'true');
    const clients = await ruleItem('New clients');
    expect(within(clients).getByText('Optional')).toBeInTheDocument();
    expect(within(clients).getByText('No due date')).toBeInTheDocument();
    expect(within(clients).getByRole('switch', { name: 'Rule on: New clients' })).toHaveAttribute('aria-checked', 'false');
  });

  it('New rule: name, who, courses, mandatory, due in 14 days by default, on', async () => {
    renderManage(<RulesTab />);
    await ruleItem('New staff');
    await userEvent.click(screen.getByRole('button', { name: 'New rule' }));
    const dialog = screen.getByRole('dialog', { name: 'New onboarding rule' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create rule' }));
    expect(within(dialog).getByText('Give the rule a name.')).toBeInTheDocument();
    expect(api.createRule).not.toHaveBeenCalled();
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Name' }), 'Every new employee');
    expect(within(dialog).getAllByRole('radio').filter((r) => r.getAttribute('name') === 'rule-target').map((r) => r.getAttribute('value'))).toEqual(['GROUP', 'DEPARTMENT', 'COMPANY']);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Group to assign' }));
    await userEvent.click(await screen.findByRole('option', { name: 'Employees' }));
    await userEvent.click(await within(dialog).findByRole('checkbox', { name: 'Tasks basics' }));
    expect(within(dialog).getByRole('spinbutton', { name: 'Number of days' })).toHaveValue(14);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create rule' }));
    await waitFor(() =>
      expect(api.createRule).toHaveBeenCalledWith({ name: 'Every new employee', targetKind: 'GROUP', targetId: 'employees', courseIds: ['c1'], mandatory: true, dueDays: 14, active: true }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('Edit: the rule’s own values, and the change is saved', async () => {
    renderManage(<RulesTab />);
    const staff = await ruleItem('New staff');
    await userEvent.click(within(staff).getByRole('button', { name: 'Edit' }));
    const dialog = screen.getByRole('dialog', { name: 'Edit onboarding rule' });
    expect(within(dialog).getByRole('textbox', { name: 'Name' })).toHaveValue('New staff');
    expect(await within(dialog).findByRole('checkbox', { name: 'Meetings basics' })).toBeChecked();
    await userEvent.click(within(dialog).getByRole('checkbox', { name: 'Meetings basics' }));
    await userEvent.click(within(dialog).getByRole('radio', { name: 'No due date' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save rule' }));
    await waitFor(() => expect(api.updateRule).toHaveBeenCalledWith('r1', { name: 'New staff', targetKind: 'GROUP', targetId: 'employees', courseIds: ['c1'], mandatory: true, dueDays: null, active: true }));
  });

  it('the switch turns a rule off (people who got it keep it) and on', async () => {
    renderManage(<RulesTab />);
    const staff = await ruleItem('New staff');
    await userEvent.click(within(staff).getByRole('switch', { name: 'Rule on: New staff' }));
    await waitFor(() => expect(api.updateRule).toHaveBeenCalledWith('r1', { active: false }));
  });

  it('Delete: asks first — unfinished training from it is withdrawn', async () => {
    renderManage(<RulesTab />);
    const staff = await ruleItem('New staff');
    await userEvent.click(within(staff).getByRole('button', { name: 'Delete' }));
    const confirm = screen.getByRole('alertdialog', { name: 'Delete the rule “New staff”?' });
    expect(confirm).toHaveTextContent('Unfinished training from it is withdrawn');
    expect(confirm).toHaveTextContent('Completed training is kept');
    await userEvent.click(within(confirm).getByRole('button', { name: 'Delete rule' }));
    await waitFor(() => expect(api.deleteRule).toHaveBeenCalledWith('r1'));
  });

  it('a refusal (another company’s rule) is shown in the server’s words', async () => {
    api.updateRule.mockRejectedValue(new ApiError(403, 'FORBIDDEN', 'Only an administrator (or a Training manager of the same companies) can change this rule.'));
    renderManage(<RulesTab />);
    const staff = await ruleItem('New staff');
    await userEvent.click(within(staff).getByRole('switch', { name: 'Rule on: New staff' }));
    expect(await screen.findByText(/Only an administrator \(or a Training manager of the same companies\) can change this rule\./)).toBeInTheDocument();
  });
});
