import { describe, it, expect } from 'vitest';
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

  it('opens towards the screen: from the left edge of its button below md where the button sits at the left, from the right edge above', async () => {
    render(<ActionMenu label="More meeting actions" align="start-below-md" items={[{ label: 'Edit details', onSelect: () => {} }]} />);
    await userEvent.click(screen.getByRole('button', { name: 'More meeting actions' }));
    const menu = screen.getByRole('menu');
    expect(menu.className).toMatch(/(^|\s)left-0(\s|$)/);
    expect(menu.className).toMatch(/md:left-auto/);
    expect(menu.className).toMatch(/md:right-0/);
  });

  it('never runs wider than the screen', async () => {
    render(<ActionMenu label="More" items={[{ label: 'Edit details', onSelect: () => {} }]} />);
    await userEvent.click(screen.getByRole('button', { name: 'More' }));
    expect(screen.getByRole('menu').className).toMatch(/max-w-\[calc\(100vw-2rem\)\]/);
  });
});
