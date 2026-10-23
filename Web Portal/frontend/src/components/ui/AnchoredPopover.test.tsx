import { describe, it, expect } from 'vitest';
import { useRef, useState } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AnchoredPopover } from './AnchoredPopover';

/** A trigger that toggles the popover, with the popover right after it (as the pages place it). */
function Harness({ items = ['First action', 'Second action'] }: { items?: string[] }) {
  const [open, setOpen] = useState(false);
  const [list, setList] = useState(items);
  const anchor = useRef<HTMLButtonElement>(null);
  return (
    <div>
      <button type="button">Before</button>
      <span data-testid="cell">
        <button ref={anchor} type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          Open details
        </button>
        {open ? (
          <AnchoredPopover anchor={anchor} label="Details" onClose={() => setOpen(false)}>
            <h3 tabIndex={-1} data-popover-heading>Details</h3>
            {list.map((x) => (
              <button key={x} type="button" data-popover-action onClick={() => setList((l) => l.filter((y) => y !== x))}>
                {x}
              </button>
            ))}
          </AnchoredPopover>
        ) : null}
      </span>
      <button type="button">After</button>
    </div>
  );
}

describe('AnchoredPopover', () => {
  it('sits right after its trigger (reading order), takes focus, and Escape closes it back to the trigger', async () => {
    render(<Harness />);
    const trigger = screen.getByRole('button', { name: 'Open details' });
    await userEvent.click(trigger);
    const dialog = screen.getByRole('dialog', { name: 'Details' });
    expect(screen.getByTestId('cell').contains(dialog)).toBe(true);
    expect(trigger.nextElementSibling).toBe(dialog);
    expect(dialog.contains(document.activeElement)).toBe(true);
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('closes on a second click of its trigger (not closed and opened again)', async () => {
    render(<Harness />);
    const trigger = screen.getByRole('button', { name: 'Open details' });
    await userEvent.click(trigger);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await userEvent.click(trigger);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('closes on a press outside it, and when Tab leaves it', async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole('button', { name: 'Open details' }));
    fireEvent.pointerDown(screen.getByRole('button', { name: 'After' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Open details' }));
    screen.getByRole('button', { name: 'Second action' }).focus();
    await userEvent.tab();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'After' })).toHaveFocus();
  });

  it('keeps focus inside when the focused part goes away: on the next action, else the heading', async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole('button', { name: 'Open details' }));
    await userEvent.click(screen.getByRole('button', { name: 'First action' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Second action' })).toHaveFocus();
    await userEvent.click(screen.getByRole('button', { name: 'Second action' }));
    await act(async () => {});
    expect(screen.getByRole('heading', { name: 'Details' })).toHaveFocus();
  });
});
