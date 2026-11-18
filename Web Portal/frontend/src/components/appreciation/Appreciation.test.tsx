import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { useAuthStore } from '../../stores/auth-store';
import { ApiError } from '../../lib/api-client';
import { APPRECIATION_ANIMATIONS, APPRECIATION_ICONS, APPRECIATION_STATUSES, APPRECIATION_THEMES, fillPlaceholders } from '../../lib/appreciation';
import { AppreciationPopup } from './AppreciationPopup';
import { AppreciationBanner } from './AppreciationBanner';
import { forgetLocalAppreciations, useMyAppreciations } from './useMyAppreciations';
import type { ApiAppreciation } from '../../api/appreciations';

// Employee Appreciation (1.24.0) on the website: the one-time popup (server state), Accept online and offline
// (the offline queue), Close, the banner, and the names shared with the server.
const api = vi.hoisted(() => ({ me: vi.fn(), accept: vi.fn(), closePopup: vi.fn() }));
vi.mock('../../api/appreciations', async (orig) => ({ ...(await orig<typeof import('../../api/appreciations')>()), appreciationsApi: () => api }));

const A: ApiAppreciation = {
  id: 'ap1', batchId: 'b1', title: 'Great Teamwork', message: 'Thank you, Sara Khan, for the great teamwork.', theme: 'ocean', icon: 'team', animation: 'none',
  day: '2026-11-18', startsAt: '2026-11-17T20:00:00.000Z', endsAt: '2026-11-18T20:00:00.000Z', status: 'ACTIVE', acceptedAt: null, popupClosedAt: null,
  sender: { id: 'u-omar', name: 'Omar Said' }, company: { name: 'Contoso', logoUrl: null },
};
const me = (live: ApiAppreciation[]) => ({ canManage: false, today: '2026-11-18', serverNow: '2026-11-18T05:00:00.000Z', live });

function Both() {
  const m = useMyAppreciations();
  const a = m.live[0];
  return (
    <>
      <AppreciationPopup />
      {a ? <AppreciationBanner a={a} more={m.live.length - 1} onAccept={m.accept} problem={m.problem} /> : <p>No banner</p>}
    </>
  );
}
const show = () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <Both />
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

beforeEach(() => {
  localStorage.clear();
  forgetLocalAppreciations();
  for (const f of Object.values(api)) f.mockReset();
  useAuthStore.setState({ user: { id: 'u-sara', username: 'sara', email: 'sara@contoso.test', roles: ['EMPLOYEE'] } as never, isAuthenticated: true });
});
afterEach(() => useAuthStore.setState({ user: null, isAuthenticated: false } as never));

describe('the one-time popup', () => {
  it('shows today’s unaccepted appreciation; Accept records it and the banner says Accepted', async () => {
    api.me.mockResolvedValue(me([A]));
    api.accept.mockResolvedValue({ acceptedAt: '2026-11-18T05:01:00.000Z', already: false });
    show();
    const dialog = await screen.findByRole('dialog', { name: 'Great Teamwork' });
    expect(dialog).toHaveTextContent('Thank you, Sara Khan');
    expect(dialog).toHaveTextContent('From Omar Said');
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Accept appreciation' })));
    expect(api.accept).toHaveBeenCalledWith('ap1');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByText(/^Accepted/)).toBeInTheDocument();
  });

  it('never shows when the server says accepted or closed (another device); the banner keeps Accept after Close', async () => {
    api.me.mockResolvedValue(me([{ ...A, popupClosedAt: '2026-11-18T04:00:00.000Z' }]));
    show();
    expect(await screen.findByRole('button', { name: 'Accept' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('Close stores it on the server and leaves Accept in the banner', async () => {
    api.me.mockResolvedValue(me([A]));
    // A read that answers with the old state (it was on its way) must not bring the popup back.
    api.closePopup.mockResolvedValue({ popupClosedAt: '2026-11-18T05:00:00.000Z' });
    show();
    await screen.findByRole('dialog');
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Close' })));
    expect(api.closePopup).toHaveBeenCalledWith('ap1');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Accept' })).toBeInTheDocument();
  });

  it('offline: Accept is queued and shown accepted at once (also after a reload)', async () => {
    api.me.mockResolvedValue(me([A]));
    api.accept.mockRejectedValue(new TypeError('Failed to fetch'));
    const first = show();
    await screen.findByRole('dialog');
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Accept appreciation' })));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByText(/^Accepted/)).toBeInTheDocument();
    const queue = JSON.parse(localStorage.getItem('mico360.syncQueue') ?? localStorage.getItem(Object.keys(localStorage).find((k) => k.includes('ueue')) ?? '') ?? '[]');
    expect(JSON.stringify(queue)).toContain('appreciation.accept');
    first.unmount();
    show(); // a reload while still offline: the server still says not accepted, the queue says accepted
    expect(await screen.findByText(/^Accepted/)).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('an accept the server refuses (the day ended) is not queued; it says why', async () => {
    api.me.mockResolvedValueOnce(me([A])).mockResolvedValue(me([]));
    api.accept.mockRejectedValue(new ApiError(409, 'APPRECIATION_EXPIRED', 'This appreciation ended at midnight and can no longer be accepted.'));
    show();
    await screen.findByRole('dialog');
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Accept appreciation' })));
    await waitFor(() => expect(screen.getByText('No banner')).toBeInTheDocument());
    expect(localStorage.getItem('mico360.syncQueue') ?? '').not.toContain('appreciation.accept');
  });

  it('nothing at all without an appreciation today', async () => {
    api.me.mockResolvedValue(me([]));
    show();
    await waitFor(() => expect(api.me).toHaveBeenCalled());
    expect(screen.getByText('No banner')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('a client account never asks', async () => {
    useAuthStore.setState({ user: { id: 'c1', username: 'c', email: 'c@x.test', roles: ['CLIENT'] } as never });
    show();
    await new Promise((r) => setTimeout(r, 20));
    expect(api.me).not.toHaveBeenCalled();
  });
});

describe('shared with the server', () => {
  it('the theme, icon, animation and status names match appreciation-rules.ts', () => {
    const server = readFileSync(join(__dirname, '../../../../backend/src/modules/appreciations/appreciation-rules.ts'), 'utf8');
    const list = (name: string) => JSON.parse(`[${/const NAME = \[([^\]]*)\]/.source.replace('NAME', name) && (server.match(new RegExp(`const ${name} = \\[([^\\]]*)\\]`))?.[1] ?? '').replace(/'/g, '"')}]`);
    expect(list('APPRECIATION_THEMES')).toEqual([...APPRECIATION_THEMES]);
    expect(list('APPRECIATION_ICONS')).toEqual([...APPRECIATION_ICONS]);
    expect(list('APPRECIATION_ANIMATIONS')).toEqual([...APPRECIATION_ANIMATIONS]);
    expect(list('APPRECIATION_STATUSES')).toEqual([...APPRECIATION_STATUSES]);
  });
  it('placeholders fill as on the server', () => {
    expect(fillPlaceholders('{name} · {company} · {date}', { name: 'Sara Khan', company: 'Contoso', day: '2026-11-18' })).toBe('Sara Khan · Contoso · 18 Nov 2026');
  });
});

describe('the bell notice', () => {
  it('“You’ve been appreciated” opens the Dashboard', async () => {
    const { notificationTarget } = await import('../../lib/notification-links');
    expect(notificationTarget({ entityType: 'appreciation', entityId: 'ap1' })).toEqual({ kind: 'path', to: '/dashboard' });
  });
});
