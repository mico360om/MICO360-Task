import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProjectStatusMenu } from './ProjectStatusMenu';

const project = { name: 'Rig Inspection Portal', status: 'ACTIVE' as const };

describe('ProjectStatusMenu', () => {
  it('shows the status on a button that opens a menu of the five statuses, the current one ticked', async () => {
    render(<ProjectStatusMenu project={project} onChange={vi.fn()} />);
    const button = screen.getByRole('button', { name: /status: active/i });
    expect(button).toHaveTextContent('Active');
    expect(button).toHaveAttribute('aria-haspopup', 'menu');
    expect(button).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');
    const items = screen.getAllByRole('menuitemradio');
    expect(items.map((i) => i.textContent)).toEqual(['Planning', 'Active', 'On hold', 'Completed', 'Archived']);
    expect(screen.getByRole('menuitemradio', { name: 'Active' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('menuitemradio', { name: 'Planning' })).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByRole('menu', { name: 'Status of Rig Inspection Portal' })).toBeInTheDocument();
  });

  it('works from the keyboard: opens on the current status, arrows move, Enter picks, focus returns to the button', async () => {
    const onChange = vi.fn();
    render(<ProjectStatusMenu project={project} onChange={onChange} />);
    const button = screen.getByRole('button', { name: /status: active/i });
    button.focus();
    await userEvent.keyboard('{Enter}');
    expect(document.activeElement).toBe(screen.getByRole('menuitemradio', { name: 'Active' }));
    await userEvent.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(screen.getByRole('menuitemradio', { name: 'On hold' }));
    await userEvent.keyboard('{End}');
    expect(document.activeElement).toBe(screen.getByRole('menuitemradio', { name: 'Archived' }));
    await userEvent.keyboard('{ArrowDown}'); // wraps round
    expect(document.activeElement).toBe(screen.getByRole('menuitemradio', { name: 'Planning' }));
    await userEvent.keyboard('{Enter}');
    expect(onChange).toHaveBeenCalledWith('PLANNING');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(document.activeElement).toBe(button);
  });

  it('closes on Escape without changing anything, back on its button', async () => {
    const onChange = vi.fn();
    render(<ProjectStatusMenu project={project} onChange={onChange} />);
    const button = screen.getByRole('button', { name: /status: active/i });
    await userEvent.click(button);
    await userEvent.keyboard('{ArrowUp}{Escape}');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(document.activeElement).toBe(button);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('does nothing when the current status is picked again', async () => {
    const onChange = vi.fn();
    render(<ProjectStatusMenu project={project} onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: /status: active/i }));
    await userEvent.click(screen.getByRole('menuitemradio', { name: 'Active' }));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('is a plain label, not a button, for someone who may not change the status', () => {
    render(<ProjectStatusMenu project={{ ...project, status: 'ON_HOLD' }} />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByText('On hold')).toBeInTheDocument();
  });
});
