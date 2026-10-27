import { describe, it, expect } from 'vitest';
import { useState } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChecklistField, checklistRows, checklistTexts, type ChecklistRow } from './ChecklistField';

function Harness({ start = [] as string[], onSubmit }: { start?: string[]; onSubmit?: (texts: string[]) => void }) {
  const [rows, setRows] = useState<ChecklistRow[]>(() => checklistRows(start));
  const [pending, setPending] = useState('');
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit?.(checklistTexts(rows, pending));
      }}
    >
      <ChecklistField rows={rows} onChange={setRows} pending={pending} onPendingChange={setPending} />
      <output data-testid="saved">{checklistTexts(rows, pending).join('|')}</output>
      <button type="submit">Save</button>
    </form>
  );
}

const items = () => screen.queryAllByRole('textbox', { name: /^Checklist item \d+$/ }).map((i) => (i as HTMLInputElement).value);

describe('ChecklistField', () => {
  it('Enter adds the typed item and never submits the form', async () => {
    let submitted = 0;
    render(<Harness onSubmit={() => submitted++} />);
    await userEvent.type(screen.getByRole('textbox', { name: 'Add a checklist item' }), 'Gate{Enter}');
    expect(items()).toEqual(['Gate']);
    expect(submitted).toBe(0);
  });

  it('text typed but not added is kept: it is part of what is saved, and is added when the box loses focus', async () => {
    let saved: string[] = [];
    render(<Harness start={['Gate']} onSubmit={(t) => (saved = t)} />);
    await userEvent.type(screen.getByRole('textbox', { name: 'Add a checklist item' }), 'Fence');
    expect(screen.getByTestId('saved')).toHaveTextContent('Gate|Fence');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(saved).toEqual(['Gate', 'Fence']);
    expect(items()).toEqual(['Gate', 'Fence']);
    expect(screen.getByRole('textbox', { name: 'Add a checklist item' })).toHaveValue('');
  });

  it('✕ removes the item it belongs to, even while an emptied item (which goes on leaving it) has focus', async () => {
    render(<Harness start={['A', 'B', 'C']} />);
    await userEvent.clear(screen.getByRole('textbox', { name: 'Checklist item 1' }));
    // Focus is still in the emptied first item; pressing ✕ on "C" takes away the empty one and C — never B.
    await userEvent.click(screen.getByRole('button', { name: 'Remove “C” from the checklist' }));
    expect(items()).toEqual(['B']);
  });

  it('a pasted list becomes one item per line', async () => {
    render(<Harness />);
    screen.getByRole('textbox', { name: 'Add a checklist item' }).focus();
    await userEvent.paste('One\nTwo\n\nThree');
    expect(items()).toEqual(['One', 'Two', 'Three']);
    expect(within(screen.getByRole('list', { name: 'Checklist items' })).getAllByRole('listitem')).toHaveLength(3);
  });
});
