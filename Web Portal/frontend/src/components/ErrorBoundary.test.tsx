import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ErrorBoundary } from './ErrorBoundary';

const reported = vi.fn();
vi.mock('../lib/error-reporting', () => ({ reportPageError: (e: unknown) => reported(e) }));

function Broken(): JSX.Element {
  throw new TypeError('x is undefined');
}

describe('ErrorBoundary', () => {
  it('shows the reload card and sends the error to the Error log (1.22.4)', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<ErrorBoundary><Broken /></ErrorBoundary>);
    expect(screen.getByRole('alert')).toHaveTextContent('This page hit an unexpected error');
    expect(reported).toHaveBeenCalledTimes(1);
    expect((reported.mock.calls[0]![0] as Error).message).toBe('x is undefined');
  });
});
