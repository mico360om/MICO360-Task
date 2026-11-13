import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { UpdateToast } from './UpdateToast';
import { createUpdateWatcher } from '../lib/update-recovery';

const RUNNING = { version: '1.23.0', builtAt: '2026-11-05T18:00:00.000Z' };
const NEWER = { version: '1.23.1', builtAt: '2026-11-05T22:20:00.000Z' };

function watcher(deployed: () => typeof NEWER) {
  return createUpdateWatcher({
    running: RUNNING,
    deployed: async () => deployed(),
    onFocus: () => () => {},
    every: () => () => {},
    typing: () => false,
    assign: () => {},
    storage: { get: () => null, set: () => {} },
    memory: new Set(),
  });
}

afterEach(cleanup);

describe('the update notice (installable website)', () => {
  it('says nothing while this page is the newest version', async () => {
    const w = watcher(() => RUNNING);
    render(<UpdateToast watcher={w} reload={vi.fn()} />);
    await act(() => w.check());
    expect(screen.queryByText(/new version/i)).toBeNull();
  });

  it('once a newer version is live: “A new version of MICO360 Tasks is ready”, with Refresh and Later', async () => {
    const w = watcher(() => NEWER);
    const reload = vi.fn();
    render(<UpdateToast watcher={w} reload={reload} />);
    await act(() => w.check());
    const notice = screen.getByRole('status');
    expect(notice).toHaveTextContent('A new version of MICO360 Tasks is ready');
    await userEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('Later puts it away for that version; an even newer one shows it again', async () => {
    let deployed = NEWER;
    const w = watcher(() => deployed);
    render(<UpdateToast watcher={w} reload={vi.fn()} />);
    await act(() => w.check());
    await userEvent.click(screen.getByRole('button', { name: 'Later' }));
    expect(screen.queryByText(/new version/i)).toBeNull();
    await act(() => w.check());
    expect(screen.queryByText(/new version/i)).toBeNull();
    deployed = { version: '1.23.2', builtAt: '2026-11-06T08:00:00.000Z' };
    await act(() => w.check());
    expect(screen.getByText(/a new version of mico360 tasks is ready/i)).toBeInTheDocument();
  });

  it('a version found before the notice was shown is said at once (a page that was opened later)', async () => {
    const w = watcher(() => NEWER);
    await w.check();
    render(<UpdateToast watcher={w} reload={vi.fn()} />);
    expect(screen.getByText(/a new version of mico360 tasks is ready/i)).toBeInTheDocument();
  });

  it('without a watcher (tests, a page that has none) it renders nothing', () => {
    const { container } = render(<UpdateToast watcher={null} reload={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });
});
