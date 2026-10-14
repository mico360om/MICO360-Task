import { describe, it, expect, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { Menu } from './Popover';

function setup() {
  const anchor = document.createElement('button');
  document.body.appendChild(anchor);
  const onClose = vi.fn();
  const select = vi.fn();
  render(<Menu anchor={anchor} label="Options" items={[{ label: 'Archive', onSelect: select }, { label: 'Mute', onSelect: vi.fn() }]} onClose={onClose} />);
  return { anchor, onClose, select };
}

describe('Popover / Menu', () => {
  it('stays open while a list scrolls and its button is still on screen (it follows the button)', () => {
    const { onClose } = setup();
    act(() => { fireEvent.scroll(document); });
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('menu', { name: 'Options' })).toBeInTheDocument();
  });

  it('closes once its button has scrolled out of sight', () => {
    const { anchor, onClose } = setup();
    anchor.getBoundingClientRect = () => ({ top: 5000, bottom: 5030, left: 0, right: 30, width: 30, height: 30, x: 0, y: 5000, toJSON: () => ({}) });
    act(() => { fireEvent.scroll(document); });
    expect(onClose).toHaveBeenCalled();
  });

  it('starts on the first item, moves with the arrow keys, and closes on Escape', () => {
    const { onClose } = setup();
    const [first, second] = screen.getAllByRole('menuitem');
    expect(first).toHaveFocus();
    fireEvent.keyDown(first!, { key: 'ArrowDown' });
    expect(second).toHaveFocus();
    fireEvent.keyDown(second!, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('runs the chosen item and closes', () => {
    const { onClose, select } = setup();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Archive' }));
    expect(select).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });
});
