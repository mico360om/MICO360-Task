import { describe, it, expect, vi, afterEach } from 'vitest';
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
  afterEach(() => vi.restoreAllMocks());

  it('is never taller than the room it has: fitting neither below nor above, it goes where there is more room and scrolls', async () => {
    // A phone (812px tall), the trigger near the middle, the popover 507px tall (the board's people list).
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(812);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ top: 297, bottom: 318, left: 270, right: 360, width: 90, height: 21, x: 270, y: 297, toJSON: () => ({}) });
    vi.spyOn(Element.prototype, 'scrollHeight', 'get').mockReturnValue(507);
    render(<Harness />);
    await userEvent.click(screen.getByRole('button', { name: 'Open details' }));
    const dialog = screen.getByRole('dialog', { name: 'Details' });
    expect(dialog.style.top).toBe('326px'); // below: 478px of room, above only 281px
    expect(dialog.style.maxHeight).toBe('478px');
    expect(dialog.style.overflowY).toBe('auto');
  });

  it('fitting above but not below, it opens above the trigger', async () => {
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(812);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ top: 700, bottom: 721, left: 20, right: 110, width: 90, height: 21, x: 20, y: 700, toJSON: () => ({}) });
    vi.spyOn(Element.prototype, 'scrollHeight', 'get').mockReturnValue(300);
    render(<Harness />);
    await userEvent.click(screen.getByRole('button', { name: 'Open details' }));
    expect(screen.getByRole('dialog', { name: 'Details' }).style.top).toBe('392px'); // 700 − 8 − 300
  });

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
