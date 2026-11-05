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

const recover = vi.fn();
vi.mock('../lib/update-recovery', async (importOriginal) => ({ ...(await importOriginal<typeof import('../lib/update-recovery')>()), recoverChunk: () => recover() }));

function MissingChunk(): JSX.Element {
  throw new TypeError('Failed to fetch dynamically imported module: https://task.mico360.com/assets/ManagementPage-SAS2EKa4.js');
}

describe('ErrorBoundary — the site’s code didn’t load (1.23.2)', () => {
  it('a newer version is deployed: the page reloads to it, and nothing goes to the Error log', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    reported.mockClear();
    recover.mockResolvedValue('reloading');
    render(<ErrorBoundary><MissingChunk /></ErrorBoundary>);
    expect(await screen.findByText(/Loading the new version/)).toBeInTheDocument();
    expect(reported).not.toHaveBeenCalled();
  });

  it('no newer version (or offline, or already reloaded): the plain message with Reload, and it is recorded', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    reported.mockClear();
    recover.mockResolvedValue('failed');
    render(<ErrorBoundary><MissingChunk /></ErrorBoundary>);
    expect(await screen.findByText('This page couldn’t load — check your connection and try again')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument();
    await vi.waitFor(() => expect(reported).toHaveBeenCalledTimes(1));
  });
});
