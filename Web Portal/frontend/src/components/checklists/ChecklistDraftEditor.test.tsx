import { describe, expect, it } from 'vitest';
import { useState } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChecklistDraftEditor } from './ChecklistDraftEditor';
import { draftFromTree, draftToTree, type ChecklistDraft, type ChecklistTree } from '../../lib/checklist-tree';

let latest: ChecklistDraft;
function Harness({ tree }: { tree: ChecklistTree }) {
  const [draft, setDraft] = useState(() => draftFromTree(tree));
  latest = draft;
  return <ChecklistDraftEditor draft={draft} onChange={setDraft} />;
}
const sent = () => draftToTree(latest);
const row = (text: string) => screen.getAllByTestId('checklist-item').find((li) => li.querySelector(':scope > [data-row]')?.textContent?.includes(text))!;

describe('ChecklistDraftEditor: checklists written before the task (or template) exists', () => {
  it('writes nested items with the keyboard: Enter for the next, Tab to go under the one before', async () => {
    render(<Harness tree={[]} />);
    const box = screen.getByRole('textbox', { name: 'Add an item to “Checklist”' });
    await userEvent.type(box, 'Wiring{Enter}');
    await userEvent.type(box, 'Label circuits');
    await userEvent.keyboard('{Tab}');
    // The typed text went under "Wiring", where typing goes on.
    const under = screen.getByRole('textbox', { name: 'New sub-item of “Wiring”' });
    expect(under).toHaveFocus();
    expect(under).toHaveValue('Label circuits');
    await userEvent.keyboard('{Enter}');
    await userEvent.type(screen.getByRole('textbox', { name: 'New item after “Label circuits”' }), 'Test breakers{Enter}');
    expect(sent()).toEqual([{ title: 'Checklist', items: [{ text: 'Wiring', children: [{ text: 'Label circuits' }, { text: 'Test breakers' }] }] }]);
    expect(row('Test breakers')).toHaveAttribute('data-depth', '1');
  });

  it('adds checklists, moves and deletes items (a parent asks first), all before anything is saved', async () => {
    render(<Harness tree={[{ title: 'Electrical', items: [{ text: 'Wiring', children: [{ text: 'Label circuits' }] }, { text: 'Lights' }] }]} />);
    await userEvent.click(screen.getByRole('button', { name: 'Add checklist' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'New checklist title' }), 'Plumbing{Enter}');
    expect(screen.getAllByTestId('checklist-card')).toHaveLength(2);
    expect(screen.getByRole('textbox', { name: 'Add an item to “Plumbing”' })).toHaveFocus();
    await userEvent.type(screen.getByRole('textbox', { name: 'Add an item to “Plumbing”' }), 'Pipes{Enter}');
    await userEvent.click(screen.getByRole('button', { name: 'More actions for “Lights”' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Indent' }));
    expect(sent()[0]!.items).toEqual([{ text: 'Wiring', children: [{ text: 'Label circuits' }, { text: 'Lights' }] }]);
    await userEvent.click(screen.getByRole('button', { name: 'More actions for “Wiring”' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));
    await userEvent.click(within(screen.getByRole('alertdialog', { name: 'Delete “Wiring” and its 2 sub-items?' })).getByRole('button', { name: 'Delete' }));
    expect(sent()).toEqual([{ title: 'Plumbing', items: [{ text: 'Pipes' }] }]);
  });

  it('text typed and not added is part of the draft (sent with the rest)', async () => {
    render(<Harness tree={[{ title: 'Checklist', items: [{ text: 'Gate' }] }]} />);
    await userEvent.type(screen.getByRole('textbox', { name: 'Add an item to “Checklist”' }), 'Fence');
    expect(sent()).toEqual([{ title: 'Checklist', items: [{ text: 'Gate' }, { text: 'Fence' }] }]);
  });
});
