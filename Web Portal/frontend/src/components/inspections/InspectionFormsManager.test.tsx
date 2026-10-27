import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { InspectionFormsManager } from './InspectionFormsManager';
import { ApiError } from '../../lib/api-client';
import type { InspectionForm } from '../../api/inspections';

const api = vi.hoisted(() => ({
  listForms: vi.fn(),
  getForm: vi.fn(),
  createForm: vi.fn(),
  updateForm: vi.fn(),
  deleteForm: vi.fn(),
}));
vi.mock('../../api/inspections', () => ({ inspectionsApi: () => api }));

const RIG: InspectionForm = {
  id: 'f1',
  title: 'Rig daily check',
  description: 'Before the first shift.',
  version: 3,
  sectionCount: 2,
  itemCount: 3,
  createdBy: { id: 'u-olivia', name: 'Olivia Owner' },
  updatedAt: '2026-10-27T08:00:00.000Z',
  canEdit: true,
  structure: {
    clientSignature: 'OPTIONAL',
    supervisorSignature: 'NONE',
    sections: [
      { id: 's1', title: 'Well head', items: [{ id: 'i1', kind: 'READING', label: 'Pressure', help: null, unit: 'psi', min: 0, max: 150 }, { id: 'i2', kind: 'CHECK', label: 'Valves closed', help: null }] },
      { id: 's2', title: 'Deck', items: [{ id: 'i3', kind: 'CHECK', label: 'Guard rails fitted', help: null }] },
    ],
  },
};
const OTHERS: InspectionForm = { ...RIG, id: 'f2', title: 'Crane lift check', canEdit: false, createdBy: { id: 'u-x', name: 'Someone Else' } };

const show = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <InspectionFormsManager />
    </QueryClientProvider>,
  );

beforeEach(() => {
  for (const f of Object.values(api)) f.mockReset();
  api.listForms.mockResolvedValue({ forms: [RIG, OTHERS], canCreate: true });
});

