import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ArchivedCompanyState } from './ArchivedCompanyState';
import { CompanyNotice } from './CompanyNotice';
import { useAuthStore } from '../../stores/auth-store';
import { useCompanyStore } from '../../stores/company-store';
import { enqueueOffline } from '../../lib/offline-replay';
import { clearQueue, localStorageQueueStore } from '../../lib/offline-queue';

beforeEach(() => {
  useAuthStore.getState().setSession({ user: { id: 'u1', email: 'a@b.c', username: 'ada', roles: [] }, accessToken: 'at', refreshToken: 'rt' });
});
afterEach(() => {
  clearQueue(localStorageQueueStore);
  useCompanyStore.setState({ pick: null, notice: null, noticeName: null, names: {}, userId: null });
});

describe('ArchivedCompanyState', () => {
  it('says so as the page’s heading, with a way to sign out', async () => {
    render(<ArchivedCompanyState />);
    expect(screen.getByRole('heading', { name: 'Your company is archived — ask an administrator.' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
  });

  it('warns about changes still on this device before signing out', async () => {
    enqueueOffline('task.move', { id: 't1', toColumnId: 'c2' });
    render(<ArchivedCompanyState />);
    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(useAuthStore.getState().isAuthenticated).toBe(true);
    expect(screen.getByRole('alert')).toHaveTextContent(/1 change saved on this device hasn’t been sent yet/i);
    await userEvent.click(screen.getByRole('button', { name: /log out anyway/i }));
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
  });
});

describe('CompanyNotice', () => {
  it('shows nothing until a picked company is taken away', () => {
    const { container } = render(<CompanyNotice />);
    expect(container).toBeEmptyDOMElement();
  });

  it('a name in another script keeps its own direction inside the sentence', () => {
    useCompanyStore.setState({ pick: 'g', userId: 'u1', names: { g: 'شركة غاما' } });
    useCompanyStore.getState().companyGone();
    render(<CompanyNotice />);
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('You no longer have access to شركة غاما. Showing all your companies.');
    expect(status.querySelector('bdi')).toHaveTextContent('شركة غاما');
  });

  it('without a name: "that company", no empty isolate', () => {
    useCompanyStore.setState({ pick: 'x', userId: 'u1', names: {} });
    useCompanyStore.getState().companyGone();
    render(<CompanyNotice />);
    expect(screen.getByRole('status')).toHaveTextContent('You no longer have access to that company. Showing all your companies.');
    expect(screen.getByRole('status').querySelector('bdi')).toBeNull();
  });
});
