import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ActionMenu } from './ActionMenu';

describe('ActionMenu', () => {
  it('puts focus back on its button before an item acts, so a dialog the item opens returns focus there', async () => {
    let focusedWhenActing: Element | null = null;
    render(<ActionMenu label="More meeting actions" items={[{ label: 'Edit details', onSelect: () => { focusedWhenActing = document.activeElement; } }]} />);
    const button = screen.getByRole('button', { name: 'More meeting actions' });
    button.focus();
    await userEvent.keyboard('{Enter}');
    await userEvent.keyboard('{Enter}'); // the first item has focus once the menu opens
    expect(focusedWhenActing).toBe(button);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('opens towards the screen: from the left edge of its button below lg where the button sits at the left, from the right edge above', async () => {
    render(<ActionMenu label="More meeting actions" align="start-below-lg" items={[{ label: 'Edit details', onSelect: () => {} }]} />);
    await userEvent.click(screen.getByRole('button', { name: 'More meeting actions' }));
    const menu = screen.getByRole('menu');
    expect(menu.className).toMatch(/(^|\s)left-0(\s|$)/);
    expect(menu.className).toMatch(/lg:left-auto/);
    expect(menu.className).toMatch(/lg:right-0/);
  });

  it('never runs wider than the screen', async () => {
    render(<ActionMenu label="More" items={[{ label: 'Edit details', onSelect: () => {} }]} />);
    await userEvent.click(screen.getByRole('button', { name: 'More' }));
    expect(screen.getByRole('menu').className).toMatch(/max-w-\[calc\(100vw-2rem\)\]/);
  });

  it('moves back on screen when the button sits too near an edge (a 320px phone)', async () => {
    const width = vi.spyOn(document.documentElement, 'clientWidth', 'get').mockReturnValue(320);
    const rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      return (this.getAttribute('role') === 'menu' ? { left: 154, right: 378, width: 224, top: 0, bottom: 200, height: 200, x: 154, y: 0 } : { left: 0, right: 0, width: 0, top: 0, bottom: 0, height: 0, x: 0, y: 0 }) as DOMRect;
    });
    render(<ActionMenu label="More" align="start-below-lg" items={[{ label: 'Edit details', onSelect: () => {} }]} />);
    await userEvent.click(screen.getByRole('button', { name: 'More' }));
    // 378 − (320 − 8) = 66px too far right.
    expect(screen.getByRole('menu').style.transform).toBe('translateX(-66px)');
    width.mockRestore();
    rect.mockRestore();
  });
});
