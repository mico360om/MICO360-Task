import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { InstallAppCard } from './InstallAppCard';
import { InstallAppMenuItem } from './InstallAppMenuItem';
import { AddToHomeScreenGuide } from './AddToHomeScreenGuide';
import { resetInstallAppForTests, startInstallApp, NOT_NOW_KEY, type InstallWorld } from '../../lib/install-app';

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1';
const CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';

function device(kind: 'chrome' | 'iphone' | 'installed' | 'firefox') {
  const listeners: Record<string, ((e: unknown) => void)[]> = {};
  const store = new Map<string, string>();
  const w: InstallWorld = {
    addEventListener: (type, fn) => void (listeners[type] ??= []).push(fn),
    displayModeStandalone: () => kind === 'installed',
    onDisplayModeChange: () => {},
    navigator: { userAgent: kind === 'iphone' ? IPHONE : CHROME, platform: kind === 'iphone' ? 'iPhone' : 'Win32', maxTouchPoints: kind === 'iphone' ? 5 : 0 },
    storage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => void store.set(k, v) },
    now: () => Date.UTC(2026, 10, 13),
  };
  startInstallApp(w);
  const prompt = vi.fn(async () => undefined);
  const offer = (outcome: 'accepted' | 'dismissed' = 'accepted') =>
    act(() => (listeners.beforeinstallprompt ?? []).forEach((fn) => fn({ preventDefault: () => {}, prompt, userChoice: Promise.resolve({ outcome }) })));
  const installed = () => act(() => (listeners.appinstalled ?? []).forEach((fn) => fn({})));
  return { store, prompt, offer, installed };
}

beforeEach(() => resetInstallAppForTests());
afterEach(() => {
  cleanup();
  resetInstallAppForTests();
});

describe('the Dashboard card: “Install MICO360 Tasks on this device”', () => {
  it('nothing where the browser can’t install, or when already running installed', () => {
    device('firefox');
    const { container } = render(<InstallAppCard />);
    expect(container).toBeEmptyDOMElement();
    cleanup();
    resetInstallAppForTests();
    const d = device('installed');
    render(<InstallAppCard />);
    d.offer();
    expect(screen.queryByText(/install mico360 tasks/i)).toBeNull();
  });

  it('Chrome/Edge/Android: Install opens the browser’s own install; installed, the card goes', async () => {
    const d = device('chrome');
    render(<InstallAppCard />);
    expect(screen.queryByText(/install mico360 tasks/i)).toBeNull();
    d.offer();
    const card = screen.getByRole('region', { name: 'Install MICO360 Tasks on this device' });
    await userEvent.click(within(card).getByRole('button', { name: 'Install' }));
    expect(d.prompt).toHaveBeenCalledTimes(1);
    d.installed();
    expect(screen.queryByRole('region', { name: /install mico360 tasks/i })).toBeNull();
  });

  it('Not now hides it on this device (90 days, remembered)', async () => {
    const d = device('chrome');
    render(<InstallAppCard />);
    d.offer();
    await userEvent.click(screen.getByRole('button', { name: 'Not now' }));
    expect(screen.queryByRole('region', { name: /install mico360 tasks/i })).toBeNull();
    expect(d.store.get(NOT_NOW_KEY)).toBe(String(Date.UTC(2026, 10, 13)));
  });

  it('iPhone/iPad: Install opens the Add to Home Screen guide (Share → Add to Home Screen → Add)', async () => {
    device('iphone');
    // The page's one guide (AppShell renders it once).
    render(
      <>
        <InstallAppCard />
        <AddToHomeScreenGuide />
      </>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Install' }));
    const guide = screen.getByRole('dialog', { name: 'Add MICO360 Tasks to your Home Screen' });
    const steps = within(guide).getAllByRole('listitem').map((li) => li.textContent?.replace(/\s+/g, ' ').trim());
    expect(steps).toHaveLength(3);
    expect(steps[0]).toMatch(/Tap Share/);
    expect(steps[1]).toMatch(/Add to Home Screen/);
    expect(steps[2]).toMatch(/Tap Add/);
    expect(guide).toHaveTextContent(/asks you to sign in once/i);
    await userEvent.click(within(guide).getByRole('button', { name: 'Done' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('the account menu’s “Install App”', () => {
  it('shown while the site can be installed; it runs the install and closes the menu', async () => {
    const d = device('chrome');
    const close = vi.fn();
    render(<InstallAppMenuItem className="x" onDone={close} />);
    expect(screen.queryByRole('menuitem', { name: 'Install App' })).toBeNull();
    d.offer();
    await userEvent.click(screen.getByRole('menuitem', { name: 'Install App' }));
    expect(close).toHaveBeenCalled();
    expect(d.prompt).toHaveBeenCalledTimes(1);
  });

  it('stays after Not now on the card', async () => {
    const d = device('chrome');
    render(
      <>
        <InstallAppCard />
        <InstallAppMenuItem className="x" onDone={() => {}} />
      </>,
    );
    d.offer();
    await userEvent.click(screen.getByRole('button', { name: 'Not now' }));
    expect(screen.getByRole('menuitem', { name: 'Install App' })).toBeInTheDocument();
  });

  it('on iPhone/iPad it opens the guide, which outlives the closed menu', async () => {
    device('iphone');
    const { rerender } = render(
      <>
        <InstallAppMenuItem className="x" onDone={() => {}} />
        <AddToHomeScreenGuide />
      </>,
    );
    await userEvent.click(screen.getByRole('menuitem', { name: 'Install App' }));
    expect(screen.getByRole('dialog', { name: 'Add MICO360 Tasks to your Home Screen' })).toBeInTheDocument();
    // The menu closes (its item goes); the guide stays until Done.
    rerender(<AddToHomeScreenGuide />);
    expect(screen.getByRole('dialog', { name: 'Add MICO360 Tasks to your Home Screen' })).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('hidden once running installed', () => {
    const d = device('installed');
    render(<InstallAppMenuItem className="x" onDone={() => {}} />);
    d.offer();
    expect(screen.queryByRole('menuitem', { name: 'Install App' })).toBeNull();
  });
});
