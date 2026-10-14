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
});
