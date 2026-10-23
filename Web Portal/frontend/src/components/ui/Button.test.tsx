import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Button } from './Button';

describe('Button', () => {
  it('renders its label and fires onClick', async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Save</Button>);
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('ignores presses while loading but stays focusable (a disabled button would drop keyboard focus to the page)', async () => {
    const onClick = vi.fn();
    render(
      <Button loading onClick={onClick}>
        Save
      </Button>,
    );
    const btn = screen.getByRole('button');
    expect(btn).not.toBeDisabled();
    expect(btn).toHaveAttribute('aria-disabled', 'true');
    expect(btn).toHaveAttribute('aria-busy', 'true');
    btn.focus();
    expect(btn).toHaveFocus();
    await userEvent.click(btn);
    await userEvent.keyboard('{Enter}');
    expect(onClick).not.toHaveBeenCalled();
  });

  it('does not submit its form a second time while loading', async () => {
    const onSubmit = vi.fn((event: { preventDefault: () => void }) => event.preventDefault());
    render(
      <form onSubmit={onSubmit}>
        <input aria-label="Name" />
        <Button type="submit" loading>
          Save
        </Button>
      </form>,
    );
    await userEvent.click(screen.getByRole('button'));
    await userEvent.type(screen.getByLabelText('Name'), 'x{Enter}');
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('is not marked unavailable when it is idle, and stays natively disabled when asked', () => {
    const { rerender } = render(<Button>Save</Button>);
    expect(screen.getByRole('button')).not.toHaveAttribute('aria-disabled');
    rerender(<Button disabled>Save</Button>);
    expect(screen.getByRole('button')).toBeDisabled();
  });

  it('exposes its variant for styling/testing', () => {
    render(<Button variant="ghost">X</Button>);
    expect(screen.getByRole('button')).toHaveAttribute('data-variant', 'ghost');
  });

  it('keeps a caller’s aria-disabled: unavailable for now, but still focusable', () => {
    render(<Button aria-disabled>Send</Button>);
    const button = screen.getByRole('button');
    expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(button).toBeEnabled();
    button.focus();
    expect(button).toHaveFocus();
  });
});
