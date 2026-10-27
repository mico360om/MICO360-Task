import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StatTile } from './StatTile';

describe('StatTile', () => {
  it('renders a label and value', () => {
    render(<StatTile label="Projects" value={5} />);
    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.getByText('Projects')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('with onClick it is a button (named by actionLabel) that opens what is behind the number', async () => {
    const open = vi.fn();
    render(<StatTile label="Late tasks" value={4} hint="in 2 projects" onClick={open} actionLabel="4 late tasks in all projects: show the list" />);
    const button = screen.getByRole('button', { name: '4 late tasks in all projects: show the list' });
    expect(button).toHaveTextContent('Late tasks');
    await userEvent.setup().click(button);
    expect(open).toHaveBeenCalledTimes(1);
  });
});
