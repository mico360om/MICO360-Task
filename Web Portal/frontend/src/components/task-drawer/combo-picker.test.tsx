import { describe, it, expect, vi } from 'vitest';
import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ComboPicker } from './combo-picker';

function Harness({ onOutside = () => {} }: { onOutside?: () => void }) {
  const [query, setQuery] = useState('');
  return (
    <div>
      <button type="button" onClick={onOutside}>Elsewhere</button>
      <ComboPicker label="Add people" query={query} onQuery={setQuery} openOnFocus inline options={[{ id: 'u1', label: 'Omar' }, { id: 'u2', label: 'Sara' }]} onPick={() => {}} emptyText="Nobody" />
    </div>
  );
}

describe('ComboPicker', () => {
  it('openOnFocus: lists every option as soon as the box is focused', async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole('combobox', { name: 'Add people' }));
    expect(screen.getAllByRole('option')).toHaveLength(2);
  });

  it('keeps its list until a click elsewhere has landed, so the page does not shift under the pointer', async () => {
    const onOutside = vi.fn();
    render(<Harness onOutside={onOutside} />);
    const box = screen.getByRole('combobox', { name: 'Add people' });
    await userEvent.click(box);
    const elsewhere = screen.getByRole('button', { name: 'Elsewhere' });
    fireEvent.pointerDown(elsewhere);
    fireEvent.mouseDown(elsewhere);
    fireEvent.blur(box);
    expect(screen.getAllByRole('option')).toHaveLength(2); // still there mid-click
    fireEvent.pointerUp(elsewhere);
    fireEvent.mouseUp(elsewhere);
    fireEvent.click(elsewhere);
    expect(onOutside).toHaveBeenCalled();
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByRole('option')).not.toBeInTheDocument();
  });

  it('closes at once when focus leaves by keyboard', async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole('combobox', { name: 'Add people' }));
    await userEvent.tab({ shift: true });
    expect(screen.queryByRole('option')).not.toBeInTheDocument();
  });

  it('its list is never a Tab stop of its own, so Tab from the box reaches the next control', async () => {
    // Chrome (130+) makes a scrolling box with nothing focusable inside a Tab stop. A long list
    // would take the focus from the box, the box's blur would close the list, and the focus would
    // fall to the page — the controls after the picker could not be reached by Tab. The options
    // are followed with aria-activedescendant, so the list itself never needs the focus.
    render(
      <div>
        <Harness />
        <button type="button">Next control</button>
      </div>,
    );
    await userEvent.click(screen.getByRole('combobox', { name: 'Add people' }));
    expect(screen.getByRole('listbox', { name: 'Add people' })).toHaveAttribute('tabindex', '-1');
    await userEvent.tab();
    expect(screen.getByRole('button', { name: 'Next control' })).toHaveFocus();
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });
});
