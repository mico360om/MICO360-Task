import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ExternalContactsSection, type DrawerExternalContact } from './external-contacts';
import { ApiError } from '../../lib/api-client';
import type { ExternalContactFields } from '../../lib/external-contacts';

const ahmed: DrawerExternalContact = {
  id: 'x1',
  name: 'Ahmed Al Said',
  company: 'OXY',
  designation: 'Site lead',
  email: 'ahmed@oxy.com',
  phone: '+968 9912 3456',
  remarks: 'Call before 10 am',
};
const sara: DrawerExternalContact = { id: 'x2', name: 'Sara Nasser', company: null, designation: null, email: null, phone: null, remarks: null };
const blank: ExternalContactFields = { name: '', company: null, designation: null, email: null, phone: null, remarks: null };

const section = () => screen.getByRole('region', { name: 'External contacts' });

describe('External contacts in the task panel', () => {
  it('shows each contact: name, company · designation, email and phone as links, and remarks', () => {
    render(<ExternalContactsSection contacts={[ahmed, sara]} />);
    const s = section();
    const first = within(s).getAllByRole('listitem')[0]!;
    expect(within(first).getByText('Ahmed Al Said')).toBeInTheDocument();
    expect(within(first).getByText('OXY · Site lead')).toBeInTheDocument();
    expect(within(first).getByRole('link', { name: /ahmed@oxy\.com/ })).toHaveAttribute('href', 'mailto:ahmed@oxy.com');
    expect(within(first).getByRole('link', { name: /\+968 9912 3456/ })).toHaveAttribute('href', 'tel:+96899123456');
    expect(within(first).getByText('Call before 10 am')).toBeInTheDocument();
    expect(within(s).getAllByRole('listitem')).toHaveLength(2);
    // Read-only without handlers: nothing to add, edit or remove.
    expect(within(s).queryByRole('button')).toBeNull();
  });

  it('says when there are none', () => {
    render(<ExternalContactsSection contacts={[]} onAdd={vi.fn()} />);
    expect(within(section()).getByText('No external contacts yet.')).toBeInTheDocument();
  });

  it('adds a contact: the six fields, checked first, then saved and the form closes', async () => {
    const onAdd = vi.fn(async () => {});
    render(<ExternalContactsSection contacts={[]} onAdd={onAdd} />);
    await userEvent.click(screen.getByRole('button', { name: 'Add a contact' }));
    const form = screen.getByRole('group', { name: 'Add an external contact' });
    await userEvent.click(within(form).getByRole('button', { name: 'Save' }));
    expect(onAdd).not.toHaveBeenCalled();
    const name = within(form).getByRole('combobox', { name: /^Name/ });
    expect(name).toHaveAttribute('aria-invalid', 'true');
    expect(within(form).getByText('Enter the contact’s name.')).toBeInTheDocument();
    expect(name).toHaveFocus();
    await userEvent.type(name, ' Ahmed Al Said ');
    await userEvent.type(within(form).getByLabelText('Company'), 'OXY');
    await userEvent.type(within(form).getByLabelText('Email'), 'ahmed@oxy');
    await userEvent.click(within(form).getByRole('button', { name: 'Save' }));
    expect(within(form).getByText('Enter a valid email address, like name@company.com.')).toBeInTheDocument();
    await userEvent.type(within(form).getByLabelText('Email'), '.com');
    await userEvent.type(within(form).getByLabelText('Phone'), '+968 9912 3456');
    await userEvent.type(within(form).getByLabelText('Remarks'), 'Site lead for rig 3');
    await userEvent.click(within(form).getByRole('button', { name: 'Save' }));
    expect(onAdd).toHaveBeenCalledWith({ name: 'Ahmed Al Said', company: 'OXY', designation: null, email: 'ahmed@oxy.com', phone: '+968 9912 3456', remarks: 'Site lead for rig 3' });
    await waitFor(() => expect(screen.queryByRole('group', { name: 'Add an external contact' })).toBeNull());
  });

  it('shows the server’s reason at the field it is about, and keeps what was typed', async () => {
    const onAdd = vi.fn(async () => {
      throw new ApiError(400, 'VALIDATION', 'A phone number can only have digits, spaces, + and -.', { fields: { phone: 'A phone number can only have digits, spaces, + and -.' } });
    });
    render(<ExternalContactsSection contacts={[]} onAdd={onAdd} />);
    await userEvent.click(screen.getByRole('button', { name: 'Add a contact' }));
    const form = screen.getByRole('group', { name: 'Add an external contact' });
    await userEvent.type(within(form).getByRole('combobox', { name: /^Name/ }), 'Sara');
    await userEvent.click(within(form).getByRole('button', { name: 'Save' }));
    expect(await within(form).findByText('A phone number can only have digits, spaces, + and -.')).toBeInTheDocument();
    expect(within(form).getByLabelText('Phone')).toHaveAttribute('aria-invalid', 'true');
    expect(within(form).getByRole('combobox', { name: /^Name/ })).toHaveValue('Sara');
  });

  it('says a refusal without a field in plain words', async () => {
    const onAdd = vi.fn(async () => {
      throw new ApiError(409, 'TOO_MANY_EXTERNAL_CONTACTS', 'A task can have at most 20 external contacts.');
    });
    render(<ExternalContactsSection contacts={[]} onAdd={onAdd} />);
    await userEvent.click(screen.getByRole('button', { name: 'Add a contact' }));
    await userEvent.type(screen.getByRole('combobox', { name: /^Name/ }), 'Sara');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('A task can have at most 20 external contacts.');
  });

  it('suggests earlier contacts of the project while the name is typed; picking one fills all six fields', async () => {
    const suggest = vi.fn(async (typed: string) => (typed.toLowerCase().startsWith('ah') ? [{ ...ahmed, id: undefined } as unknown as ExternalContactFields] : []));
    const onAdd = vi.fn(async () => {});
    render(<ExternalContactsSection contacts={[]} onAdd={onAdd} suggest={suggest} />);
    await userEvent.click(screen.getByRole('button', { name: 'Add a contact' }));
    const name = screen.getByRole('combobox', { name: /^Name/ });
    await userEvent.type(name, 'Ah');
    const option = await screen.findByRole('option', { name: 'Ahmed Al Said · OXY · Site lead' });
    expect(screen.getByRole('listbox', { name: 'Earlier contacts on this project' })).toBeInTheDocument();
    await userEvent.click(option);
    expect(name).toHaveValue('Ahmed Al Said');
    expect(screen.getByLabelText('Company')).toHaveValue('OXY');
    expect(screen.getByLabelText('Designation')).toHaveValue('Site lead');
    expect(screen.getByLabelText('Email')).toHaveValue('ahmed@oxy.com');
    expect(screen.getByLabelText('Phone')).toHaveValue('+968 9912 3456');
    expect(screen.getByLabelText('Remarks')).toHaveValue('Call before 10 am');
    expect(screen.queryByRole('listbox')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onAdd).toHaveBeenCalledWith({ name: 'Ahmed Al Said', company: 'OXY', designation: 'Site lead', email: 'ahmed@oxy.com', phone: '+968 9912 3456', remarks: 'Call before 10 am' });
  });

  it('picks a suggestion with the keyboard; Enter alone keeps what was typed', async () => {
    const suggest = vi.fn(async () => [{ ...blank, name: 'Ahmed Al Said', company: 'OXY' }]);
    const onAdd = vi.fn(async () => {});
    render(<ExternalContactsSection contacts={[]} onAdd={onAdd} suggest={suggest} />);
    await userEvent.click(screen.getByRole('button', { name: 'Add a contact' }));
    const name = screen.getByRole('combobox', { name: /^Name/ });
    await userEvent.type(name, 'Ahm');
    await screen.findByRole('option', { name: 'Ahmed Al Said · OXY' });
    await userEvent.keyboard('{ArrowDown}{Enter}');
    expect(screen.getByLabelText('Company')).toHaveValue('OXY');
    expect(onAdd).not.toHaveBeenCalled();
  });

  it('edits a contact in place: its fields filled in, saved with the changes', async () => {
    const onSave = vi.fn(async () => {});
    render(<ExternalContactsSection contacts={[ahmed]} onAdd={vi.fn()} onSave={onSave} onRemove={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Edit Ahmed Al Said' }));
    const form = screen.getByRole('group', { name: 'Edit the external contact' });
    const company = within(form).getByLabelText('Company');
    expect(company).toHaveValue('OXY');
    await userEvent.clear(company);
    await userEvent.type(company, 'Occidental');
    await userEvent.clear(within(form).getByLabelText('Remarks'));
    await userEvent.click(within(form).getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledWith('x1', { name: 'Ahmed Al Said', company: 'Occidental', designation: 'Site lead', email: 'ahmed@oxy.com', phone: '+968 9912 3456', remarks: null });
  });

  it('asks before removing, with Keep as the safe answer', async () => {
    const onRemove = vi.fn(async () => {});
    render(<ExternalContactsSection contacts={[ahmed]} onAdd={vi.fn()} onSave={vi.fn()} onRemove={onRemove} />);
    await userEvent.click(screen.getByRole('button', { name: 'Remove Ahmed Al Said' }));
    const ask = screen.getByRole('group', { name: 'Remove this contact?' });
    expect(within(ask).getByRole('button', { name: 'Keep' })).toHaveFocus();
    await userEvent.click(within(ask).getByRole('button', { name: 'Keep' }));
    expect(onRemove).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Remove Ahmed Al Said' }));
    await userEvent.click(within(screen.getByRole('group', { name: 'Remove this contact?' })).getByRole('button', { name: 'Remove' }));
    expect(onRemove).toHaveBeenCalledWith('x1');
  });

  it('says when the task has as many contacts as it can have', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ ...sara, id: `x${i}`, name: `Person ${i}` }));
    render(<ExternalContactsSection contacts={many} onAdd={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Add a contact' })).toBeNull();
    expect(screen.getByText('This task has 20 external contacts, the most it can have.')).toBeInTheDocument();
  });
});
