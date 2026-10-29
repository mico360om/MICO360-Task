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

  it('puts its icon in the corner beside the number, leaving the label and hint the full width (a phone split “workspaces” in two)', () => {
    const { container } = render(<StatTile label="Projects" value={2} hint="Active workspaces" icon={<svg />} />);
    const icon = container.querySelector('[data-stat-icon]')!;
    expect(icon.className).toMatch(/(^|\s)absolute(\s|$)/);
    expect(icon).toHaveAttribute('aria-hidden', 'true');
    // The hint is not squeezed into a column beside the icon.
    expect(icon.parentElement).toBe(screen.getByText('Active workspaces').parentElement);
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