describe('the inspection forms manager', () => {
  it('lists the forms with their size and maker; Edit and Delete only on those the person may change', async () => {
    show();
    const rig = await screen.findByRole('listitem', { name: 'Rig daily check' });
    expect(rig).toHaveTextContent('2 sections · 3 items');
    expect(rig).toHaveTextContent('Made by Olivia Owner');
    expect(rig).toHaveTextContent('Inspector signs; client’s signature optional');
    expect(within(rig).getByRole('button', { name: 'Edit Rig daily check' })).toBeInTheDocument();
    expect(within(rig).getByRole('button', { name: 'Delete Rig daily check' })).toBeInTheDocument();
    const crane = screen.getByRole('listitem', { name: 'Crane lift check' });
    expect(within(crane).queryByRole('button', { name: /Edit/ })).toBeNull();
    expect(within(crane).queryByRole('button', { name: /Delete/ })).toBeNull();
  });

  it('offers New form only to those who may create one, and says who can', async () => {
    api.listForms.mockResolvedValue({ forms: [OTHERS], canCreate: false });
    show();
    await screen.findByRole('listitem', { name: 'Crane lift check' });
    expect(screen.queryByRole('button', { name: 'New form' })).toBeNull();
    expect(screen.getByText(/Administrators and people who run a project can create forms/)).toBeInTheDocument();
  });

  it('says so when there are no forms yet', async () => {
    api.listForms.mockResolvedValue({ forms: [], canCreate: true });
    show();
    expect(await screen.findByText('No inspection forms yet')).toBeInTheDocument();
  });

  it('creates a form with a section, a check and a reading', async () => {
    const user = userEvent.setup();
    api.createForm.mockResolvedValue({ ...RIG, id: 'f9' });
    show();
    await user.click(await screen.findByRole('button', { name: 'New form' }));
    const dialog = screen.getByRole('dialog', { name: 'New inspection form' });
    await user.type(within(dialog).getByLabelText(/^Title/), 'Rig daily check');
    await user.selectOptions(within(dialog).getByLabelText('Client’s signature'), 'REQUIRED');
    const section = within(dialog).getByRole('group', { name: 'Section 1' });
    await user.type(within(section).getByLabelText(/^Section name/), 'Well head');
    await user.type(within(within(section).getByRole('group', { name: 'Item 1' })).getByLabelText(/^What to check/), 'Valves closed');
    await user.click(within(section).getByRole('button', { name: 'Add a reading' }));
    const reading = within(section).getByRole('group', { name: 'Item 2' });
    await user.type(within(reading).getByLabelText(/^What to check/), 'Pressure');
    await user.type(within(reading).getByLabelText('Unit (optional)'), 'psi');
    await user.type(within(reading).getByLabelText('Lowest allowed'), '0');
    await user.type(within(reading).getByLabelText('Highest allowed'), '150.5');
    expect(reading).toHaveTextContent('Allowed: 0–150.5 psi. A reading outside this fails.');
    await user.click(within(dialog).getByRole('button', { name: 'Save form' }));
    expect(api.createForm).toHaveBeenCalledWith({
      title: 'Rig daily check',
      description: null,
      clientSignature: 'REQUIRED',
      supervisorSignature: 'NONE',
      sections: [
        {
          title: 'Well head',
          items: [
            { kind: 'CHECK', label: 'Valves closed', help: null },
            { kind: 'READING', label: 'Pressure', help: null, unit: 'psi', min: 0, max: 150.5 },
          ],
        },
      ],
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByRole('status')).toHaveTextContent('Saved “Rig daily check”.');
  });

  it('edits a form keeping its sections’ and items’ ids, from the version it was opened at', async () => {
    const user = userEvent.setup();
    api.updateForm.mockResolvedValue({ ...RIG, version: 4 });
    show();
    await user.click(await screen.findByRole('button', { name: 'Edit Rig daily check' }));
    const dialog = screen.getByRole('dialog', { name: 'Edit inspection form' });
    const deck = within(dialog).getByRole('group', { name: 'Section 2' });
    await user.click(within(deck).getByRole('button', { name: 'Move section up: Deck' }));
    const title = within(dialog).getByLabelText(/^Title/);
    await user.clear(title);
    await user.type(title, 'Rig check');
    await user.click(within(dialog).getByRole('button', { name: 'Save form' }));
    expect(api.updateForm).toHaveBeenCalledWith('f1', {
      expectedVersion: 3,
      title: 'Rig check',
      description: 'Before the first shift.',
      clientSignature: 'OPTIONAL',
      supervisorSignature: 'NONE',
      sections: [
        { id: 's2', title: 'Deck', items: [{ id: 'i3', kind: 'CHECK', label: 'Guard rails fitted', help: null }] },
        {
          id: 's1',
          title: 'Well head',
          items: [
            { id: 'i1', kind: 'READING', label: 'Pressure', help: null, unit: 'psi', min: 0, max: 150 },
            { id: 'i2', kind: 'CHECK', label: 'Valves closed', help: null },
          ],
        },
      ],
    });
  });

  it('won’t save a reading whose lowest allowed value is above its highest, and says why', async () => {
    const user = userEvent.setup();
    show();
    await user.click(await screen.findByRole('button', { name: 'Edit Rig daily check' }));
    const dialog = screen.getByRole('dialog', { name: 'Edit inspection form' });
    const pressure = within(within(dialog).getByRole('group', { name: 'Section 1' })).getByRole('group', { name: 'Item 1' });
    const min = within(pressure).getByLabelText('Lowest allowed');
    await user.clear(min);
    await user.type(min, '200');
    expect(min).toHaveAttribute('aria-invalid', 'true');
    expect(within(pressure).getByText('The lowest allowed reading must not be above the highest.')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Save form' }));
    expect(api.updateForm).not.toHaveBeenCalled();
    expect(within(dialog).getByText(/Fix 1 problem before saving/)).toBeInTheDocument();
  });

  it('shows the server’s words when an edit was overtaken by someone else’s', async () => {
    const user = userEvent.setup();
    api.updateForm.mockRejectedValue(new ApiError(409, 'VERSION_CONFLICT', 'This form was changed by someone else meanwhile. Reload it and make your change again.'));
    show();
    await user.click(await screen.findByRole('button', { name: 'Edit Rig daily check' }));
    const dialog = screen.getByRole('dialog', { name: 'Edit inspection form' });
    await user.click(within(dialog).getByRole('button', { name: 'Save form' }));
    expect(await within(dialog).findByText('This form was changed by someone else meanwhile. Reload it and make your change again.')).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Edit inspection form' })).toBeInTheDocument();
  });

  it('asks before deleting, says the inspections made from it are kept, then deletes it', async () => {
    const user = userEvent.setup();
    api.deleteForm.mockResolvedValue(undefined);
    show();
    await user.click(await screen.findByRole('button', { name: 'Delete Rig daily check' }));
    const confirm = screen.getByRole('alertdialog', { name: 'Delete “Rig daily check”?' });
    expect(confirm).toHaveTextContent(/Inspections already made from it are kept/);
    expect(api.deleteForm).not.toHaveBeenCalled();
    await user.click(within(confirm).getByRole('button', { name: 'Delete form' }));
    expect(api.deleteForm).toHaveBeenCalledWith('f1');
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
  });

  it('asks before throwing away changes', async () => {
    const user = userEvent.setup();
    show();
    await user.click(await screen.findByRole('button', { name: 'New form' }));
    const dialog = screen.getByRole('dialog', { name: 'New inspection form' });
    await user.type(within(dialog).getByLabelText(/^Title/), 'Half done');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    const ask = screen.getByRole('alertdialog', { name: 'Discard this form?' });
    await user.click(within(ask).getByRole('button', { name: 'Keep editing' }));
    expect(screen.getByRole('dialog', { name: 'New inspection form' })).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Discard' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'New inspection form' })).toBeNull());
  });
});
