import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LoadError } from './LoadError';

describe('LoadError', () => {
  it('announces what could not be loaded and offers to try again', async () => {
    const onRetry = vi.fn();
    render(<LoadError what="your tasks" onRetry={onRetry} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Couldn’t load your tasks.');
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('shows no Retry when there is nothing to retry', () => {
    render(<LoadError what="settings" />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
